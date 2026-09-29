// Banco de mutaciones: mide si el verificador DETECTA errores (el banco de sets oficiales solo mide
// falsos positivos). Toma modelos oficiales que hoy pasan sin errores, les mete un defecto cuya
// respuesta correcta se conoce y mira si algún hallazgo apunta a la pieza tocada.
//
// Uso: node --no-warnings src/mutaciones.ts [--modelos 40] [--por-tipo 3] [--salida ../.cache/mutaciones/<nombre>]
//        [--lista sets.txt]  (si no, elige del resultado de la última calibración: modelos sin errores)
//
// Mutaciones (una por mutante):
// - duplicado-exacto: copia una pieza en el mismo lugar. Dos piezas en el mismo espacio: error.
// - encimado: copia una pieza corrida 6 LDU de costado. Se atraviesan: error.
// - levantada: sube una pieza 24 LDU (un ladrillo). Choca con lo de arriba o queda suelta: error.
// - corrida: corre una pieza medio stud (10 LDU). Choca o deja de encastrar: error, o al menos el
//   aviso de que queda apoyada sin conexión.
// - adelantada: pasa una pieza al paso 1 de su submodelo. El modelo terminado es el mismo; lo que
//   cambia es el orden, y a veces la pieza sí puede ir primero: es informativa.

import {appendFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Biblioteca, esPieza, normalizarNombre} from './ldraw.ts';
import {liberarModelo} from './memoria.ts';
import {verificar, type Hallazgo} from './verificar.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '../..');
const args = process.argv.slice(2);
const opcion = (n: string, d?: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const N_MODELOS = Number(opcion('modelos', '40'));
const POR_TIPO = Number(opcion('por-tipo', '3'));
const salida = opcion('salida', join(raiz, '.cache/mutaciones/m1'))!;
mkdirSync(salida, {recursive: true});

type Tipo = 'duplicado-exacto' | 'encimado' | 'levantada' | 'corrida' | 'adelantada';
const TIPOS: Tipo[] = ['duplicado-exacto', 'encimado', 'levantada', 'corrida', 'adelantada'];
// Avisos que cuentan como detección: señalan un problema real de la pieza, aunque no bloqueen.
const AVISOS_GEOMETRIA = new Set(['apoyado-sin-conexion', 'roce', 'mal-nivelado']);
const AVISOS_ORDEN = new Set(['orden-sin-camino', 'requiere-subarmado', 'subarmado-no-entra', 'suelto-varios-pasos', 'sostener-un-paso', 'camino-dudoso']);

// --- Azar reproducible ---
const fnv = (s: string) => {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
	return h;
};
function azar(semilla: string) {
	let a = fnv(semilla);
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// --- MPD como lista de archivos ---
type ArchivoMpd = {cabecera: string; nombre: string; lineas: string[]};
function leerMpd(ruta: string): ArchivoMpd[] {
	const archivos: ArchivoMpd[] = [];
	for (const l of readFileSync(ruta, 'latin1').replace(/\r\n?/g, '\n').split('\n')) {
		if (l.startsWith('0 FILE ')) archivos.push({cabecera: l, nombre: normalizarNombre(l.slice(7)), lineas: []});
		else if (l.startsWith('0 NOFILE')) continue;
		else if (archivos.length > 0) archivos.at(-1)!.lineas.push(l);
	}
	return archivos;
}
const escribirMpd = (archivos: ArchivoMpd[]) => archivos.map((a) => [a.cabecera, ...a.lineas, '0 NOFILE'].join('\n')).join('\n') + '\n';
const esPaso = (l: string) => /^0\s+(STEP|ROTSTEP)\b/.test(l.trim());

// Mueve la referencia `l` (línea tipo 1) en `d`, en las coordenadas de su archivo.
function trasladar(l: string, d: [number, number, number]): string {
	const c = l.trim().split(/\s+/);
	for (let i = 0; i < 3; i++) c[2 + i] = String(Number(c[2 + i]) + d[i]);
	return c.join(' ');
}

// --- Selección de modelos ---
function elegirModelos(): string[] {
	const lista = opcion('lista');
	if (lista) return readFileSync(lista, 'utf8').split(/\s+/).filter(Boolean);
	const particion = new Map(
		readFileSync(join(raiz, 'referencias/particion.csv'), 'utf8')
			.split('\n')
			.slice(1)
			.map((l) => l.trim().split(',') as [string, string]),
	);
	const resultados = readFileSync(join(raiz, '.cache/lote/calibracion-7/resultados.jsonl'), 'utf8')
		.trim()
		.split('\n')
		.map((l) => JSON.parse(l));
	return resultados
		.filter((r) => particion.get(r.modelo) === 'calibracion' && r.errores === 0 && r.piezas >= 50 && r.piezas <= 600)
		.map((r) => r.modelo as string)
		.sort((a, b) => fnv(a) - fnv(b))
		.slice(0, N_MODELOS);
}

// --- Verificación ---
function verificarTexto(texto: string, nombre: string): Hallazgo[] {
	const ruta = join(salida, 'mutante.mpd');
	writeFileSync(ruta, texto, 'latin1');
	const bib = new Biblioteca(join(raiz, '.cache/ldraw'), join(raiz, '.cache/LDCadShadowLibrary-main'));
	const principal = bib.cargarModelo(ruta, nombre);
	try {
		return verificar(bib, principal, {}).hallazgos;
	} finally {
		liberarModelo(bib);
	}
}

type Resultado = {modelo: string; tipo: Tipo; pieza: string; archivo: string; deteccion: 'error' | 'aviso' | 'no'; reglas: string[]; otrosErrores: number};

const modelos = elegirModelos();
const registro = join(salida, 'resultados.jsonl');
writeFileSync(registro, '');
console.log(`${modelos.length} modelos, hasta ${POR_TIPO} mutantes por tipo → ${salida}`);

for (const modelo of modelos) {
	const ruta = join(raiz, '.cache/omr', `${modelo}.mpd`);
	const original = leerMpd(ruta);
	if (original.length === 0) continue;
	const nombres = new Set(original.map((a) => a.nombre));
	const base = verificarTexto(escribirMpd(original), original[0].nombre);
	if (base.some((h) => h.severidad === 'error')) {
		console.log(`${modelo}: tiene errores sin mutar, se saltea`);
		continue;
	}
	const bib = new Biblioteca(join(raiz, '.cache/ldraw'), join(raiz, '.cache/LDCadShadowLibrary-main'));
	// Candidatas: referencias a piezas (no a submodelos del mismo archivo).
	const candidatas: {a: number; i: number}[] = [];
	original.forEach((arch, a) =>
		arch.lineas.forEach((l, i) => {
			const c = l.trim().split(/\s+/);
			if (c[0] !== '1' || c.length < 15) return;
			const n = normalizarNombre(c.slice(14).join(' '));
			if (nombres.has(n)) return;
			const f = bib.archivo(n);
			if (f && esPieza(f)) candidatas.push({a, i});
		}),
	);
	for (const tipo of TIPOS) {
		const r = azar(`${modelo}|${tipo}`);
		const elegidas = [...candidatas].sort(() => r() - 0.5).slice(0, POR_TIPO * 3);
		let hechos = 0;
		for (const {a, i} of elegidas) {
			if (hechos >= POR_TIPO) break;
			const mut = original.map((x) => ({...x, lineas: [...x.lineas]}));
			const lineas = mut[a].lineas;
			const l = lineas[i];
			let marcadas: number[]; // índices (0-based) de las líneas cuya pieza tiene que aparecer
			if (tipo === 'duplicado-exacto' || tipo === 'encimado') {
				lineas.splice(i + 1, 0, tipo === 'encimado' ? trasladar(l, [6, 0, 0]) : l);
				marcadas = [i, i + 1];
			} else if (tipo === 'levantada') {
				lineas[i] = trasladar(l, [0, -24, 0]);
				marcadas = [i];
			} else if (tipo === 'corrida') {
				lineas[i] = trasladar(l, [10, 0, 0]);
				marcadas = [i];
			} else {
				// adelantada: al paso 1 (antes del primer STEP), si no estaba ya ahí.
				const primerPaso = lineas.findIndex(esPaso);
				if (primerPaso < 0 || i < primerPaso) continue;
				lineas.splice(i, 1);
				lineas.splice(primerPaso, 0, l);
				marcadas = [primerPaso];
			}
			hechos++;
			const origenes = new Set(marcadas.map((m) => `${mut[a].nombre}:${m + 1}`));
			const hallazgos = verificarTexto(escribirMpd(mut), mut[0].nombre);
			const tocan = hallazgos.filter((h) => (h.piezas ?? []).some((p) => origenes.has(p.toLowerCase())));
			const avisos = tipo === 'adelantada' ? AVISOS_ORDEN : AVISOS_GEOMETRIA;
			const errores = tocan.filter((h) => h.severidad === 'error');
			const deteccion = errores.length > 0 ? 'error' : tocan.some((h) => avisos.has(h.regla)) ? 'aviso' : 'no';
			const res: Resultado = {
				modelo,
				tipo,
				pieza: `${mut[a].nombre}:${marcadas[0] + 1}`,
				archivo: l.trim().split(/\s+/).slice(14).join(' '),
				deteccion,
				reglas: [...new Set(tocan.map((h) => h.regla))],
				otrosErrores: hallazgos.filter((h) => h.severidad === 'error' && !tocan.includes(h)).length,
			};
			appendFileSync(registro, JSON.stringify(res) + '\n');
		}
	}
	liberarModelo(bib);
	console.log(`${modelo}: listo`);
}

// --- Resumen ---
const todos: Resultado[] = readFileSync(registro, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const lineasResumen = ['| Mutación | Casos | Detecta con error | Solo aviso | No detecta |', '|---|---|---|---|---|'];
for (const tipo of TIPOS) {
	const t = todos.filter((x) => x.tipo === tipo);
	if (t.length === 0) continue;
	const pct = (n: number) => `${n} (${((100 * n) / t.length).toFixed(0)} %)`;
	lineasResumen.push(`| ${tipo} | ${t.length} | ${pct(t.filter((x) => x.deteccion === 'error').length)} | ${pct(t.filter((x) => x.deteccion === 'aviso').length)} | ${pct(t.filter((x) => x.deteccion === 'no').length)} |`);
}
const resumen = lineasResumen.join('\n');
writeFileSync(join(salida, 'resumen.md'), `# Banco de mutaciones\n\n${todos.length} mutantes en ${new Set(todos.map((x) => x.modelo)).size} modelos.\n\n${resumen}\n`);
console.log('\n' + resumen);
