import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {analizar, formaDeclarada} from '../../src/experimento/analizar.ts';

const NIVELES = ['low', 'medium', 'high', 'xhigh', 'max'];
const SECCIONES = [
	'## 1. Resultados por nivel',
	'## 2. Bradley–Terry por nivel',
	'## 3. Acuerdo VLM–humano',
	'## 4. Calidad frente a costo',
	'## 5. Regla de decisión del preregistro',
	'## 6. Corridas contaminadas y cortadas',
];

function metricas(piezas: number) {
	return {piezas, pasos: 20, colores: 4, noBasicas: 3, piezasPorPaso: {media: 5, max: 9}, studs: 50, fractal: 1.4, cambioSilueta: {media: 0.3, min: 0.1, pasosInvisibles: 0, cuadros: 20}};
}

// 10 corridas, 2 por nivel; r10 (max) sin entrega; r02 contaminada
function montar(conHumano: boolean) {
	const dir = mkdtempSync(join(tmpdir(), 'analizar-'));
	const destino = join(dir, 'diseno');
	const auds = Array.from({length: 10}, (_, i) => {
		const id = `r${String(i + 1).padStart(2, '0')}`;
		const entrego = i !== 9;
		return {
			id,
			nivel: NIVELES[i % 5]!,
			entrego,
			valido: entrego,
			errores: 0,
			prohibidas: [],
			contaminada: i === 1,
			motivosContaminacion: i === 1 ? ['leyó referencias/'] : [],
			rutasFuera: [],
			metricas: entrego ? metricas(100 + i) : null,
			resumen: {costoUsd: 1 + (i % 5), turnos: 10, duracionMs: 60000, tokensSalida: 1000, tokensPensamiento: 500, herramientas: {}, comandosTaller: {render: i % 5, validar: 2}, rutasLeidas: [], final: ''},
		};
	});
	writeFileSync(join(dir, 'auditoria.json'), JSON.stringify(auds));
	const entregadas = auds.filter((a) => a.entrego);
	const clave: Record<string, string> = {};
	entregadas.forEach((a, i) => (clave['ID' + String.fromCharCode(65 + i)] = a.id));
	writeFileSync(join(dir, 'clave.json'), JSON.stringify(clave));
	for (const a of auds) {
		mkdirSync(join(dir, 'corridas', a.id), {recursive: true});
		writeFileSync(join(dir, 'corridas', a.id, 'ficha.md'), '# Ficha\n\n- Forma elegida: Palmera, porque sí.\n');
	}
	// mejor nivel = más alto índice de nivel gana
	const anon = Object.keys(clave);
	const nivelDe = (k: string) => NIVELES.indexOf(auds.find((a) => a.id === clave[k])!.nivel);
	const lineas: string[] = [];
	const hum: unknown[] = [];
	for (let x = 0; x < anon.length; x++)
		for (let y = x + 1; y < anon.length; y++) {
			const a = anon[x]!;
			const b = anon[y]!;
			const r = nivelDe(a) > nivelDe(b) ? 'A' : nivelDe(a) < nivelDe(b) ? 'B' : 'empate';
			const v = {reconoce: r, creatividad: r, tecnica: r, historia: r, general: r};
			lineas.push(JSON.stringify({a, b, ab: v, ba: v, combinado: v}));
			hum.push({a, b, izq: a, der: b, eleccion: r, repetido: false});
		}
	hum.push({...(hum[0] as object), repetido: true});
	writeFileSync(join(dir, 'juicios-vlm.jsonl'), lineas.join('\n') + '\n');
	if (conHumano) writeFileSync(join(dir, 'respuestas-humano.json'), JSON.stringify(hum));
	return {dir, destino};
}

test('analizar escribe las 6 secciones en las dos rutas y trata contaminadas y sin entrega', async () => {
	const {dir, destino} = montar(true);
	try {
		const txt = await analizar({salida: dir, destino, repsBT: 50, repsMedia: 200});
		for (const s of SECCIONES) assert.ok(txt.includes(s), s);
		assert.equal(readFileSync(join(dir, 'resultados.md'), 'utf8'), txt);
		assert.equal(readFileSync(join(destino, 'resultados.md'), 'utf8'), txt);
		// tabla por nivel: cada nivel tiene su fila y la de max cuenta 1/2 válidos
		for (const n of NIVELES) assert.match(txt, new RegExp(String.raw`\| ${n} \| 2 \|`));
		assert.match(txt, /\| max \| 2 \| 1\/2 \(50 %/);
		assert.match(txt, /Palmera ×2/);
		// con y sin contaminadas
		assert.match(txt, /Sin corridas contaminadas/);
		assert.match(txt, /leyó referencias/);
		assert.match(txt, /Corridas sin entrega/);
		assert.match(txt, /<svg/);
		assert.match(txt, /Consistencia del juez humano en los 1 pares repetidos: 1\/1/);
		assert.match(txt, /κ de Cohen: 1,00/);
		assert.doesNotMatch(txt, /Pendiente/);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('la corrida sin entrega pierde todo y los pares del mismo nivel se descartan', async () => {
	const {dir, destino} = montar(true);
	try {
		// solo pares entre corridas del mismo nivel: la única información viene de la sin entrega
		const auds = JSON.parse(readFileSync(join(dir, 'auditoria.json'), 'utf8'));
		const clave = JSON.parse(readFileSync(join(dir, 'clave.json'), 'utf8')) as Record<string, string>;
		const nivelDe = (k: string) => auds.find((a: {id: string}) => a.id === clave[k]).nivel;
		const mismos = Object.keys(clave).flatMap((a) => Object.keys(clave).filter((b) => a < b && nivelDe(a) === nivelDe(b)).map((b) => [a, b] as const));
		const v = {reconoce: 'A', creatividad: 'A', tecnica: 'A', historia: 'A', general: 'A'};
		writeFileSync(join(dir, 'juicios-vlm.jsonl'), mismos.map(([a, b]) => JSON.stringify({a, b, ab: v, ba: v, combinado: v})).join('\n') + '\n');
		const txt = await analizar({salida: dir, destino, repsBT: 50, repsMedia: 100});
		// solo la comparación por sin entrega (max pierde contra 8 corridas de otros niveles = 6 + 2... la de max/1 entregada es mismo nivel)
		assert.match(txt, /\*\*general, con todas las corridas\*\* \(\d+ comparaciones\)/);
		const m = /\*\*general, con todas las corridas\*\* \((\d+) comparaciones\)/.exec(txt)!;
		// r10 (max) pierde contra las 8 entregadas de otros niveles; r05 (max) es del mismo nivel
		assert.equal(m[1], '8');
		const fila = (n: string) => new RegExp(String.raw`\| ${n} \| (-?[\d,]+) \|`).exec(txt.slice(txt.indexOf('**general, con todas'))) ;
		const th = (n: string) => Number(fila(n)![1]!.replace(",", "."));
		assert.ok(th('max') < th('low') && th('max') < th('high'));
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('funciona sin respuestas-humano.json: secciones humanas pendientes', async () => {
	const {dir, destino} = montar(false);
	try {
		const txt = await analizar({salida: dir, destino, repsBT: 30, repsMedia: 100});
		for (const s of SECCIONES) assert.ok(txt.includes(s), s);
		assert.match(txt, /Pendiente: falta `respuestas-humano.json`/);
		assert.match(txt, /Pendiente: hacen falta las respuestas/);
		assert.match(txt, /VLM general/);
		assert.ok(existsSync(join(destino, 'resultados.md')));
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('formaDeclarada', () => {
	assert.equal(formaDeclarada('Forma elegida: cónica, tipo pino'), 'Cónica / piramidal');
	assert.equal(formaDeclarada('Especie: sauce llorón'), 'Llorona');
	assert.equal(formaDeclarada('nada'), 'no declarada');
});

test('la calibración y otras corridas fuera del plan no entran', async () => {
	const {dir, destino} = montar(true);
	try {
		const auds = JSON.parse(readFileSync(join(dir, 'auditoria.json'), 'utf8'));
		auds.push({...auds[0], id: 'calibracion', nivel: 'max'});
		writeFileSync(join(dir, 'auditoria.json'), JSON.stringify(auds));
		const txt = await analizar({salida: dir, destino, repsBT: 30, repsMedia: 100});
		assert.match(txt, /Excluidas del análisis por no estar en el plan .*: calibracion/);
		assert.ok(txt.includes('**Todas las corridas** (10)'));
		assert.ok(txt.includes('| max | 2 |'));
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('BT humano: las corridas sin entrega se excluyen y se reportan por nivel', async () => {
	const {dir, destino} = montar(true);
	try {
		const txt = await analizar({salida: dir, destino, repsBT: 30, repsMedia: 100});
		const humano = txt.slice(txt.indexOf('### 2.1'), txt.indexOf('### 2.2'));
		// 9 entregadas: C(9,2) = 36 pares menos 4 del mismo nivel; sin las 8 derrotas sintéticas de r10
		assert.match(humano, /\*\*con todas las corridas\*\* \(32 comparaciones entre niveles distintos\)/);
		assert.match(humano, /Corridas sin entrega excluidas del BT humano, por nivel: low 0, medium 0, high 0, xhigh 0, max 1\./);
		assert.match(txt, /En el BT humano se excluyen/);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('§6 anota las que terminaron mal, las de costo estimado y las que tocaron el tope', async () => {
	const {dir, destino} = montar(true);
	try {
		const auds = JSON.parse(readFileSync(join(dir, 'auditoria.json'), 'utf8'));
		auds[0].terminoMal = true;
		auds[0].resumen.final = 'Espero a que termine la búsqueda.';
		auds[3].resumen.costoEstimado = true;
		auds[3].resumen.costoUsd = 7.5;
		auds[4].resumen.costoUsd = 50.2;
		auds[6].resumen.subtipo = 'error_max_budget_usd';
		writeFileSync(join(dir, 'auditoria.json'), JSON.stringify(auds));
		const txt = await analizar({salida: dir, destino, repsBT: 30, repsMedia: 100});
		const s6 = txt.slice(txt.indexOf('## 6.'));
		assert.match(s6, /\*\*Terminaron mal\*\*.*r01 \(low, final: "Espero a que termine la búsqueda\."\)/);
		assert.match(s6, /\*\*estimados\*\*.*r04 \(xhigh, 7,50 USD\)/);
		assert.match(s6, /Llegaron al tope de 50 USD.*r05 \(max, 50,20 USD\).*r07 \(medium, .*error_max_budget_usd\)/);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});
