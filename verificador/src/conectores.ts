// Puntos de conexión de cada pieza, según la shadow library de LDCad (CC BY-SA 4.0).
// Formato: https://wiki.ldraw.org/wiki/Part_Snapping_Language_Extension
//
// Cada forma está orientada según el eje Y de su `ori` y se extiende desde `pos` hacia -Y
// (hacia "arriba" en LDraw). Ejemplo: stud.dat declara un macho "R 6 4" en el origen, y el stud
// ocupa y ∈ [-4, 0]. Una pieza hereda los conectores de todos los sub-archivos que referencia.

import type {Biblioteca} from './ldraw.ts';
import {parsearReferencia} from './ldraw.ts';
import type {Mat3, Transform, Vec3} from './matematica.ts';
import {IDENTIDAD, aplicar, aplicarR, componer, escalasEjes, escalar, normalizar, restar} from './matematica.ts';

export type Seccion = {forma: string; r: number; largo: number};

type Comun = {id: string; grupo: string; base: Vec3; eje: Vec3; largo: number; escala: string};

export type Conector =
	| (Comun & {tipo: 'cil'; genero: 'M' | 'F'; secs: Seccion[]; caps: string})
	| (Comun & {tipo: 'clip'; radio: number})
	| (Comun & {tipo: 'dedo'; radio: number; seq: number[]; generoInicial: 'M' | 'F'})
	| (Comun & {tipo: 'gen'; genero: 'M' | 'F'; alcance: number});

const ARRIBA_LOCAL: Vec3 = [0, -1, 0];

function parametros(linea: string): Record<string, string> {
	const p: Record<string, string> = {};
	for (const m of linea.matchAll(/\[(\w+)=([^\]]*)\]/g)) p[m[1].toLowerCase()] = m[2].trim();
	return p;
}

const numeros = (s: string | undefined) => (s ?? '').split(/\s+/).filter(Boolean).map(Number);

function transformDe(p: Record<string, string>): Transform {
	const pos = numeros(p.pos);
	const ori = numeros(p.ori);
	return {
		t: pos.length === 3 ? (pos as Vec3) : [0, 0, 0],
		r: ori.length === 9 ? (ori as Mat3) : IDENTIDAD.r,
	};
}

// "C 4 C 2 20 20" → desplazamientos (x, 0, z) en el espacio local de la forma.
function grilla(spec: string | undefined): Vec3[] {
	if (!spec) return [[0, 0, 0]];
	const tok = spec.split(/\s+/).filter(Boolean);
	let i = 0;
	const leerEje = () => {
		const centrado = tok[i] === 'C';
		if (centrado) i++;
		return {centrado, n: Number(tok[i++])};
	};
	const ex = leerEje();
	const ez = leerEje();
	const sx = Number(tok[i++]);
	const sz = Number(tok[i++]);
	const valores = (e: {centrado: boolean; n: number}, paso: number) =>
		Array.from({length: e.n}, (_, k) => (e.centrado ? (k - (e.n - 1) / 2) * paso : k * paso));
	const out: Vec3[] = [];
	for (const x of valores(ex, sx)) for (const z of valores(ez, sz)) out.push([x, 0, z]);
	return out;
}

function secciones(spec: string | undefined): Seccion[] {
	const tok = (spec ?? '').split(/\s+/).filter(Boolean);
	const secs: Seccion[] = [];
	for (let i = 0; i + 2 < tok.length; i += 3) secs.push({forma: tok[i], r: Number(tok[i + 1]), largo: Number(tok[i + 2])});
	return secs;
}

// Conectores declarados directamente en una línea SNAP_* (con su grilla ya expandida).
function formasDeLinea(tipo: string, p: Record<string, string>): Conector[] {
	const tr = transformDe(p);
	// Los dedos de bisagra se interpretan siempre centrados en su posición: las dos mitades de una bisagra
	// declaran la misma posición con ejes opuestos, y solo así ocupan el mismo espacio, como en la pieza real.
	const centrado = p.center === 'true' || tipo === 'SNAP_FGR';
	const comun = (largo: number, desplazamiento: Vec3): Comun => {
		const eje = normalizar(aplicarR(tr.r, ARRIBA_LOCAL));
		let base = aplicar(tr, desplazamiento);
		if (centrado) base = restar(base, escalar(eje, largo / 2));
		return {id: p.id ?? '', grupo: p.group ?? '', base, eje, largo, escala: p.scale ?? 'none'};
	};
	const out: Conector[] = [];
	for (const d of grilla(p.grid)) {
		if (tipo === 'SNAP_CYL') {
			const secs = secciones(p.secs);
			const largo = secs.reduce((s, x) => s + x.largo, 0);
			out.push({...comun(largo, d), tipo: 'cil', genero: p.gender === 'F' ? 'F' : 'M', secs, caps: p.caps ?? 'one'});
		} else if (tipo === 'SNAP_CLP') {
			out.push({...comun(Number(p.length ?? 8), d), tipo: 'clip', radio: Number(p.radius ?? 4)});
		} else if (tipo === 'SNAP_FGR') {
			const seq = numeros(p.seq);
			const largo = seq.reduce((s, x) => s + x, 0);
			out.push({...comun(largo, d), tipo: 'dedo', radio: Number(p.radius ?? 0), seq, generoInicial: p.genderofs === 'F' ? 'F' : 'M'});
		} else if (tipo === 'SNAP_GEN') {
			out.push({...comun(0, d), tipo: 'gen', genero: p.gender === 'F' ? 'F' : 'M', alcance: alcance(p.bounding)});
		}
	}
	return out;
}

// Zona de encastre de un SNAP_GEN, aproximada por una esfera con la menor de sus medidas.
function alcance(spec: string | undefined): number {
	const [forma, ...n] = (spec ?? 'pnt').split(/\s+/);
	const v = n.map(Number).filter((x) => !Number.isNaN(x));
	if (forma === 'pnt' || v.length === 0) return 0;
	return Math.min(...v);
}

// Tolerancia amplia (5 %): hay modelos con rotaciones redondeadas o aproximadas ("1 0.17 0 -0.17 1 0 …").
// Las referencias escaladas de verdad (primitivas ×2, ×4, ×0.5) quedan muy lejos de ese margen.
const cerca =(a: number, b: number) => Math.abs(a - b) < 0.05;

// Aplica una transformación a un conector. Devuelve null si la escala no permite heredarlo.
export function transformarConector(c: Conector, tr: Transform): Conector | null {
	const [sx, sy, sz] = escalasEjes(tr.r);
	let factorLargo = 1;
	let factorRadio = 1;
	if (!(cerca(sx, 1) && cerca(sy, 1) && cerca(sz, 1))) {
		// Escala medida en el eje del conector (largo) y perpendicular a él (radio).
		const soloY = cerca(sx, 1) && cerca(sz, 1);
		const soloR = cerca(sy, 1) && cerca(sx, sz);
		const permitido =
			(c.escala === 'YOnly' && soloY) || (c.escala === 'ROnly' && soloR) || (c.escala === 'YandR' && (soloY || soloR));
		if (!permitido) return null;
		factorLargo = soloY ? sy : 1;
		factorRadio = soloR ? sx : 1;
	}
	const base = aplicar(tr, c.base);
	const eje = normalizar(aplicarR(tr.r, c.eje));
	const largo = c.largo * factorLargo;
	switch (c.tipo) {
		case 'cil':
			return {...c, base, eje, largo, secs: c.secs.map((s) => ({...s, r: s.r * factorRadio, largo: s.largo * factorLargo}))};
		case 'clip':
			return {...c, base, eje, largo, radio: c.radio * factorRadio};
		case 'dedo':
			return {...c, base, eje, largo, radio: c.radio * factorRadio, seq: c.seq.map((x) => x * factorLargo)};
		case 'gen':
			return {...c, base, eje};
	}
}

// Conectores declarados en el archivo sombra (incluye SNAP_INCL), sin herencia de geometría.
function propios(bib: Biblioteca, nombre: string, pila: Set<string>): {formas: Conector[]; borrar: Set<string> | 'todo' | null} {
	const lineas = bib.sombra(nombre);
	if (!lineas || pila.has(nombre)) return {formas: [], borrar: null};
	pila.add(nombre);
	const formas: Conector[] = [];
	let borrar: Set<string> | 'todo' | null = null;
	for (const l of lineas) {
		const m = l.trim().match(/^0 !LDCAD (SNAP_\w+)(.*)$/);
		if (!m) continue;
		const p = parametros(m[2]);
		if (m[1] === 'SNAP_CLEAR') {
			if (!p.id) borrar = 'todo';
			else if (borrar !== 'todo') {
				borrar ??= new Set();
				borrar.add(p.id);
			}
		} else if (m[1] === 'SNAP_INCL') {
			const incl = propios(bib, p.ref ? p.ref.replace(/\\/g, '/').toLowerCase() : '', pila).formas;
			const tr = transformDe(p);
			for (const d of grilla(p.grid)) {
				const trD = componer({r: IDENTIDAD.r, t: aplicar(tr, d)}, {r: tr.r, t: [0, 0, 0]});
				for (const c of incl) {
					const t = transformarConector(c, trD);
					if (t) formas.push(t);
				}
			}
		} else {
			formas.push(...formasDeLinea(m[1], p));
		}
	}
	pila.delete(nombre);
	return {formas, borrar};
}

const cache = new Map<string, Conector[]>();

export function conectoresDe(bib: Biblioteca, nombre: string, pila = new Set<string>()): Conector[] {
	const clave = bib.clave(nombre);
	const guardado = cache.get(clave);
	if (guardado) return guardado;
	if (pila.has(nombre)) return [];
	pila.add(nombre);
	const {formas, borrar} = propios(bib, nombre, new Set());
	const resultado = [...formas];
	if (borrar !== 'todo') {
		const archivo = bib.archivo(nombre);
		archivo?.lineas.forEach((l, i) => {
			const ref = parsearReferencia(l, i + 1);
			if (!ref) return;
			for (const c of conectoresDe(bib, ref.archivo, pila)) {
				if (borrar && c.id && borrar.has(c.id)) continue;
				const t = transformarConector(c, ref.transform);
				if (t) resultado.push(t);
			}
		});
	}
	pila.delete(nombre);
	cache.set(clave, resultado);
	return resultado;
}

// Tamaño del caché de conectores (para medir memoria en el banco de pruebas).
export function estadisticasConectores() {
	let conectores = 0;
	let embebidos = 0;
	for (const [k, v] of cache) {
		conectores += v.length;
		if (k.includes('|')) embebidos++;
	}
	return {archivos: cache.size, embebidos, conectores};
}

// Borra los conectores de las piezas embebidas de un modelo (clave "id|nombre").
export function liberarConectores(idBiblioteca: number) {
	const prefijo = `${idBiblioteca}|`;
	for (const k of cache.keys()) if (k.startsWith(prefijo)) cache.delete(k);
}
