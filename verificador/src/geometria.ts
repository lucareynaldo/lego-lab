// Triángulos de cada archivo LDraw en su propio sistema de coordenadas (líneas 3 y 4, con
// sub-archivos resueltos recursivamente). Se cachea por archivo: las primitivas se reutilizan mucho.

import {Biblioteca, parsearReferencia} from './ldraw.ts';
import type {Caja, Transform, Vec3} from './matematica.ts';
import {aplicar, cajaVacia, expandirCaja} from './matematica.ts';

// Triángulos en coordenadas del ensamble: Float32 alcanza (precisión ~0,001 LDU) y ocupa la mitad.
export type Tris = Float32Array | Float64Array;

export type Malla = {
	readonly tris: Float32Array; // 9 valores por triángulo (Float32 alcanza y ocupa la mitad)
	// Por triángulo: 1 si su orientación es conocida (BFC certificado): los vértices van en sentido
	// antihorario vistos desde afuera. 0 si el archivo no está certificado.
	readonly orientados: Uint8Array;
	caja: Caja;
	area: number;
};

type Triangulos = {tris: Float32Array; orientados: Uint8Array};
const cache = new Map<string, Triangulos>();

const determinante = (r: number[]) =>
	r[0] * (r[4] * r[8] - r[5] * r[7]) - r[1] * (r[3] * r[8] - r[5] * r[6]) + r[2] * (r[3] * r[7] - r[4] * r[6]);

// Invierte el sentido de los triángulos [desde, hasta) (intercambia el segundo y el tercer vértice).
function invertir(tris: Float32Array, desde: number, hasta: number) {
	for (let i = desde; i < hasta; i += 9)
		for (let k = 0; k < 3; k++) {
			const x = tris[i + 3 + k];
			tris[i + 3 + k] = tris[i + 6 + k];
			tris[i + 6 + k] = x;
		}
}

// Triángulos con la orientación de BFC (Back Face Culling de LDraw): un archivo certificado declara
// en qué sentido van sus polígonos (CCW por defecto, o CW), y cada referencia puede invertirse con
// INVERTNEXT o con una matriz de determinante negativo (espejo). Un archivo no certificado deja sin
// orientación sus polígonos y todo lo que referencia.
function triangulosDe(bib: Biblioteca, nombre: string, pila: Set<string>): Triangulos {
	const clave = bib.clave(nombre);
	const guardado = cache.get(clave);
	if (guardado) return guardado;
	const archivo = bib.archivo(nombre);
	if (!archivo || pila.has(nombre)) return {tris: new Float32Array(0), orientados: new Uint8Array(0)};
	pila.add(nombre);

	const partes: number[] = [];
	const sentidoPartes: number[] = []; // por triángulo: 1 CCW, -1 CW, 0 sin certificar
	const hijos: {tr: Transform; t: Triangulos; invertido: boolean}[] = [];
	let certificado = false;
	let cw = false;
	let invertirSiguiente = false;
	archivo.lineas.forEach((l, i) => {
		const t = l.trim();
		const tipo = t[0];
		if (tipo === '0') {
			const m = t.match(/^0\s+BFC\s+(.*)$/);
			if (!m) return;
			const p = m[1].split(/\s+/);
			if (p.includes('CERTIFY')) certificado = true;
			if (p.includes('NOCERTIFY')) certificado = false;
			if (p.includes('CW')) cw = true;
			if (p.includes('CCW')) cw = false;
			if (p.includes('INVERTNEXT')) invertirSiguiente = true;
		} else if (tipo === '3' || tipo === '4') {
			const c = t.split(/\s+/).slice(2).map(Number);
			const sentido = certificado ? (cw ? -1 : 1) : 0;
			if (tipo === '3' && c.length >= 9) {
				partes.push(...c.slice(0, 9));
				sentidoPartes.push(sentido);
			}
			if (tipo === '4' && c.length >= 12) {
				partes.push(...c.slice(0, 9), ...c.slice(0, 3), ...c.slice(6, 12));
				sentidoPartes.push(sentido, sentido);
			}
		} else if (tipo === '1') {
			const ref = parsearReferencia(t, i + 1);
			if (ref) hijos.push({tr: ref.transform, t: triangulosDe(bib, ref.archivo, pila), invertido: invertirSiguiente !== determinante(ref.transform.r) < 0});
			invertirSiguiente = false;
		}
	});
	pila.delete(nombre);

	let total = partes.length;
	for (const h of hijos) total += h.t.tris.length;
	const tris = new Float32Array(total);
	const orientados = new Uint8Array(total / 9);
	tris.set(partes);
	sentidoPartes.forEach((s, k) => {
		if (s === -1) invertir(tris, k * 9, k * 9 + 9);
		orientados[k] = s === 0 ? 0 : 1;
	});
	let o = partes.length;
	for (const h of hijos) {
		transformarTris(h.t.tris, h.tr, tris, o);
		if (h.invertido) invertir(tris, o, o + h.t.tris.length);
		// Si este archivo no está certificado, lo que referencia tampoco cuenta como orientado.
		if (certificado) orientados.set(h.t.orientados, o / 9);
		o += h.t.tris.length;
	}
	const resultado = {tris, orientados};
	// Solo se guardan las primitivas (studs, cilindros: chicas y usadas en miles de piezas). Las piezas
	// completas quedan en el caché de mallas; las sub-piezas intermedias se recalculan si hace falta.
	if (archivo.tipo.includes('Primitive')) cache.set(clave, resultado);
	return resultado;
}

export function transformarTris(origen: Tris, tr: Transform, destino: Tris, offset = 0) {
	const r = tr.r;
	const t = tr.t;
	for (let i = 0; i < origen.length; i += 3) {
		const x = origen[i];
		const y = origen[i + 1];
		const z = origen[i + 2];
		destino[offset + i] = r[0] * x + r[1] * y + r[2] * z + t[0];
		destino[offset + i + 1] = r[3] * x + r[4] * y + r[5] * z + t[1];
		destino[offset + i + 2] = r[6] * x + r[7] * y + r[8] * z + t[2];
	}
}

// De cada pieza se guardan siempre la caja y la superficie (livianas). Los triángulos de las piezas
// de la biblioteca van a un caché acotado y se recalculan si hace falta: una corrida larga toca miles
// de piezas distintas y guardarlos todos crece sin límite. Los de piezas embebidas quedan con la malla
// (se borran al liberar el modelo).
const mallas = new Map<string, Malla>();
const trisPiezas = new Map<string, Triangulos>();
const TRIS_PIEZAS_MAX = 600;
const bibliotecas = new Map<string, Biblioteca>(); // una por carpeta de biblioteca, sin modelo cargado

function trisDePieza(dirLDraw: string, dirSombra: string, nombre: string): Triangulos {
	const guardados = trisPiezas.get(nombre);
	if (guardados) {
		trisPiezas.delete(nombre);
		trisPiezas.set(nombre, guardados);
		return guardados;
	}
	// Se recalcula con una biblioteca sin modelo: así el caché no retiene la Biblioteca de un modelo.
	const k = dirLDraw + '|' + dirSombra;
	let base = bibliotecas.get(k);
	if (!base) bibliotecas.set(k, (base = new Biblioteca(dirLDraw, dirSombra)));
	const tris = triangulosDe(base, nombre, new Set());
	trisPiezas.set(nombre, tris);
	if (trisPiezas.size > TRIS_PIEZAS_MAX) trisPiezas.delete(trisPiezas.keys().next().value!);
	return tris;
}

export function mallaDe(bib: Biblioteca, nombre: string): Malla {
	const clave = bib.clave(nombre);
	const guardada = mallas.get(clave);
	if (guardada) return guardada;
	const embebida = clave !== nombre;
	// El getter guarda solo las rutas: si guardara la biblioteca del modelo, retendría el modelo entero.
	const {dirLDraw, dirSombra} = bib;
	const propios = embebida ? triangulosDe(bib, nombre, new Set()) : trisDePieza(dirLDraw, dirSombra, nombre);
	const tris = propios.tris;
	const caja = cajaVacia();
	let area = 0;
	for (let i = 0; i < tris.length; i += 9) {
		for (let k = 0; k < 9; k += 3) expandirCaja(caja, [tris[i + k], tris[i + k + 1], tris[i + k + 2]]);
		const ux = tris[i + 3] - tris[i];
		const uy = tris[i + 4] - tris[i + 1];
		const uz = tris[i + 5] - tris[i + 2];
		const vx = tris[i + 6] - tris[i];
		const vy = tris[i + 7] - tris[i + 1];
		const vz = tris[i + 8] - tris[i + 2];
		area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
	}
	const malla: Malla = embebida
		? {tris, orientados: propios.orientados, caja, area}
		: {
				caja,
				area,
				get tris() {
					return trisDePieza(dirLDraw, dirSombra, nombre).tris;
				},
				get orientados() {
					return trisDePieza(dirLDraw, dirSombra, nombre).orientados;
				},
			};
	mallas.set(clave, malla);
	return malla;
}

// Triángulos de la malla llevados a coordenadas del ensamble. Una pieza ubicada con una matriz espejo
// (determinante negativo) invierte su orientación: se corrige para que sigan antihorarios desde afuera.
export function trisEnMundo(m: Malla, tr: Transform): Float32Array {
	const out = new Float32Array(m.tris.length);
	transformarTris(m.tris, tr, out);
	if (determinante(tr.r) < 0) invertir(out, 0, out.length);
	return out;
}

export function cajaEnMundo(m: Malla, tr: Transform): Caja {
	const c = cajaVacia();
	for (const x of [m.caja.min[0], m.caja.max[0]])
		for (const y of [m.caja.min[1], m.caja.max[1]])
			for (const z of [m.caja.min[2], m.caja.max[2]]) expandirCaja(c, aplicar(tr, [x, y, z] as Vec3));
	return c;
}

// Tamaño de los cachés de geometría (para medir memoria en el banco de pruebas).
export function estadisticasGeometria() {
	let bytes = 0;
	let embebidos = 0;
	for (const [k, t] of cache) {
		bytes += t.tris.byteLength + t.orientados.byteLength;
		if (k.includes('|')) embebidos++;
	}
	return {archivos: cache.size, embebidos, mb: +(bytes / 1e6).toFixed(1), mallas: mallas.size};
}

// Borra lo que un modelo dejó en los cachés globales: sus piezas embebidas (clave "id|nombre").
export function liberarGeometria(idBiblioteca: number) {
	const prefijo = `${idBiblioteca}|`;
	for (const k of cache.keys()) if (k.startsWith(prefijo)) cache.delete(k);
	for (const k of mallas.keys()) if (k.startsWith(prefijo)) mallas.delete(k);
}
