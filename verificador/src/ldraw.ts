// Lectura de archivos LDraw: biblioteca oficial, archivos embebidos en un .mpd, referencias y pasos.

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {Mat3, Transform, Vec3} from './matematica.ts';

export type Archivo = {
	nombre: string; // normalizado: minúsculas y "/"
	titulo: string;
	tipo: string; // valor de !LDRAW_ORG ("Part", "Subpart", "Model", ...)
	// En los archivos de la biblioteca se lee del disco cada vez: guardar el texto de miles de archivos
	// ocupa decenas de MB y, una vez calculadas su geometría y sus conectores, casi no se vuelve a usar.
	readonly lineas: string[];
	embebido: boolean;
};

export type Referencia = {
	color: number;
	transform: Transform;
	archivo: string; // normalizado
	linea: number; // número de línea (1-based) dentro de su archivo
};

export type Paso = {
	refs: Referencia[];
	// ROTSTEP: el constructor gira el modelo antes de este paso.
	rotacion: Vec3 | null;
};

export const normalizarNombre = (n: string) => n.trim().replace(/\\/g, '/').toLowerCase();

const leerTexto = (ruta: string) => readFileSync(ruta, 'latin1').replace(/\r\n?/g, '\n');

// Correcciones de datos de la biblioteca. Los alias 32531 y 32532 (Technic Brick 4×6 y 6×8 con centro
// abierto, "~Moved to …a" desde la actualización 2023-03) agregan una rotación de 90° que no coincide
// con cómo están modelados los archivos del OMR que los usan: con la rotación, el ladrillo sobresale un
// stud por lado y se superpone con sus vecinos. Medido (29-09) en los 34 modelos del OMR que los usan:
// referenciando la pieza nueva sin la rotación, los errores bajan en los 34 y no suben en ninguno
// (76161: de 206 colisiones y superposiciones a 7). Ver verificador/BANCO.md.
const CORRECCIONES = new Map([
	['32531.dat', '32531a.dat'],
	['32532.dat', '32532a.dat'],
]);

export function parsearReferencia(linea: string, numero: number): Referencia | null {
	const campos = linea.trim().split(/\s+/);
	if (campos[0] !== '1' || campos.length < 15) return null;
	const n = campos.slice(1, 14).map(Number);
	if (n.some(Number.isNaN)) return null;
	const archivo = normalizarNombre(campos.slice(14).join(' '));
	return {
		color: n[0],
		transform: {t: [n[1], n[2], n[3]], r: n.slice(4, 13) as Mat3},
		archivo: CORRECCIONES.get(archivo) ?? archivo,
		linea: numero,
	};
}

function crearArchivo(nombre: string, lineas: string[], embebido: boolean): Archivo {
	const titulo = (lineas.find((l) => l.startsWith('0 ')) ?? '').slice(2).trim();
	const org = lineas.find((l) => l.startsWith('0 !LDRAW_ORG'));
	const tipo = org ? org.split(/\s+/)[2] ?? '' : '';
	return {nombre, titulo, tipo, lineas, embebido};
}

// Archivo de la biblioteca: guarda título y tipo; las líneas se leen del disco cuando se piden.
function archivoDeBiblioteca(nombre: string, ruta: string): Archivo {
	const {titulo, tipo} = crearArchivo(nombre, leerTexto(ruta).split('\n'), false);
	return {
		nombre,
		titulo,
		tipo,
		embebido: false,
		get lineas() {
			return leerTexto(ruta).split('\n');
		},
	};
}

const CARPETAS = ['parts', 'p', 'models'];

// Archivos de la biblioteca LDraw y de la shadow library: se leen una sola vez por proceso y se
// comparten entre modelos (el banco de pruebas procesa cientos de modelos en el mismo proceso).
const cacheBiblioteca = new Map<string, Archivo | null>();
const cacheSombra = new Map<string, string[] | null>();
let siguienteId = 1;

export class Biblioteca {
	private cache = cacheBiblioteca;
	private embebidos = new Map<string, Archivo>();
	private cacheSombra = cacheSombra;
	readonly id = siguienteId++;
	readonly colores = new Map<number, {nombre: string; rgb: string}>();
	readonly dirLDraw: string;
	readonly dirSombra: string;

	constructor(dirLDraw: string, dirSombra: string) {
		this.dirLDraw = dirLDraw;
		this.dirSombra = dirSombra;
		for (const l of leerTexto(join(dirLDraw, 'LDConfig.ldr')).split('\n')) {
			const m = l.match(/^0 !COLOUR\s+(\S+)\s+CODE\s+(\d+)\s+VALUE\s+#([0-9A-Fa-f]{6})/);
			if (m) this.colores.set(Number(m[2]), {nombre: m[1], rgb: m[3]});
		}
	}

	// Carga un .mpd/.ldr: registra sus archivos embebidos y devuelve el nombre del principal.
	cargarModelo(ruta: string, nombrePorDefecto: string): string {
		let actual: string | null = null;
		let lineas: string[] = [];
		let principal: string | null = null;
		const cerrar = () => {
			if (actual !== null) this.embebidos.set(actual, crearArchivo(actual, lineas, true));
		};
		for (const l of leerTexto(ruta).split('\n')) {
			if (l.startsWith('0 FILE ')) {
				cerrar();
				actual = normalizarNombre(l.slice(7));
				principal ??= actual;
				lineas = [];
				continue;
			}
			if (l.startsWith('0 NOFILE')) {
				cerrar();
				actual = null;
				continue;
			}
			if (actual === null) {
				if (principal !== null) continue;
				actual = principal = normalizarNombre(nombrePorDefecto);
				lineas = [];
			}
			lineas.push(l);
		}
		cerrar();
		return principal!;
	}

	// Clave para cachés globales (geometría, conectores): los archivos embebidos son de este modelo y
	// otro modelo puede tener uno distinto con el mismo nombre.
	clave(nombre: string): string {
		return this.embebidos.has(nombre) ? `${this.id}|${nombre}` : nombre;
	}

	archivo(nombre: string): Archivo | null {
		const emb = this.embebidos.get(nombre);
		if (emb) return emb;
		if (this.cache.has(nombre)) return this.cache.get(nombre)!;
		let resultado: Archivo | null = null;
		for (const c of CARPETAS) {
			const ruta = join(this.dirLDraw, c, nombre);
			if (existsSync(ruta)) {
				resultado = archivoDeBiblioteca(nombre, ruta);
				break;
			}
		}
		this.cache.set(nombre, resultado);
		return resultado;
	}

	// Líneas del archivo de la shadow library de LDCad para `nombre` (mismas carpetas que la biblioteca).
	sombra(nombre: string): string[] | null {
		if (this.cacheSombra.has(nombre)) return this.cacheSombra.get(nombre)!;
		let resultado: string[] | null = null;
		for (const c of ['parts', 'p']) {
			const ruta = join(this.dirSombra, c, nombre);
			if (existsSync(ruta)) {
				resultado = leerTexto(ruta).split('\n');
				break;
			}
		}
		this.cacheSombra.set(nombre, resultado);
		return resultado;
	}
}

// Una pieza es cualquier archivo cuyo tipo LDraw sea Part o Shortcut (oficial o no).
// Un .dat embebido sin cabecera también se trata como pieza; todo lo demás es un submodelo.
export function esPieza(a: Archivo): boolean {
	const t = a.tipo.replace(/^Unofficial_/, '');
	if (t === 'Part' || t === 'Shortcut') return true;
	return a.embebido && a.tipo === '' && a.nombre.endsWith('.dat');
}

export const esOficial = (a: Archivo) => !a.embebido && !a.tipo.startsWith('Unofficial');

// Divide las líneas de un modelo en pasos. Ignora las piezas "fantasma" de MLCad (0 GHOST).
export function pasosDe(a: Archivo): Paso[] {
	const pasos: Paso[] = [];
	let actual: Paso = {refs: [], rotacion: null};
	const cerrar = () => {
		if (actual.refs.length > 0) pasos.push(actual);
		actual = {refs: [], rotacion: null};
	};
	a.lineas.forEach((l, i) => {
		const t = l.trim();
		if (t === '0 STEP') return cerrar();
		if (t.startsWith('0 ROTSTEP')) {
			// "0 ROTSTEP x y z [REL|ABS|ADD]" cierra el paso y fija cómo se ve (cómo está girado el
			// modelo) en ese paso. "0 ROTSTEP END" vuelve a la vista normal.
			const campos = t.split(/\s+/);
			actual.rotacion =
				campos[2] !== 'END' && campos.length >= 5 ? [Number(campos[2]), Number(campos[3]), Number(campos[4])] : [0, 0, 0];
			return cerrar();
		}
		const ref = parsearReferencia(t, i + 1);
		if (ref) actual.refs.push(ref);
	});
	cerrar();
	return pasos;
}

// Elemento flexible (cordón, manguera, cadena) generado por LDCad: un submodelo con un camino
// (`!LDCAD CONTENT [type=path]`) cuyas piezas (terminales + segmentos) son físicamente una sola.
export const esFlexible = (a: Archivo) =>
	a.lineas.some((l) => (l.startsWith('0 !LDCAD CONTENT') && l.includes('type=path')) || (l.startsWith('0 !KEYWORDS') && /\bflexible\b/i.test(l)));

// Tamaño de los cachés de archivos (para medir memoria en el banco de pruebas). El texto de los archivos
// de la biblioteca no se guarda (se lee bajo demanda).
export function estadisticasArchivos() {
	return {archivos: cacheBiblioteca.size, sombra: cacheSombra.size};
}
