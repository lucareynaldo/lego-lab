import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import type {Auditoria} from './auditar.ts';
import {idsAnonimos, mulberry32} from './azar.ts';
import {imagenesEstandar, type Imagenes} from './imagenes.ts';
import {combinarOrdenes, CRITERIOS, juzgarPar, TEMA_ARBOL, type Veredicto} from './juez.ts';
import {generarPaginaHumano} from './pagina-humano.ts';
import {planCorridas} from './plan.ts';

const RAIZ = resolve(import.meta.dirname, '../../..');
const SALIDA = join(RAIZ, '.cache/experimentos/01');
const CONCURRENCIA = 6;

export type OpcionesJuicio = {
	salida?: string;
	// para pruebas: no renderizar
	imagenes?: (mpd: string, dir: string, nombre: string) => Imagenes;
	tema?: string;
	concurrencia?: number;
	// corridas que entran al juicio (por omisión, las del plan: fuera calibración e intentos cortados)
	ids?: string[];
};

export type Juicio = {a: string; b: string; ab: Veredicto | null; ba: Veredicto | null; combinado: Veredicto};

const sha256 = (ruta: string) => createHash('sha256').update(readFileSync(ruta)).digest('hex');

function escribirAtomico(ruta: string, texto: string) {
	writeFileSync(ruta + '.tmp', texto);
	renameSync(ruta + '.tmp', ruta);
}

// La clave es estable: los ids ya asignados no cambian nunca y solo las entregas nuevas reciben uno.
// Cada ciego/<ANON>/fuente.json guarda el sha256 del modelo.mpd de origen; si cambia, se re-renderiza y se
// borran los veredictos en caché de ese ANON. Cualquier incoherencia aborta.
export async function anonimizar(op: OpcionesJuicio = {}): Promise<Record<string, string>> {
	const salida = op.salida ?? SALIDA;
	const plan = new Set(op.ids ?? planCorridas().map((c) => c.id));
	const auditoria: Auditoria[] = JSON.parse(readFileSync(join(salida, 'auditoria.json'), 'utf8'));
	const entregadas = auditoria.filter((a) => a.entrego && plan.has(a.id)).map((a) => a.id).sort();
	const rutaClave = join(salida, 'clave.json');
	const clave: Record<string, string> = existsSync(rutaClave) ? JSON.parse(readFileSync(rutaClave, 'utf8')) : {};
	const fallar = (m: string): never => {
		throw new Error(`anonimizar: ${m}. No se tocó nada; revisar a mano antes de seguir.`);
	};
	const ids = Object.values(clave);
	if (new Set(ids).size !== ids.length) fallar('clave.json asigna dos ids anónimos a la misma corrida');
	for (const [a, id] of Object.entries(clave)) {
		if (!/^[A-Z]{4}$/.test(a)) fallar(`id anónimo inválido en clave.json: ${a}`);
		if (!entregadas.includes(id)) fallar(`${a} → ${id} está en clave.json pero ${id} ya no es una entrega del plan`);
	}
	const ciego = join(salida, 'ciego');
	if (existsSync(ciego)) {
		const sobrantes = readdirSync(ciego).filter((d) => !(d in clave));
		if (sobrantes.length) fallar(`carpetas en ciego/ que no están en clave.json: ${sobrantes.join(', ')}`);
	}
	const nuevas = entregadas.filter((id) => !ids.includes(id));
	if (nuevas.length) {
		// misma secuencia sembrada de siempre, saltando los ids ya usados
		const azar = mulberry32(20260929 + 1);
		for (const id of nuevas) {
			let a: string;
			do a = idsAnonimos(1, azar)[0]!;
			while (a in clave);
			clave[a] = id;
		}
		mkdirSync(salida, {recursive: true});
		escribirAtomico(rutaClave, JSON.stringify(clave, null, '\t'));
	}
	const render = op.imagenes ?? imagenesEstandar;
	for (const [a, id] of Object.entries(clave)) {
		const dir = join(ciego, a);
		const mpd = join(salida, 'corridas', id, 'modelo.mpd');
		const huella = sha256(mpd);
		const rutaFuente = join(dir, 'fuente.json');
		const previa: string | undefined = existsSync(rutaFuente) ? JSON.parse(readFileSync(rutaFuente, 'utf8')).sha256 : undefined;
		const imagenes = existsSync(join(dir, `${a}-grilla.png`)) && existsSync(join(dir, `${a}-silueta.png`));
		if (previa === huella && imagenes) continue;
		if (previa !== undefined && previa !== huella) {
			console.warn(`AVISO: el modelo de ${a} cambió (sha256 ${previa.slice(0, 12)} → ${huella.slice(0, 12)}): se re-renderiza y se borran sus veredictos en caché`);
			if (existsSync(join(salida, 'respuestas-humano.json'))) console.warn(`AVISO: respuestas-humano.json ya existe y puede incluir pares con ${a}: esos juicios corresponden al modelo viejo`);
		}
		if (previa !== huella) invalidarVeredictos(salida, a);
		rmSync(dir, {recursive: true, force: true});
		mkdirSync(dir, {recursive: true});
		render(mpd, dir, a);
		// fuente.json al final: su presencia con la huella correcta marca las imágenes como completas
		escribirAtomico(rutaFuente, JSON.stringify({sha256: huella}));
	}
	return clave;
}

function invalidarVeredictos(salida: string, anon: string) {
	const cache = join(salida, 'juicios-vlm');
	if (!existsSync(cache)) return;
	for (const juez of readdirSync(cache)) {
		const dir = join(cache, juez);
		for (const f of readdirSync(dir)) if (f.replace(/\.json(\.tmp)?$/, '').split('-').includes(anon)) rmSync(join(dir, f), {force: true});
	}
}

const TODO_EMPATE = () => Object.fromEntries(CRITERIOS.map((c) => [c, 'empate'])) as Veredicto;

// si un orden falló se usa el otro; si fallaron los dos, empate
export function combinarParcial(ab: Veredicto | null, ba: Veredicto | null): Veredicto {
	if (ab && ba) return combinarOrdenes(ab, ba);
	if (ab) return ab;
	if (ba) return invertirTodo(ba);
	return TODO_EMPATE();
}

function invertirTodo(v: Veredicto): Veredicto {
	const r = {} as Veredicto;
	for (const c of CRITERIOS) r[c] = v[c] === 'A' ? 'B' : v[c] === 'B' ? 'A' : 'empate';
	return r;
}

type Guardado = Juicio & {costoUsd: number; completo: boolean};

// copias con nombres neutros en una carpeta propia: el juez tiene Read y no debe ver rutas junto a clave.json
function copiar(a: Imagenes, b: Imagenes, dir: string): [Imagenes, Imagenes] {
	mkdirSync(dir, {recursive: true});
	const c = (origen: string, nombre: string) => {
		const destino = join(dir, nombre);
		copyFileSync(origen, destino);
		return destino;
	};
	return [
		{grilla: c(a.grilla, 'a-grilla.png'), silueta: c(a.silueta, 'a-silueta.png')},
		{grilla: c(b.grilla, 'b-grilla.png'), silueta: c(b.silueta, 'b-silueta.png')},
	];
}

async function juzgarOrden(juez: string, a: Imagenes, b: Imagenes, tema: string) {
	const dir = mkdtempSync(join(tmpdir(), 'lego-lab-exp01-juez-'));
	try {
		const [ia, ib] = copiar(a, b, dir);
		return await juzgarPar(juez, ia, ib, tema, dir);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
}

export async function juzgarTodo(juez: string, op: OpcionesJuicio = {}): Promise<void> {
	const salida = op.salida ?? SALIDA;
	const concurrencia = op.concurrencia ?? CONCURRENCIA;
	// los modelos salen de ciego/, sin leer la clave
	const ciego = join(salida, 'ciego');
	const ids = readdirSync(ciego, {withFileTypes: true}).filter((d) => d.isDirectory()).map((d) => d.name).sort();
	const img = (a: string): Imagenes => ({grilla: join(ciego, a, `${a}-grilla.png`), silueta: join(ciego, a, `${a}-silueta.png`)});
	// una carpeta a medio hacer o de otra versión de la clave juzgaría la imagen equivocada
	const incompletas = ids.filter((a) => !existsSync(join(ciego, a, 'fuente.json')) || !existsSync(img(a).grilla) || !existsSync(img(a).silueta));
	if (incompletas.length) throw new Error(`juzgarTodo: carpetas de ciego/ sin fuente.json o sin imágenes: ${incompletas.join(', ')}. Correr anonimizar antes.`);
	const cache = join(salida, 'juicios-vlm', juez.replace(/[^A-Za-z0-9._-]/g, '_'));
	mkdirSync(cache, {recursive: true});
	const pares: [string, string][] = [];
	for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pares.push([ids[i]!, ids[j]!]);
	const archivo = ([a, b]: [string, string]) => join(cache, `${a}-${b}.json`);
	const leer = (p: [string, string]): Guardado | null => {
		try {
			return JSON.parse(readFileSync(archivo(p), 'utf8'));
		} catch {
			return null;
		}
	};
	// un par incompleto (algún orden sin veredicto) se reintenta en la próxima corrida
	const pendientes = pares.filter((p) => !leer(p)?.completo);
	const tema = op.tema ?? TEMA_ARBOL;
	let siguiente = 0;
	let hechos = pares.length - pendientes.length;
	const trabajador = async () => {
		while (siguiente < pendientes.length) {
			const p = pendientes[siguiente++]!;
			const [a, b] = p;
			const ab = await juzgarOrden(juez, img(a), img(b), tema);
			const ba = await juzgarOrden(juez, img(b), img(a), tema);
			const j: Guardado = {a, b, ab: ab.veredicto, ba: ba.veredicto, combinado: combinarParcial(ab.veredicto, ba.veredicto), costoUsd: ab.costoUsd + ba.costoUsd, completo: !!(ab.veredicto && ba.veredicto)};
			const tmp = archivo(p) + '.tmp';
			writeFileSync(tmp, JSON.stringify(j));
			renameSync(tmp, archivo(p));
			console.log(`juicio ${++hechos}/${pares.length} ${a}-${b}${j.completo ? '' : ' (incompleto)'}`);
		}
	};
	await Promise.all(Array.from({length: Math.min(concurrencia, pendientes.length)}, trabajador));
	const lineas = pares.map((p) => {
		const g = leer(p)!;
		return JSON.stringify({a: g.a, b: g.b, ab: g.ab, ba: g.ba, combinado: g.combinado});
	});
	writeFileSync(join(salida, 'juicios-vlm.jsonl'), lineas.join('\n') + (lineas.length ? '\n' : ''));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
	const [cmd, juez] = process.argv.slice(2);
	if (cmd === 'anonimizar') console.log(Object.keys(await anonimizar()).length, 'modelos anonimizados');
	else if (cmd === 'juzgar' && juez) {
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
		await juzgarTodo(juez, {concurrencia});
	}
	else if (cmd === 'pagina') console.log(generarPaginaHumano());
	else {
		console.error('uso: juicio.ts anonimizar | juzgar <juez> | pagina');
		process.exit(2);
	}
}
