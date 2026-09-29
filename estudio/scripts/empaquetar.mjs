// Empaqueta un modelo LDraw (.ldr/.mpd) con todas las piezas, subpiezas y primitivas
// que usa, en un único .mpd que LDrawLoader de three.js carga sin tocar la biblioteca.
//
// Uso: node scripts/empaquetar.mjs <modelo.mpd> [salida.mpd]
// Biblioteca: ../.cache/ldraw (o la variable LDRAW_DIR).

import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const LDRAW = process.env.LDRAW_DIR ?? resolve(aqui, '../../.cache/ldraw');
// Orden de búsqueda de la especificación LDraw: parts/, p/, models/ (s/ y 48/ vienen en el nombre).
const CARPETAS = ['parts', 'p', 'models'];

const normalizar = (nombre) => nombre.trim().replace(/\\/g, '/').toLowerCase();

const leer = (ruta) => readFileSync(ruta, 'latin1').replace(/\r\n?/g, '\n');

// Separa un .mpd en archivos embebidos {nombre → líneas}. Un .ldr simple es un único archivo.
function separarMpd(texto, nombrePorDefecto) {
	const archivos = new Map();
	let actual = null;
	for (const linea of texto.split('\n')) {
		if (linea.startsWith('0 FILE ')) {
			actual = normalizar(linea.slice(7));
			archivos.set(actual, []);
			continue;
		}
		if (linea.startsWith('0 NOFILE')) {
			actual = null;
			continue;
		}
		if (actual === null) {
			if (archivos.size > 0) continue;
			actual = normalizar(nombrePorDefecto);
			archivos.set(actual, []);
		}
		archivos.get(actual).push(linea);
	}
	return archivos;
}

// Referencias de tipo 1: "1 color x y z a b c d e f g h i archivo".
function referencias(lineas) {
	const refs = [];
	for (const linea of lineas) {
		const t = linea.trim();
		if (!t.startsWith('1 ')) continue;
		const campos = t.split(/\s+/);
		if (campos.length < 15) continue;
		refs.push(normalizar(campos.slice(14).join(' ')));
	}
	return refs;
}

function buscarEnBiblioteca(nombre) {
	for (const carpeta of CARPETAS) {
		const ruta = join(LDRAW, carpeta, nombre);
		if (existsSync(ruta)) return ruta;
	}
	return null;
}

// LDrawLoader reescribe las referencias "s/…" como "parts/s/…" y "48/…" como "p/48/…"
// antes de buscarlas, así que los archivos embebidos tienen que llamarse igual.
const nombreParaLoader = (nombre) =>
	nombre.startsWith('s/') ? `parts/${nombre}` : nombre.startsWith('48/') ? `p/${nombre}` : nombre;

// ROTSTEP es un STEP con rotación de cámara: el loader solo reconoce STEP.
const normalizarPasos = (lineas) =>
	lineas.map((l) => (l.trim().startsWith('0 ROTSTEP') ? '0 STEP' : l));

export function empaquetar(rutaModelo) {
	const embebidos = separarMpd(leer(rutaModelo), basename(rutaModelo));
	const principal = embebidos.keys().next().value;
	const biblioteca = new Map();
	const faltantes = new Set();

	const pendientes = [...embebidos.values()].flatMap(referencias);
	while (pendientes.length > 0) {
		const nombre = pendientes.pop();
		if (embebidos.has(nombre) || biblioteca.has(nombre) || faltantes.has(nombre)) continue;
		const ruta = buscarEnBiblioteca(nombre);
		if (!ruta) {
			faltantes.add(nombre);
			continue;
		}
		const lineas = leer(ruta).split('\n');
		biblioteca.set(nombre, lineas);
		pendientes.push(...referencias(lineas));
	}

	const definiciones = leer(join(LDRAW, 'LDConfig.ldr'))
		.split('\n')
		.filter((l) => l.startsWith('0 !COLOUR'));

	const salida = [];
	const [primero, ...resto] = [...embebidos.entries()];
	// El archivo principal va primero, con las definiciones de color en su cabecera.
	salida.push(`0 FILE ${primero[0]}`);
	const cabecera = primero[1].findIndex((l) => l.trim().startsWith('1 ') || l.trim() === '0 STEP');
	const corte = cabecera === -1 ? primero[1].length : cabecera;
	salida.push(...primero[1].slice(0, corte), ...definiciones, ...normalizarPasos(primero[1].slice(corte)));
	for (const [nombre, lineas] of resto) salida.push(`0 FILE ${nombreParaLoader(nombre)}`, ...normalizarPasos(lineas));
	for (const [nombre, lineas] of biblioteca) salida.push(`0 FILE ${nombreParaLoader(nombre)}`, ...lineas);

	return {
		texto: salida.join('\n') + '\n',
		principal,
		embebidos: embebidos.size,
		deBiblioteca: biblioteca.size,
		faltantes: [...faltantes],
	};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [entrada, salidaArg] = process.argv.slice(2);
	if (!entrada) {
		console.error('Uso: node scripts/empaquetar.mjs <modelo.mpd> [salida.mpd]');
		process.exit(1);
	}
	const r = empaquetar(entrada);
	const salida = salidaArg ?? join(aqui, '../public/modelos', basename(entrada).replace(/\.(mpd|ldr)$/i, '') + '.packed.mpd');
	mkdirSync(dirname(salida), {recursive: true});
	writeFileSync(salida, r.texto, 'latin1');
	console.log(
		`${basename(entrada)} → ${salida}\n` +
			`  submodelos: ${r.embebidos} · archivos de biblioteca: ${r.deBiblioteca} · ${(r.texto.length / 1024).toFixed(0)} KB`,
	);
	if (r.faltantes.length > 0) {
		console.error(`  FALTAN ${r.faltantes.length}: ${r.faltantes.join(', ')}`);
		process.exitCode = 2;
	}
}
