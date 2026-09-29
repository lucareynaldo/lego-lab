import {existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {mulberry32} from './azar.ts';
import {degradar, type TipoDegradacion} from './degradar.ts';
import {imagenesEstandar, type Imagenes} from './imagenes.ts';
import {combinarOrdenes, juzgarPar, TEMA_SELECCION, type Veredicto} from './juez.ts';

const RAIZ = resolve(import.meta.dirname, '../../..');
const MODELOS = join(RAIZ, 'referencias/sets-test/modelos');
const CACHE = join(RAIZ, '.cache/experimentos/01');
const SEMILLA = 20260929;
const JUECES = ['claude-fable-5-1', 'claude-opus-5-5'];
const TIPOS: TipoDegradacion[] = ['quitar', 'recolorear', 'tosca'];

// Se escribe junto al resultado para que quien lo lea sepa qué mide cada número antes de mirarlo
export const DEFINICIONES = {
	aciertos: 'pares cuyo veredicto combinado (los dos órdenes coinciden) en el criterio general elige al original',
	consistencia: 'proporción de los 30 pares en que los dos órdenes coinciden en un ganador (A o B) en el criterio general. Empate/empate cuenta como inconsistente, igual que un par con algún orden sin veredicto (null); el denominador son siempre los 30 pares',
	desempate: 'gana el de más aciertos; si la diferencia es menor a 5 puntos porcentuales, el más consistente; si siguen empatados, claude-opus-5-5',
};

type Resultado = {veredicto: Veredicto | null; costoUsd: number; crudo: string};
type Estadistica = {aciertos: number; total: number; consistencia: number; costoUsd: number};

// los 10 modelos del grupo "base" del manifiesto (los de reserva no entran)
function modelosBase(): string[] {
	const filas = readFileSync(join(RAIZ, 'referencias/sets-test/manifiesto.csv'), 'utf8').split(/\r?\n/).slice(1);
	return filas.map((f) => f.split(',')).filter((c) => c[0] === 'base').map((c) => c[1]!);
}

async function pool<T>(tareas: T[], concurrencia: number, tarea: (t: T) => Promise<void>) {
	const cola = [...tareas];
	await Promise.all(Array.from({length: concurrencia}, async () => {
		for (let t = cola.shift(); t; t = cola.shift()) await tarea(t);
	}));
}

// más aciertos; si la diferencia es menor a 5 pp, el más consistente; si siguen empatados, Opus
export function elegirJuez(porJuez: Record<string, Estadistica>): string {
	const [x, y] = JUECES as [string, string];
	const px = porJuez[x]!.aciertos / porJuez[x]!.total;
	const py = porJuez[y]!.aciertos / porJuez[y]!.total;
	if (Math.abs(px - py) >= 0.05) return px > py ? x : y;
	const cx = porJuez[x]!.consistencia;
	const cy = porJuez[y]!.consistencia;
	if (cx !== cy) return cx > cy ? x : y;
	return 'claude-opus-5-5';
}

export async function seleccionJuez(concurrencia: number = 6): Promise<{porJuez: Record<string, Estadistica>; elegido: string}> {
	const dirImg = join(CACHE, 'seleccion-juez/img');
	const dirLlamadas = join(CACHE, 'seleccion-juez');
	mkdirSync(dirImg, {recursive: true});

	type Par = {modelo: string; tipo: TipoDegradacion; original: Imagenes; degradada: Imagenes};
	const pares: Par[] = [];
	let idx = 0;
	for (const modelo of modelosBase()) {
		const ruta = join(MODELOS, `${modelo}.mpd`);
		const imgs = (mpd: string, nombre: string): Imagenes => {
			const grilla = join(dirImg, `${nombre}-grilla.png`);
			const silueta = join(dirImg, `${nombre}-silueta.png`);
			// las imágenes ya generadas se reutilizan al reanudar
			return existsSync(grilla) && existsSync(silueta) ? {grilla, silueta} : imagenesEstandar(mpd, dirImg, nombre);
		};
		const original = imgs(ruta, `${modelo}-original`);
		for (const tipo of TIPOS) {
			const azar = mulberry32(SEMILLA + idx++);
			const mpdDeg = join(dirImg, `${modelo}-${tipo}.mpd`);
			if (!existsSync(mpdDeg)) writeFileSync(mpdDeg, degradar(readFileSync(ruta, 'utf8'), tipo, azar));
			pares.push({modelo, tipo, original, degradada: imgs(mpdDeg, `${modelo}-${tipo}`)});
		}
	}

	type Tarea = {juez: string; par: Par; orden: 'ab' | 'ba'};
	const tareas: Tarea[] = [];
	for (const juez of JUECES) for (const par of pares) for (const orden of ['ab', 'ba'] as const) tareas.push({juez, par, orden});
	const resultados = new Map<string, Resultado>();
	const clave = (t: Tarea) => `${t.juez}__${t.par.modelo}__${t.par.tipo}__${t.orden}`;
	const trabajo = mkdtempSync(join(tmpdir(), 'juez-sel-'));

	await pool(tareas, concurrencia, async (t) => {
		const archivo = join(dirLlamadas, `${clave(t)}.json`);
		if (existsSync(archivo)) {
			resultados.set(clave(t), JSON.parse(readFileSync(archivo, 'utf8')));
			return;
		}
		const [a, b] = t.orden === 'ab' ? [t.par.original, t.par.degradada] : [t.par.degradada, t.par.original];
		const r = await juzgarPar(t.juez, a, b, TEMA_SELECCION, join(trabajo, clave(t)));
		// un fallo de parseo no se cachea: se reintenta al reanudar
		if (r.veredicto) writeFileSync(archivo, JSON.stringify(r, null, '\t'));
		resultados.set(clave(t), r);
		console.log(`[${clave(t)}] general=${r.veredicto?.general ?? 'SIN VEREDICTO'} costo=${r.costoUsd}`);
	});

	const porJuez: Record<string, Estadistica> = {};
	const detalle: Record<string, unknown[]> = {};
	for (const juez of JUECES) {
		const e: Estadistica = {aciertos: 0, total: pares.length, consistencia: 0, costoUsd: 0};
		let consistentes = 0;
		detalle[juez] = [];
		for (const par of pares) {
			const ab = resultados.get(clave({juez, par, orden: 'ab'}))!;
			const ba = resultados.get(clave({juez, par, orden: 'ba'}))!;
			e.costoUsd += ab.costoUsd + ba.costoUsd;
			if (!ab.veredicto || !ba.veredicto) {
				detalle[juez]!.push({modelo: par.modelo, tipo: par.tipo, combinado: null});
				continue;
			}
			const comb = combinarOrdenes(ab.veredicto, ba.veredicto);
			// en ab el original es A: acierta si el combinado en general es A; consistente si los dos órdenes coinciden
			if (comb.general !== 'empate') consistentes++;
			if (comb.general === 'A') e.aciertos++;
			detalle[juez]!.push({modelo: par.modelo, tipo: par.tipo, ab: ab.veredicto.general, ba: ba.veredicto.general, combinado: comb.general});
		}
		e.consistencia = consistentes / pares.length;
		porJuez[juez] = e;
	}
	const elegido = elegirJuez(porJuez);
	writeFileSync(join(CACHE, 'seleccion-juez.json'), JSON.stringify({porJuez, elegido, definiciones: DEFINICIONES, detalle},null, '\t'));
	return {porJuez, elegido};
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
	let concurrencia = 6;
	const idx = process.argv.indexOf('--concurrencia');
	if (idx !== -1 && idx + 1 < process.argv.length) {
		const n = parseInt(process.argv[idx + 1]!);
		if (isNaN(n) || n <= 0) {
			console.error('error: --concurrencia debe ser un entero positivo');
			process.exit(2);
		}
		concurrencia = n;
	}
	const r = await seleccionJuez(concurrencia);
	console.log(JSON.stringify({...r, definiciones: DEFINICIONES}, null,'\t'));
}
