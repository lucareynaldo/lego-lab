import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import type {Auditoria} from './auditar.ts';
import {mulberry32} from './azar.ts';
import {bootstrapBT, bootstrapMedia, kappa, kendallTau, wilson, type Comparacion} from './bt.ts';
import {planCorridas} from './plan.ts';
import {CRITERIOS, type Criterio, type Veredicto} from './juez.ts';

const RAIZ = resolve(import.meta.dirname, '../../..');
const SALIDA = join(RAIZ, '.cache/experimentos/01');
const DESTINO = join(RAIZ, 'diseno/experimentos/01-arbol-esfuerzo');
const SEMILLA = 20260929;

export const NIVELES = ['low', 'medium', 'high', 'xhigh', 'max'];
const FORMAS: [string, RegExp][] = [
	['Columnar', /columnar/],
	['Cónica / piramidal', /conica|piramidal/],
	['Oval', /\boval/],
	['Redonda', /redonda/],
	['Extendida', /extendida/],
	['En vaso', /en vaso/],
	['Llorona', /llorona|lloron/],
	['Irregular', /irregular/],
	['Palmera', /palmera/],
];

export type OpcionesAnalizar = {
	salida?: string;
	destino?: string;
	repsBT?: number;
	repsMedia?: number;
	// ids que cuentan (por omisión, las del plan); el resto, como la calibración, se excluye
	ids?: string[];
	// tope de USD por corrida del lote (desvío 4)
	tope?: number;
};

type Par = {a: string; b: string; r: 'A' | 'B' | 'empate'};
type ParHumano = Par & {repetido: boolean};
type JuicioVlm = {a: string; b: string; combinado: Veredicto};
type Ajuste = ReturnType<typeof bootstrapBT>;
type Conjunto = {titulo: string; incl: Set<string>};

function leerJson<T>(ruta: string): T | null {
	return existsSync(ruta) ? (JSON.parse(readFileSync(ruta, 'utf8')) as T) : null;
}

function sinAcentos(s: string): string {
	return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Mejor esfuerzo: la primera forma mencionada en las líneas que hablan de forma o especie; si no, en todo el texto.
export function formaDeclarada(ficha: string): string {
	const norm = sinAcentos(ficha);
	const elegir = (texto: string): string | null => {
		let mejor: [number, string] | null = null;
		for (const [nombre, re] of FORMAS) {
			const m = re.exec(texto);
			if (m && (!mejor || m.index < mejor[0])) mejor = [m.index, nombre];
		}
		return mejor ? mejor[1] : null;
	};
	const conForma = norm.split('\n').filter((l) => /forma|especie/.test(l)).join('\n');
	return elegir(conForma) ?? elegir(norm) ?? 'no declarada';
}

const fmt = (x: number, d = 1): string => (Number.isFinite(x) ? x.toFixed(d).replace('.', ',') : '—');
const fmtIc = (r: {media: number; ic: [number, number]}, d = 1): string =>
	Number.isFinite(r.media) ? `${fmt(r.media, d)} [${fmt(r.ic[0], d)}; ${fmt(r.ic[1], d)}]` : '—';
const pct = (x: number): string => `${fmt(x * 100, 0)} %`;
const invertir = (v: 'A' | 'B' | 'empate'): 'A' | 'B' | 'empate' => (v === 'A' ? 'B' : v === 'B' ? 'A' : 'empate');

function resumenNivel(xs: number[], reps: number, d = 1): string {
	return fmtIc(bootstrapMedia(xs, reps, mulberry32(SEMILLA)), d);
}

// Pasa pares entre corridas a comparaciones entre niveles; los pares del mismo nivel se descartan.
// Con sinEntregaPierde (BT del VLM, como manda el preregistro) una corrida sin entrega pierde contra todas
// y empata con otras sin entrega. En el BT humano no: esos pares nunca existieron en el diseño de 75 y
// pesarían unas 4 veces más que un modelo real; ahí las corridas sin entrega se excluyen y se reportan aparte.
function comparaciones(pares: Par[], nivelDe: Map<string, number>, incl: Set<string>, auds: Auditoria[], sinEntregaPierde: boolean): Comparacion[] {
	const todos: Par[] = pares.filter((p) => incl.has(p.a) && incl.has(p.b));
	const perdedoras = sinEntregaPierde ? auds.filter((a) => !a.entrego && incl.has(a.id)).map((a) => a.id) : [];
	const ganadoras = auds.filter((a) => a.entrego && incl.has(a.id)).map((a) => a.id);
	for (const u of perdedoras) for (const d of ganadoras) todos.push({a: u, b: d, r: 'B'});
	for (let x = 0; x < perdedoras.length; x++) for (let y = x + 1; y < perdedoras.length; y++) todos.push({a: perdedoras[x]!, b: perdedoras[y]!, r: 'empate'});
	const comps: Comparacion[] = [];
	for (const p of todos) {
		const i = nivelDe.get(p.a);
		const j = nivelDe.get(p.b);
		if (i === undefined || j === undefined || i === j) continue;
		comps.push({i, j, resultado: p.r === 'A' ? 'i' : p.r === 'B' ? 'j' : 'empate'});
	}
	return comps;
}

function tablaBT(niveles: string[], aj: Ajuste | null): string {
	if (!aj) return '_Sin comparaciones entre niveles distintos._\n';
	const filas = niveles.map((n, k) => {
		const ic = aj.ic[k]!;
		const sup = k + 1 < niveles.length ? fmt(aj.pSuperior[k + 1]![k]!, 2) : '—';
		return `| ${n} | ${fmt(aj.theta[k]!, 2)} | [${fmt(ic[0], 2)}; ${fmt(ic[1], 2)}] | ${sup} |`;
	});
	return ['| Nivel | θ | IC 95 % | P(nivel siguiente > este) |', '|---|---|---|---|', ...filas].join('\n') + '\n';
}

function grafico(niveles: string[], costo: number[], theta: number[], ic: [number, number][], etiqueta: string): string {
	const W = 560;
	const H = 340;
	const m = {l: 60, r: 20, t: 20, b: 50};
	const xmax = Math.max(...costo.filter(Number.isFinite), 0.01) * 1.1;
	const ys = [...ic.flat(), ...theta].filter(Number.isFinite);
	const ymin = Math.min(...ys, -0.5) - 0.2;
	const ymax = Math.max(...ys, 0.5) + 0.2;
	const X = (v: number): number => m.l + (v / xmax) * (W - m.l - m.r);
	const Y = (v: number): number => H - m.b - ((v - ymin) / (ymax - ymin)) * (H - m.t - m.b);
	const s: string[] = [];
	s.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Calidad ${etiqueta} contra costo medio por nivel" font-family="sans-serif" font-size="12">`);
	s.push(`<line x1="${m.l}" y1="${H - m.b}" x2="${W - m.r}" y2="${H - m.b}" stroke="currentColor" stroke-opacity="0.5"/>`);
	s.push(`<line x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${H - m.b}" stroke="currentColor" stroke-opacity="0.5"/>`);
	s.push(`<line x1="${m.l}" y1="${Y(0)}" x2="${W - m.r}" y2="${Y(0)}" stroke="currentColor" stroke-opacity="0.2" stroke-dasharray="4 4"/>`);
	for (let k = 0; k <= 4; k++) {
		const v = (xmax * k) / 4;
		s.push(`<text x="${X(v)}" y="${H - m.b + 16}" text-anchor="middle" fill="currentColor">${fmt(v, 2)}</text>`);
		const w = ymin + ((ymax - ymin) * k) / 4;
		s.push(`<text x="${m.l - 6}" y="${Y(w) + 4}" text-anchor="end" fill="currentColor">${fmt(w, 1)}</text>`);
	}
	s.push(`<text x="${(m.l + W - m.r) / 2}" y="${H - 8}" text-anchor="middle" fill="currentColor">Costo medio por corrida (USD)</text>`);
	s.push(`<text transform="translate(14 ${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle" fill="currentColor">θ ${etiqueta}</text>`);
	niveles.forEach((n, k) => {
		if (!Number.isFinite(costo[k]!)) return;
		const x = X(costo[k]!);
		s.push(`<line x1="${x}" y1="${Y(ic[k]![0])}" x2="${x}" y2="${Y(ic[k]![1])}" stroke="#3b78c4" stroke-width="2"/>`);
		s.push(`<circle cx="${x}" cy="${Y(theta[k]!)}" r="5" fill="#3b78c4"/>`);
		s.push(`<text x="${x + 8}" y="${Y(theta[k]!) - 8}" fill="currentColor">${n}</text>`);
	});
	s.push('</svg>');
	return s.join('\n');
}

export async function analizar(op: OpcionesAnalizar = {}): Promise<string> {
	const salida = op.salida ?? SALIDA;
	const destino = op.destino ?? DESTINO;
	const repsBT = op.repsBT ?? 2000;
	const repsMedia = op.repsMedia ?? 10000;

	const todasAuds = leerJson<Auditoria[]>(join(salida, 'auditoria.json'));
	if (!todasAuds) throw new Error(`falta ${join(salida, 'auditoria.json')}`);
	const validos = new Set(op.ids ?? planCorridas().map((c) => c.id));
	const auds = todasAuds.filter((a) => validos.has(a.id));
	const excluidas = todasAuds.filter((a) => !validos.has(a.id)).map((a) => a.id);
	const resultadoDe = (id: string): {cortadaPorTiempo?: boolean; infraestructura?: boolean} =>
		leerJson(join(salida, 'corridas', id, 'resultado.json')) ?? {};
	const clave = leerJson<Record<string, string>>(join(salida, 'clave.json')) ?? {};
	const rutaVlm = join(salida, 'juicios-vlm.jsonl');
	const vlm: JuicioVlm[] = existsSync(rutaVlm)
		? readFileSync(rutaVlm, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as JuicioVlm)
		: [];
	const humRaw = leerJson<{a: string; b: string; eleccion: 'A' | 'B' | 'empate'; repetido: boolean}[]>(join(salida, 'respuestas-humano.json'));

	const niveles = NIVELES.filter((n) => auds.some((a) => a.nivel === n));
	const nivelIdx = new Map(niveles.map((n, k) => [n, k]));
	const nivelDe = new Map(auds.map((a) => [a.id, nivelIdx.get(a.nivel)!]));

	const parVlm = (c: Criterio): Par[] =>
		vlm.flatMap((j) => {
			const a = clave[j.a];
			const b = clave[j.b];
			return a && b ? [{a, b, r: j.combinado[c]}] : [];
		});
	const parHum: ParHumano[] = (humRaw ?? []).flatMap((h) => {
		const a = clave[h.a];
		const b = clave[h.b];
		return a && b ? [{a, b, r: h.eleccion, repetido: h.repetido}] : [];
	});
	const humanoSinResolver = humRaw !== null && humRaw.length > 0 && parHum.length === 0;
	const humano = humRaw !== null && parHum.length > 0;
	const humanoBT: Par[] = parHum.filter((p) => !p.repetido);

	const todas = new Set(auds.map((a) => a.id));
	const limpias = new Set(auds.filter((a) => !a.contaminada).map((a) => a.id));
	const conjuntos: Conjunto[] = [{titulo: 'con todas las corridas', incl: todas}];
	const hayContaminadas = limpias.size < todas.size;
	if (hayContaminadas) conjuntos.push({titulo: 'sin corridas contaminadas', incl: limpias});

	const compsDe = (pares: Par[], incl: Set<string>, sinEntregaPierde = true): Comparacion[] => comparaciones(pares, nivelDe, incl, auds, sinEntregaPierde);
	const btDe = (pares: Par[], incl: Set<string>, sinEntregaPierde = true): Ajuste | null => {
		const comps = compsDe(pares, incl, sinEntregaPierde);
		return comps.length === 0 ? null : bootstrapBT(niveles.length, comps, repsBT, mulberry32(SEMILLA));
	};

	const md: string[] = [];
	md.push('# Resultados del experimento 01: un árbol con cada nivel de esfuerzo', '');
	md.push(`> Generado por \`taller/src/experimento/analizar.ts\`. Semilla ${SEMILLA}; IC al 95 %; ${repsMedia} réplicas para medias y ${repsBT} para Bradley–Terry. Análisis fijado en el [preregistro](preregistro.md).`, '');

	// 1. Por nivel
	if (humanoSinResolver) md.push('> **ADVERTENCIA:** `respuestas-humano.json` existe pero ninguno de sus ids se resuelve con `clave.json`; se ignora el juicio humano. Revisar la clave.', '');
	md.push('## 1. Resultados por nivel', '');
	const tablaNiveles = (incl: Set<string>): string => {
		const filas = [
			'| Nivel | Corridas | Válidos (Wilson) | Piezas | Pasos | Colores | No básicas | Piezas/paso | Fractal | Cambio de silueta | Costo (USD) | Tokens de salida | Tokens de pensamiento | Turnos | Duración (min) | `render` | `validar` | `construir` | `piezas` | Formas de copa |',
			'|' + '---|'.repeat(20),
		];
		for (const n of niveles) {
			const rs = auds.filter((a) => a.nivel === n && incl.has(a.id));
			const validos = rs.filter((a) => a.valido === true).length;
			const w = wilson(validos, rs.length);
			const con = rs.filter((a) => a.metricas);
			const met = (f: (m: NonNullable<Auditoria['metricas']>) => number, d = 1): string =>
				resumenNivel(con.map((a) => f(a.metricas!)).filter(Number.isFinite), repsMedia, d);
			const formas = new Map<string, number>();
			for (const a of rs) {
				const ficha = join(salida, 'corridas', a.id, 'ficha.md');
				const f = existsSync(ficha) ? formaDeclarada(readFileSync(ficha, 'utf8')) : 'no declarada';
				formas.set(f, (formas.get(f) ?? 0) + 1);
			}
			const formasTxt = [...formas].map(([f, c]) => `${f} ×${c}`).join(', ') || '—';
			const res = (f: (a: Auditoria) => number, d: number): string => resumenNivel(rs.map(f), repsMedia, d);
			filas.push(
				`| ${n} | ${rs.length} | ${validos}/${rs.length} (${pct(rs.length ? validos / rs.length : 0)}; [${pct(w[0])}; ${pct(w[1])}]) | ${met((m) => m.piezas, 0)} | ${met((m) => m.pasos, 0)} | ${met((m) => m.colores)} | ${met((m) => m.noBasicas)} | ${met((m) => m.piezasPorPaso.media)} | ${met((m) => m.fractal, 2)} | ${met((m) => m.cambioSilueta.media, 2)} | ${res((a) => a.resumen.costoUsd, 2)} | ${res((a) => a.resumen.tokensSalida, 0)} | ${res((a) => a.resumen.tokensPensamiento, 0)} | ${res((a) => a.resumen.turnos, 1)} | ${res((a) => a.resumen.duracionMs / 60000, 1)} | ${res((a) => a.resumen.comandosTaller.render ?? 0, 1)} | ${res((a) => a.resumen.comandosTaller.validar ?? 0, 1)} | ${res((a) => a.resumen.comandosTaller.construir ?? 0, 1)} | ${res((a) => a.resumen.comandosTaller.piezas ?? 0, 1)} | ${formasTxt} |`,
			);
		}
		return filas.join('\n');
	};
	md.push('Media [IC 95 % bootstrap] remuestreando corridas. Las métricas del modelo cuentan solo corridas con entrega; el resto, todas las corridas (una corrida sin entrega no es válida).', '');
	md.push(`**Todas las corridas** (${todas.size}):`, '', tablaNiveles(todas), '');
	if (hayContaminadas) md.push(`**Sin corridas contaminadas** (${limpias.size}):`, '', tablaNiveles(limpias), '');

	// 2. BT
	md.push('## 2. Bradley–Terry por nivel', '');
	md.push('Modelos agrupados por nivel, empates de Davidson, prior normal débil (σ = 3). Los pares del mismo nivel se descartan. En el BT del juez VLM, las corridas sin entrega pierden contra todas las demás (y empatan entre sí), como manda el preregistro. En el BT humano se excluyen: el humano nunca las vio y una derrota sintética contra cada modelo pesaría unas 4 veces más que las comparaciones reales; se reportan aparte. P(nivel siguiente > este) es la proporción de réplicas bootstrap en que el nivel contiguo superior tiene mayor θ.', '');
	const btHum = new Map<Conjunto, Ajuste | null>();
	const btGen = new Map<Conjunto, Ajuste | null>();
	md.push('### 2.1 Juez humano (calidad general)', '');
	if (!humano) md.push('_Pendiente: falta `respuestas-humano.json`._', '');
	else {
		for (const c of conjuntos) {
			btHum.set(c, btDe(humanoBT, c.incl, false));
			md.push(`**${c.titulo}** (${compsDe(humanoBT, c.incl, false).length} comparaciones entre niveles distintos):`, '', tablaBT(niveles, btHum.get(c)!));
		}
		const sinEntregaHum = niveles.map((n) => `${n} ${auds.filter((a) => a.nivel === n && !a.entrego).length}`);
		md.push(`Corridas sin entrega excluidas del BT humano, por nivel: ${sinEntregaHum.join(', ')}.`, '');
		const rep = parHum.filter((p) => p.repetido);
		let coinciden = 0;
		for (const r of rep) {
			const o = humanoBT.find((p) => (p.a === r.a && p.b === r.b) || (p.a === r.b && p.b === r.a));
			if (!o) continue;
			const esperado = o.a === r.a ? o.r : invertir(o.r);
			if (esperado === r.r) coinciden++;
		}
		md.push(`Consistencia del juez humano en los ${rep.length} pares repetidos: ${rep.length ? `${coinciden}/${rep.length} (${pct(coinciden / rep.length)})` : '—'}.`, '');
	}
	md.push('### 2.2 Juez VLM por criterio', '');
	if (vlm.length === 0) md.push('_Pendiente: falta `juicios-vlm.jsonl`._', '');
	else {
		for (const cr of CRITERIOS) {
			for (const c of conjuntos) {
				const pares = parVlm(cr);
				const aj = btDe(pares, c.incl);
				if (cr === 'general') btGen.set(c, aj);
				md.push(`**${cr}, ${c.titulo}** (${compsDe(pares, c.incl).length} comparaciones):`, '', tablaBT(niveles, aj));
			}
		}
	}

	// 3. Acuerdo
	md.push('## 3. Acuerdo VLM–humano', '');
	if (!humano || vlm.length === 0) md.push('_Pendiente: hacen falta las respuestas del juez humano y los juicios del VLM._', '');
	else {
		const par2 = (a: string, b: string): string => [a, b].sort().join('|');
		const mapaVlm = new Map(vlm.map((j) => [par2(j.a, j.b), j]));
		const deVlm: string[] = [];
		const deHum: string[] = [];
		for (const h of humRaw!.filter((x) => !x.repetido)) {
			const j = mapaVlm.get(par2(h.a, h.b));
			if (!j) continue;
			deVlm.push(j.a === h.a ? j.combinado.general : invertir(j.combinado.general));
			deHum.push(h.eleccion);
		}
		if (deVlm.length === 0) md.push('_No hay pares compartidos._', '');
		else {
			const acuerdo = deVlm.filter((x, i) => x === deHum[i]).length / deVlm.length;
			const thH = btHum.get(conjuntos[0]!)?.theta;
			const thV = btGen.get(conjuntos[0]!)?.theta;
			const tau = thH && thV ? kendallTau(thH, thV) : NaN;
			md.push(
				`- Pares compartidos: ${deVlm.length}.`,
				`- Acuerdo (misma respuesta A/B/empate, criterio general del VLM): ${pct(acuerdo)}.`,
				`- κ de Cohen: ${fmt(kappa(deVlm, deHum), 2)}.`,
				`- τ de Kendall entre los rankings de niveles (θ humano contra θ VLM general, todas las corridas): ${fmt(tau, 2)}. Con 5 niveles es un valor grueso.`,
				'',
			);
		}
	}

	// 4. Gráfico
	md.push('## 4. Calidad frente a costo', '');
	const baseCalidad = humano ? btHum : btGen;
	const etiqueta = humano ? 'humano' : 'VLM general';
	const ajGraf = baseCalidad.get(conjuntos[0]!);
	if (!ajGraf) md.push('_Pendiente: no hay comparaciones para calcular la calidad._', '');
	else {
		if (!humano) md.push('_Sin juicio humano: el eje vertical usa el θ del juez VLM (criterio general)._', '');
		const costoMedio = niveles.map((n) => {
			const xs = auds.filter((a) => a.nivel === n).map((a) => a.resumen.costoUsd);
			return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
		});
		md.push(grafico(niveles, costoMedio, ajGraf.theta, ajGraf.ic, etiqueta), '');
	}

	// 5. Decisión
	md.push('## 5. Regla de decisión del preregistro', '');
	md.push('Nivel por defecto = el más barato cuyo IC de BT se superpone con el del mejor nivel, y con validez ≥ 80 %.', '');
	if (![...baseCalidad.values()].some(Boolean)) md.push('_Pendiente: no hay BT disponible._', '');
	else {
		if (!humano) md.push('_Sin juicio humano: la regla se aplica con el BT del juez VLM (criterio general); no es la regla preregistrada._', '');
		for (const c of conjuntos) {
			const aj = baseCalidad.get(c);
			md.push(`**${c.titulo}:**`, '');
			if (!aj) {
				md.push('_Sin comparaciones._', '');
				continue;
			}
			const mejor = aj.theta.indexOf(Math.max(...aj.theta));
			const filas = niveles.map((n, k) => {
				const rs = auds.filter((a) => a.nivel === n && c.incl.has(a.id));
				const val = rs.length ? rs.filter((a) => a.valido === true).length / rs.length : 0;
				const costo = rs.length ? rs.reduce((s, a) => s + a.resumen.costoUsd, 0) / rs.length : Infinity;
				const solapa = aj.ic[k]![0] <= aj.ic[mejor]![1] && aj.ic[k]![1] >= aj.ic[mejor]![0];
				return {n, val, solapa, ok: solapa && val >= 0.8 && rs.length > 0, costo};
			});
			md.push('| Nivel | Se superpone con el mejor | Validez | Cumple | Costo medio (USD) |', '|---|---|---|---|---|');
			for (const f of filas) md.push(`| ${f.n} | ${f.solapa ? 'sí' : 'no'} | ${pct(f.val)} | ${f.ok ? 'sí' : 'no'} | ${fmt(f.costo, 2)} |`);
			const elegibles = filas.filter((f) => f.ok).sort((x, y) => x.costo - y.costo);
			md.push('', `Mejor nivel por θ: **${niveles[mejor]}**. ` + (elegibles.length ? `Nivel por defecto según la regla: **${elegibles[0]!.n}**.` : 'Ningún nivel cumple la regla; no hay nivel por defecto.'), '');
		}
	}

	// 6. Contaminadas y cortadas
	md.push('## 6. Corridas contaminadas y cortadas', '');
	const contam = auds.filter((a) => a.contaminada);
	if (contam.length === 0) md.push('Ninguna corrida contaminada.', '');
	else {
		md.push('Contaminada: el transcript muestra lecturas de material prohibido (referencias, otras corridas, árboles ajenos, código del experimento). Se reporta aparte: el análisis principal se presenta con y sin ellas.', '');
		md.push('| Corrida | Nivel | Motivos | Piezas prohibidas |', '|---|---|---|---|');
		for (const a of contam) md.push(`| ${a.id} | ${a.nivel} | ${a.motivosContaminacion.join('; ') || '—'} | ${a.prohibidas.join(', ') || '—'} |`);
		md.push('');
	}
	const conRutas = auds.filter((a) => a.rutasFuera.length > 0 && !a.contaminada);
	if (conRutas.length) md.push(`Con rutas fuera de lugar pendientes de revisión manual (no contaminadas): ${conRutas.map((a) => `${a.id} (${a.rutasFuera.length})`).join(', ')}.`, '');
	const cortadas = auds.filter((a) => resultadoDe(a.id).cortadaPorTiempo === true);
	if (cortadas.length) md.push(`Cortadas por tiempo (se analizan con lo entregado): ${cortadas.map((a) => `${a.id} (${a.nivel}${a.entrego ? '' : ', sin entrega'})`).join(', ')}.`, '');
	const malTerminadas = auds.filter((a) => a.terminoMal === true);
	if (malTerminadas.length) md.push(`**Terminaron mal** (el último mensaje no es \`ENTREGADO\` ni \`SIN ENTREGA: …\`; revisar si fue el arnés, el tiempo o el agente): ${malTerminadas.map((a) => `${a.id} (${a.nivel}, final: "${(a.resumen.final || '—').replace(/\s+/g, ' ').slice(0, 80)}")`).join(', ')}.`, '');
	const estimadas = auds.filter((a) => a.resumen.costoEstimado === true);
	if (estimadas.length) md.push(`Costo, tokens y turnos **estimados** (sin línea \`result\`: se reconstruyeron del \`usage\` de cada mensaje y la duración de inicio/fin): ${estimadas.map((a) => `${a.id} (${a.nivel}, ${fmt(a.resumen.costoUsd, 2)} USD)`).join(', ')}. Entran así en las tablas, el gráfico y la regla.`, '');
	const tope = op.tope ?? 50;
	const enTope = auds.filter((a) => a.resumen.costoUsd >= tope || /budget/i.test(a.resumen.subtipo ?? ''));
	if (enTope.length) md.push(`Llegaron al tope de ${tope} USD (se analizan igual con lo entregado): ${enTope.map((a) => `${a.id} (${a.nivel}, ${fmt(a.resumen.costoUsd, 2)} USD${a.resumen.subtipo ? `, ${a.resumen.subtipo}` : ''})`).join(', ')}.`, '');
	const infra = auds.filter((a) => resultadoDe(a.id).infraestructura === true);
	if (infra.length) md.push(`**Falla de infraestructura** (el preregistro manda anularlas y reponerlas): ${infra.map((a) => `${a.id} (${a.nivel})`).join(', ')}.`, '');
	md.push(excluidas.length ? `Excluidas del análisis por no estar en el plan (calibración u otras): ${excluidas.join(', ')}.` : 'Ninguna corrida fuera del plan (la calibración no entra en el análisis).', '');
	const sinEntrega = auds.filter((a) => !a.entrego);
	if (sinEntrega.length === 0) md.push('Todas las corridas entregaron `modelo.mpd`.', '');
	else {
		md.push('Corridas sin entrega (fallidas o cortadas por tope): pierden todos sus pares en el BT del VLM, se excluyen del BT humano y cuentan como no válidas.', '');
		md.push('| Corrida | Nivel | Costo (USD) | Turnos | Duración (min) |', '|---|---|---|---|---|');
		for (const a of sinEntrega) md.push(`| ${a.id} | ${a.nivel} | ${fmt(a.resumen.costoUsd, 2)} | ${a.resumen.turnos} | ${fmt(a.resumen.duracionMs / 60000, 1)} |`);
		md.push('');
	}
	const invalidas = auds.filter((a) => a.entrego && a.valido === false);
	if (invalidas.length) md.push(`Entregadas pero inválidas (se juzgan igual): ${invalidas.map((a) => `${a.id} (${a.nivel}, ${a.errores} errores)`).join(', ')}.`, '');

	const texto = md.join('\n');
	for (const dir of [salida, destino]) {
		mkdirSync(dir, {recursive: true});
		writeFileSync(join(dir, 'resultados.md'), texto);
	}
	return texto;
}

if (import.meta.main) {
	await analizar();
	console.log('resultados.md escrito');
}
