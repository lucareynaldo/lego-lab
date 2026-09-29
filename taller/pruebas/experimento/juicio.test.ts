import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import {anonimizar, juzgarTodo} from '../../src/experimento/juicio.ts';
import {armarSecuencia, generarPaginaHumano, seleccionarPares} from '../../src/experimento/pagina-humano.ts';
import {idsAnonimos, mulberry32} from '../../src/experimento/azar.ts';

const NIVELES = ['low', 'medium', 'high', 'xhigh', 'max'];

function png(ruta: string, lado: number) {
	const p = new PNG({width: lado, height: lado});
	p.data.fill(200);
	writeFileSync(ruta, PNG.sync.write(p));
}

// carpeta de salida sintética con n corridas (n/5 por nivel), auditoría, corridas y clave ya armadas
async function montar(n: number, conImagenes = true) {
	const salida = mkdtempSync(join(tmpdir(), 'juicio-'));
	const auditoria = Array.from({length: n}, (_, i) => ({id: `r${String(i + 1).padStart(2, '0')}`, nivel: NIVELES[i % 5]!, entrego: i !== 3, valido: true, contaminada: false}));
	writeFileSync(join(salida, 'auditoria.json'), JSON.stringify(auditoria));
	for (const a of auditoria) {
		mkdirSync(join(salida, 'corridas', a.id), {recursive: true});
		writeFileSync(join(salida, 'corridas', a.id, 'modelo.mpd'), '0 x');
	}
	const clave = await anonimizar({
		salida,
		imagenes: (_m, dir, nombre) => {
			const grilla = join(dir, `${nombre}-grilla.png`);
			const silueta = join(dir, `${nombre}-silueta.png`);
			if (conImagenes) {
				png(grilla, 8);
				png(silueta, 4);
			}
			return {grilla, silueta};
		},
	});
	return {salida, clave};
}

test('seleccionarPares: 75 pares, 7-8 por par de niveles, cada modelo al menos 3 veces', () => {
	const modelos = idsAnonimos(25, mulberry32(1)).map((anon, i) => ({anon, nivel: NIVELES[i % 5]!}));
	const nivel = new Map(modelos.map((m) => [m.anon, m.nivel]));
	const pares = seleccionarPares(modelos, 7);
	assert.equal(pares.length, 75);
	assert.equal(new Set(pares.map(([a, b]) => a + b)).size, 75);
	const porCombo = new Map<string, number>();
	const usos = new Map(modelos.map((m) => [m.anon, 0]));
	for (const [a, b] of pares) {
		const k = [nivel.get(a), nivel.get(b)].sort().join('|');
		porCombo.set(k, (porCombo.get(k) ?? 0) + 1);
		usos.set(a, usos.get(a)! + 1);
		usos.set(b, usos.get(b)! + 1);
	}
	assert.equal(porCombo.size, 10);
	for (const c of porCombo.values()) assert.ok(c === 7 || c === 8, `combo con ${c}`);
	for (const u of usos.values()) assert.ok(u >= 3, `modelo con ${u} usos`);
});

test('armarSecuencia: 10 repetidos al final con los lados invertidos', () => {
	const modelos = idsAnonimos(25, mulberry32(1)).map((anon, i) => ({anon, nivel: NIVELES[i % 5]!}));
	const s = armarSecuencia(seleccionarPares(modelos, 7), 9);
	assert.equal(s.length, 85);
	assert.ok(s.slice(0, 75).every((p) => !p.repetido));
	for (const r of s.slice(75)) {
		assert.ok(r.repetido);
		const o = s.slice(0, 75).find((p) => p.a === r.a && p.b === r.b)!;
		assert.equal(o.izq, r.der);
	}
});

test('anonimizar: solo entregadas, ids de 4 letras y clave escrita', async () => {
	const {salida, clave} = await montar(10);
	assert.equal(Object.keys(clave).length, 9);
	assert.ok(!Object.values(clave).includes('r04'));
	assert.deepEqual(JSON.parse(readFileSync(join(salida, 'clave.json'), 'utf8')), clave);
	for (const a of Object.keys(clave)) assert.match(a, /^[A-Z]{4}$/);
	assert.equal(readdirSync(join(salida, 'ciego')).length, 9);
});

test('página humana: autocontenida, sin niveles y con lo pedido', async () => {
	const {salida} = await montar(25);
	const ruta = generarPaginaHumano({salida});
	const html = readFileSync(ruta, 'utf8');
	const sinImagenes = html.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, '');
	assert.ok(!/\b(low|medium|high|xhigh|max)\b/i.test(sinImagenes), 'menciona un nivel');
	assert.match(html, /data:image\/png;base64,/);
	assert.match(html, /¿Cuál es mejor modelo para un video de armado\?/);
	assert.match(html, /Descargar respuestas/);
	assert.match(html, /respuestas-humano\.json/);
	assert.match(html, /localStorage/);
	assert.ok(!/https?:\/\//.test(sinImagenes));
	const datos = JSON.parse(html.match(/<script id="datos" type="application\/json">(.*?)<\/script>/s)![1]!);
	assert.equal(datos.secuencia.length, 85);
	assert.equal(datos.secuencia.filter((p: {repetido: boolean}) => p.repetido).length, 10);
});

test('juzgarTodo: todos los pares, dos órdenes, reanudable', async () => {
	const {salida, clave} = await montar(5);
	const n = Object.keys(clave).length;
	process.env.CLAUDE_BIN = join(import.meta.dirname, 'fixtures/juez-falso.mjs');
	await juzgarTodo('juez-x', {salida});
	const lineas = readFileSync(join(salida, 'juicios-vlm.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
	assert.equal(lineas.length, (n * (n - 1)) / 2);
	for (const l of lineas) {
		assert.ok(l.ab && l.ba);
		// el falso responde siempre "general: A" en ambas posiciones: al combinar, empate
		assert.equal(l.combinado.general, 'empate');
		assert.equal(l.combinado.reconoce, 'empate');
	}
	// reanudar: si el juez fallara, los pares ya guardados no se vuelven a llamar
	process.env.CLAUDE_BIN = join(import.meta.dirname, 'fixtures/no-existe.mjs');
	await juzgarTodo('juez-x', {salida});
	assert.equal(readFileSync(join(salida, 'juicios-vlm.jsonl'), 'utf8').trim().split('\n').length, lineas.length);
	assert.ok(existsSync(join(salida, 'juicios-vlm')));
});

test('juzgarTodo: no lee la clave, no filtra rutas del experimento y reintenta pares incompletos', async () => {
	const {salida} = await montar(3);
	rmSync(join(salida, 'clave.json'));
	const log = join(salida, 'prompts.log');
	const falla = join(salida, 'falla');
	process.env.CLAUDE_BIN = join(import.meta.dirname, 'fixtures/juez-registra.mjs');
	process.env.JUEZ_LOG = log;
	process.env.JUEZ_FALLA_ARCHIVO = falla;
	try {
		writeFileSync(falla, '');
		await juzgarTodo('juez-y', {salida});
		const cache = join(salida, 'juicios-vlm/juez-y');
		const guardados = readdirSync(cache).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(cache, f), 'utf8')));
		assert.equal(guardados.length, 3);
		assert.ok(guardados.every((g) => g.completo === false && g.ab === null));
		rmSync(falla);
		rmSync(log);
		await juzgarTodo('juez-y', {salida});
		const otros = readdirSync(cache).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(cache, f), 'utf8')));
		assert.ok(otros.every((g) => g.completo === true && g.ab && g.ba));
		const prompts = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string);
		assert.equal(prompts.length, 6);
		for (const t of prompts) {
			assert.ok(!t.includes('.cache/experimentos'), t);
			assert.match(t, /a-grilla.png/);
		}
	} finally {
		delete process.env.JUEZ_LOG;
		delete process.env.JUEZ_FALLA_ARCHIVO;
	}
});

function renderContado(llamadas: string[]) {
	return (_m: string, dir: string, nombre: string) => {
		llamadas.push(nombre);
		const grilla = join(dir, `${nombre}-grilla.png`);
		const silueta = join(dir, `${nombre}-silueta.png`);
		png(grilla, 8);
		png(silueta, 4);
		return {grilla, silueta};
	};
}

function agregarCorrida(salida: string, id: string, nivel: string, entrego = true) {
	const auds = JSON.parse(readFileSync(join(salida, 'auditoria.json'), 'utf8'));
	auds.push({id, nivel, entrego, valido: true, contaminada: false});
	writeFileSync(join(salida, 'auditoria.json'), JSON.stringify(auds));
	mkdirSync(join(salida, 'corridas', id), {recursive: true});
	if (entrego) writeFileSync(join(salida, 'corridas', id, 'modelo.mpd'), `0 ${id}`);
}

test('anonimizar es estable: los ids viejos no cambian y solo lo nuevo se renderiza', async () => {
	const {salida, clave} = await montar(10);
	agregarCorrida(salida, 'r11', 'low');
	const llamadas: string[] = [];
	const clave2 = await anonimizar({salida, imagenes: renderContado(llamadas)});
	for (const [a, id] of Object.entries(clave)) assert.equal(clave2[a], id);
	assert.equal(Object.keys(clave2).length, 10);
	const nuevo = Object.keys(clave2).find((a) => !(a in clave))!;
	assert.equal(clave2[nuevo], 'r11');
	assert.deepEqual(llamadas, [nuevo]);
	for (const a of Object.keys(clave2)) assert.match(JSON.parse(readFileSync(join(salida, 'ciego', a, 'fuente.json'), 'utf8')).sha256, /^[0-9a-f]{64}$/);
	// sin cambios no se re-renderiza nada
	llamadas.length = 0;
	await anonimizar({salida, imagenes: renderContado(llamadas)});
	assert.deepEqual(llamadas, []);
	// desde cero da la misma asignación que la primera vez (misma semilla)
	const {clave: otra} = await montar(10);
	assert.deepEqual(otra, clave);
});

test('anonimizar: si cambia el modelo de un ANON se re-renderiza y se borran solo sus veredictos', async () => {
	const {salida, clave} = await montar(5);
	const [a, b] = Object.keys(clave).sort() as [string, string];
	const cache = join(salida, 'juicios-vlm', 'juez-x');
	mkdirSync(cache, {recursive: true});
	const otros = Object.keys(clave).filter((x) => x !== a).sort();
	writeFileSync(join(cache, `${a}-${b}.json`), '{}');
	writeFileSync(join(cache, `${otros[0]}-${otros[1]}.json`), '{}');
	writeFileSync(join(salida, 'corridas', clave[a]!, 'modelo.mpd'), '0 cambiado');
	const llamadas: string[] = [];
	const clave2 = await anonimizar({salida, imagenes: renderContado(llamadas)});
	assert.deepEqual(clave2, clave);
	assert.deepEqual(llamadas, [a]);
	assert.ok(!existsSync(join(cache, `${a}-${b}.json`)));
	assert.ok(existsSync(join(cache, `${otros[0]}-${otros[1]}.json`)));
});

test('anonimizar aborta ante incoherencias', async () => {
	const {salida, clave} = await montar(5);
	// una corrida de la clave dejó de ser entrega
	const auds = JSON.parse(readFileSync(join(salida, 'auditoria.json'), 'utf8'));
	const quitada = Object.values(clave)[0]!;
	writeFileSync(join(salida, 'auditoria.json'), JSON.stringify(auds.map((x: {id: string}) => (x.id === quitada ? {...x, entrego: false} : x))));
	await assert.rejects(anonimizar({salida, imagenes: renderContado([])}), /ya no es una entrega/);
	writeFileSync(join(salida, 'auditoria.json'), JSON.stringify(auds));
	// carpeta sobrante en ciego/
	mkdirSync(join(salida, 'ciego', 'ZZZZ'));
	await assert.rejects(anonimizar({salida, imagenes: renderContado([])}), /ZZZZ/);
	rmSync(join(salida, 'ciego', 'ZZZZ'), {recursive: true});
	// dos ids para la misma corrida
	writeFileSync(join(salida, 'clave.json'), JSON.stringify({...clave, ZZZZ: Object.values(clave)[0]}));
	await assert.rejects(anonimizar({salida, imagenes: renderContado([])}), /misma corrida/);
});

test('anonimizar y la página solo usan corridas del plan', async () => {
	const {salida} = await montar(25);
	rmSync(join(salida, 'clave.json'));
	rmSync(join(salida, 'ciego'), {recursive: true});
	agregarCorrida(salida, 'calibracion', 'max');
	agregarCorrida(salida, 'r02-intento-cortado', 'low');
	const clave = await anonimizar({salida, imagenes: renderContado([])});
	assert.equal(Object.keys(clave).length, 24);
	assert.ok(!Object.values(clave).some((id) => id === 'calibracion' || id.includes('intento')));
	// aunque la clave traiga una corrida fuera del plan, la página la ignora
	writeFileSync(join(salida, 'clave.json'), JSON.stringify({...clave, QQQQ: 'calibracion'}));
	const html = readFileSync(generarPaginaHumano({salida}), 'utf8');
	assert.ok(!html.includes('QQQQ'));
});

test('juzgarTodo falla si una carpeta de ciego/ no tiene fuente.json', async () => {
	const {salida, clave} = await montar(3);
	rmSync(join(salida, 'ciego', Object.keys(clave)[0]!, 'fuente.json'));
	await assert.rejects(juzgarTodo('juez-z', {salida}), /sin fuente\.json/);
});

test('página humana: la clave de localStorage depende de la secuencia', async () => {
	const clave = async (n: number) => {
		const {salida} = await montar(n);
		return /var CLAVE = '(corredor-humano-01-[0-9a-f]{12})'/.exec(readFileSync(generarPaginaHumano({salida}), 'utf8'))?.[1];
	};
	const k25 = await clave(25);
	const k20 = await clave(20);
	assert.ok(k25 && k20);
	assert.notEqual(k25, k20);
	assert.equal(await clave(25), k25);
});
