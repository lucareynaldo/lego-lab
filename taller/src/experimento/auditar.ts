import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {basename, join, posix, resolve} from 'node:path';
import {esPieza} from '../../../verificador/src/ldraw.ts';
import {nuevaBiblioteca} from '../entorno.ts';
import {metricas, type Metricas} from '../metricas.ts';
import {validarModelo} from '../validar.ts';
import {resumirTranscript, terminoBien, type Resumen} from './transcript.ts';

const TALLER = resolve(import.meta.dirname, '../..');
const RAIZ = resolve(TALLER, '..');
const SALIDA = join(RAIZ, '.cache/experimentos/01');

export const PROHIBIDAS = /^Plant Tree/i;
export const IDS_PROHIBIDOS = ['2435', '3470', '3471', '3778', '52211', '2518c01'];

export type Auditoria = {
	id: string;
	nivel: string;
	entrego: boolean;
	valido: boolean | null;
	errores: number;
	prohibidas: string[];
	contaminada: boolean;
	// el último mensaje no es ENTREGADO ni SIN ENTREGA: la sesión terminó por otra causa (arnés, tiempo, caída)
	terminoMal: boolean;
	rutasFuera: string[];
	motivosContaminacion: string[];
	metricas: Metricas | null;
	resumen: Resumen;
};

export type OpcionesAuditar = {
	conMetricas?: boolean;
	// para pruebas: carpetas propias
	corridas?: string;
	base?: string;
};

// minúsculas, barras normales y sin prefijo de Git Bash (/c/...)
const norm = (r: string, cwd?: string) => {
	let x = r.split(String.fromCharCode(92)).join('/').replace(/^\/([a-z])\//i, '$1:/').replace(/^~\//, homedir().split(String.fromCharCode(92)).join('/') + '/');
	// las relativas se resuelven contra la carpeta de trabajo; luego se colapsan . y ..
	if (cwd && !/^([a-z]:)?\//i.test(x)) x = cwd + '/' + x;
	return posix.normalize(x).replace(/\/+$/, '').toLowerCase();
};
const bajo = (ruta: string, dir: string) => ruta === dir || ruta.startsWith(dir + '/');
const INOFENSIVAS = new Set(['/dev/null', '/dev/stdin', '/dev/stdout', '/dev/stderr']);
const BINARIOS = /(^|\/)(node|claude)(\.exe|\.cmd)?$|\/program files\/nodejs\/|\/\.local\/bin\//;

const PERMITIDOS_REPO = ['taller', '.cache/ldraw/parts', '.cache/ldraw/p', '.cache/ldcadshadowlibrary-main', '.cache/taller', '.cache/rebrickable', 'estudio'];
const PROHIBIDOS_REPO = ['referencias', '.cache/experimentos', '.cache/ldraw/models', 'diseno', 'investigaciones'];

const CODIGO_EXPERIMENTO = ['taller/src/experimento', 'taller/pruebas/experimento'];
// cachés de render compartidas: guardan el MPD crudo de los modelos de las otras corridas y de la selección del juez
const CACHES_RENDER = ['.cache/taller/render', 'estudio/public/taller'];

// el mismo hash con que render.ts nombra el modelo empaquetado
export function hashRender(mpd: string): string {
	return createHash('sha1').update(readFileSync(mpd, 'latin1')).digest('hex').slice(0, 12);
}

// contaminada =tocó algo que delata el diseño del experimento u otros árboles; fuera = rutas raras para revisar a mano
// hashesPropios: hashes de render de los modelos de esta corrida (vacío si no se pueden saber)
export function contaminacion(rutas: string[], dirsPropios: string[], id: string, hashesPropios: string[] = []): {motivos: string[]; fuera: string[]} {
	const propios = dirsPropios.map((d) => norm(d));
	const raiz = norm(RAIZ);
	const motivos: string[] = [];
	const fuera: string[] = [];
	for (const original of rutas) {
		const r = norm(original, propios[0]);
		if (INOFENSIVAS.has(r) || propios.some((d) => bajo(r, d))) continue;
		const otra = /\/(?:lego-lab-exp01|corridas)\/([^/]+)/.exec(r)?.[1];
		let motivo: string | undefined;
		const prohibido = PROHIBIDOS_REPO.find((d) => bajo(r, raiz + '/' + d));
		if (prohibido) motivo = prohibido + '/';
		// listar la carpeta (la ruta es la carpeta misma) no delata nada; abrir un archivo de adentro sí
		else if (CODIGO_EXPERIMENTO.some((d) => r !== raiz + '/' + d && bajo(r, raiz + '/' + d))) motivo = 'leyó código del experimento';
		else if (otra && otra !== id) motivo = 'otra corrida';
		else if (/(^|[^a-z])omr([^a-z]|$)/.test(r)) motivo = 'omr';
		else if (r.includes('sets-test')) motivo = 'sets-test';
		else if (CACHES_RENDER.some((d) => bajo(r, raiz + '/' + d))) {
			const nombre = r.split('/').at(-1)!;
			if (/\.(mpd|ldr)$/.test(nombre)) {
				const hash = nombre.split('.')[0]!;
				if (hashesPropios.includes(hash)) continue;
				// sin modelo propio no se puede saber de quién es: revisión manual, no limpia
				if (hashesPropios.length === 0) {
					fuera.push(original);
					continue;
				}
				motivo = 'leyó modelos ajenos del render; hash distinto del modelo entregado';
			} else if (/\/lote-[^/]+\//.test(r)) {
				fuera.push(original);
				continue;
			}
		}
		if (motivo) {
			motivos.push(original + ' (' + motivo + ')');
			continue;
		}
		const permitido = PERMITIDOS_REPO.some((d) => bajo(r, raiz + '/' + d)) || bajo(r, norm(tmpdir())) || BINARIOS.test(r);
		if (permitido) continue;
		if (/(^|[/_. -])(arbol|arboles|tree|trees)([/_. -]|$)/.test(r)) motivos.push(original + ' (arbol/tree ajeno)');
		else fuera.push(original);
	}
	return {motivos, fuera};
}

export function piezasProhibidas(ruta: string): string[] {
	const bib = nuevaBiblioteca();
	const principal = bib.cargarModelo(ruta, basename(ruta));
	const halladas = new Set<string>();
	const vistos = new Set<string>();
	const visitar = (nombre: string) => {
		if (vistos.has(nombre)) return;
		vistos.add(nombre);
		const a = bib.archivo(nombre);
		if (!a) return;
		for (const l of a.lineas) {
			const m = /^1(?:\s+\S+){13}\s+(.+?)\s*$/.exec(l.trim());
			if (!m) continue;
			const ref = m[1];
			const sub = bib.archivo(ref);
			if (sub && !esPieza(sub)) {
				visitar(ref);
				continue;
			}
			const id = basename(ref.split(String.fromCharCode(92)).join('/')).replace(/\.dat$/i, '').toLowerCase();
			if (IDS_PROHIBIDOS.includes(id) || PROHIBIDAS.test(sub?.titulo ?? '')) halladas.add(id);
		}
	};
	visitar(principal);
	return [...halladas].sort();
}

export async function auditar(id: string, op: OpcionesAuditar = {}): Promise<Auditoria> {
	const conMetricas = op.conMetricas ?? true;
	const dir = join(op.corridas ?? join(SALIDA, 'corridas'), id);
	const resultado = JSON.parse(readFileSync(join(dir, 'resultado.json'), 'utf8'));
	// se recalcula desde el transcript: el resumen congelado en resultado.json viene de versiones anteriores del lector
	const rutaTranscript = join(dir, 'transcript.jsonl');
	const resumen: Resumen = existsSync(rutaTranscript)
		? resumirTranscript(readFileSync(rutaTranscript, 'utf8'), {inicio: resultado.inicio, fin: resultado.fin})
		: {...resumirTranscript(''), ...resultado.resumen};
	const trabajo = join(op.base ?? join(tmpdir(), 'lego-lab-exp01'), id);
	const mpd = join(dir, 'modelo.mpd');
	const entrego = existsSync(mpd);
	const {motivos, fuera} = contaminacion(resumen.rutasLeidas ?? [], [trabajo, dir], id, entrego ? [hashRender(mpd)] : []);
	for (const l of resumen.lecturasExperimento ?? []) motivos.push(`${l} (leyó código del experimento en la salida de una búsqueda)`);
	let valido: boolean | null = null;
	let errores = 0;
	let prohibidas: string[] = [];
	let met: Metricas | null = null;
	if (entrego) {
		try {
			const v = await validarModelo(mpd);
			valido = v.ok;
			errores = v.errores.length;
			prohibidas = piezasProhibidas(mpd);
			if (conMetricas) met = await metricas(mpd);
		} catch {
			// un .mpd ilegible cuenta como entregado e inválido
			valido = false;
			errores = Math.max(errores, 1);
		}
	}
	return {
		id, nivel: resultado.nivel, entrego, valido, errores, prohibidas,
		contaminada: motivos.length > 0, terminoMal: !terminoBien(resumen.final), rutasFuera: fuera, motivosContaminacion: motivos, metricas: met, resumen,
	};
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
	const args = process.argv.slice(2);
	const dirCorridas = join(SALIDA, 'corridas');
	const ids = args.includes('--todas') || args.length === 0
		? readdirSync(dirCorridas).filter((d) => existsSync(join(dirCorridas, d, 'resultado.json')))
		: args.filter((a) => !a.startsWith('--'));
	const todas: Auditoria[] = [];
	for (const id of ids) {
		console.log(`auditando ${id}`);
		todas.push(await auditar(id));
	}
	mkdirSync(SALIDA, {recursive: true});
	writeFileSync(join(SALIDA, 'auditoria.json'), JSON.stringify(todas, null, '\t'));
}
