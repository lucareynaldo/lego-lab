// Colisiones entre piezas: dos piezas chocan si un triángulo de una atraviesa de verdad un
// triángulo de la otra (hay vértices a ambos lados del plano, más allá de una tolerancia).
// Tocarse (caras coplanares, un borde apoyado sobre una cara) no cuenta.

import type {Caja, Vec3} from './matematica.ts';
import {cajasSeTocan} from './matematica.ts';
import type {Tris} from './geometria.ts';

export const TOL_PENETRACION = 0.3; // LDU (1 LDU = 0,4 mm)

// Triángulos seleccionados, empaquetados de a R valores (sin objetos por triángulo: en modelos grandes
// esto se calcula millones de veces): 9 coordenadas de los vértices (ya desplazados), caja (min, max) y
// plano (normal y d; NaN si el triángulo es degenerado).
const R = 19;
const V = 0; // vértices
const MIN = 9;
const MAX = 12;
const P = 15; // plano

function planoEn(f: Float64Array, k: number) {
	const ux = f[k + 3] - f[k];
	const uy = f[k + 4] - f[k + 1];
	const uz = f[k + 5] - f[k + 2];
	const vx = f[k + 6] - f[k];
	const vy = f[k + 7] - f[k + 1];
	const vz = f[k + 8] - f[k + 2];
	let nx = uy * vz - uz * vy;
	let ny = uz * vx - ux * vz;
	let nz = ux * vy - uy * vx;
	const l = Math.hypot(nx, ny, nz);
	const p = k + P;
	if (l < 1e-9) {
		f[p] = f[p + 1] = f[p + 2] = f[p + 3] = NaN;
		return;
	}
	nx /= l;
	ny /= l;
	nz /= l;
	f[p] = nx;
	f[p + 1] = ny;
	f[p + 2] = nz;
	f[p + 3] = -(nx * f[k] + ny * f[k + 1] + nz * f[k + 2]);
}

// Distancias de los vértices del triángulo `k` de `f` al plano del triángulo `j` de `g`.
const distancias = (g: Float64Array, j: number, f: Float64Array, k: number): [number, number, number] => {
	const p = j + P;
	return [
		g[p] * f[k] + g[p + 1] * f[k + 1] + g[p + 2] * f[k + 2] + g[p + 3],
		g[p] * f[k + 3] + g[p + 1] * f[k + 4] + g[p + 2] * f[k + 5] + g[p + 3],
		g[p] * f[k + 6] + g[p + 1] * f[k + 7] + g[p + 2] * f[k + 8] + g[p + 3],
	];
};

// Intervalo (sobre el eje `eje`) donde el triángulo corta el plano del otro.
function intervalo(f: Float64Array, k: number, d: [number, number, number], eje: number): [number, number] | null {
	let lo = Infinity;
	let hi = -Infinity;
	let n = 0;
	for (let i = 0; i < 3; i++) {
		const j = (i + 1) % 3;
		const pi = f[k + i * 3 + eje];
		const pj = f[k + j * 3 + eje];
		if (Math.abs(d[i]) <= 1e-9) {
			n++;
			if (pi < lo) lo = pi;
			if (pi > hi) hi = pi;
		}
		if ((d[i] > 1e-9 && d[j] < -1e-9) || (d[i] < -1e-9 && d[j] > 1e-9)) {
			const v = pi + ((pj - pi) * d[i]) / (d[i] - d[j]);
			n++;
			if (v < lo) lo = v;
			if (v > hi) hi = v;
		}
	}
	return n < 2 ? null : [lo, hi];
}

const cruzaPlano = (d: [number, number, number], tol: number) =>
	Math.max(d[0], d[1], d[2]) > tol && Math.min(d[0], d[1], d[2]) < -tol;

// Profundidad con que se atraviesan el triángulo `i` de `fa` y el `j` de `fb` (0 si no se atraviesan):
// cuánto sobresale cada uno del plano del otro por el lado más corto, y el menor de los dos.
function penetracionEmpaquetada(fa: Float64Array, i: number, fb: Float64Array, j: number, tol: number): number {
	if (Number.isNaN(fa[i + P]) || Number.isNaN(fb[j + P])) return 0;
	const da = distancias(fb, j, fa, i);
	if (!cruzaPlano(da, tol)) return 0;
	const db = distancias(fa, i, fb, j);
	if (!cruzaPlano(db, tol)) return 0;
	// Recta de intersección de los planos: se proyecta sobre su componente dominante.
	const a = i + P;
	const b = j + P;
	const dx = fa[a + 1] * fb[b + 2] - fa[a + 2] * fb[b + 1];
	const dy = fa[a + 2] * fb[b] - fa[a] * fb[b + 2];
	const dz = fa[a] * fb[b + 1] - fa[a + 1] * fb[b];
	const eje = Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) >= Math.abs(dz) ? 0 : Math.abs(dy) >= Math.abs(dz) ? 1 : 2;
	const ia = intervalo(fa, i, da, eje);
	const ib = intervalo(fb, j, db, eje);
	if (!ia || !ib) return 0;
	if (Math.min(ia[1], ib[1]) - Math.max(ia[0], ib[0]) <= tol) return 0;
	const lado = (d: [number, number, number]) => Math.min(Math.max(d[0], d[1], d[2]), -Math.min(d[0], d[1], d[2]));
	return Math.min(lado(da), lado(db));
}

// Profundidad con que se atraviesan dos triángulos sueltos (offsets `oa`, `ob`).
export function penetracion(a: Tris, oa: number, b: Tris, ob: number, tol = TOL_PENETRACION): number {
	const fa = new Float64Array(R);
	const fb = new Float64Array(R);
	for (let i = 0; i < 9; i++) {
		fa[i] = a[oa + i];
		fb[i] = b[ob + i];
	}
	planoEn(fa, 0);
	planoEn(fb, 0);
	return penetracionEmpaquetada(fa, 0, fb, 0, tol);
}

// Índice por bloques: caja de cada grupo de BLOQUE triángulos consecutivos (los archivos LDraw
// describen la pieza por partes, así que los triángulos seguidos suelen estar cerca). Permite saltear
// de a bloques lo que queda lejos de la zona. Se guarda mientras viva el arreglo de triángulos.
const BLOQUE = 32;
const indices = new WeakMap<Tris, Float32Array>();
function indiceDe(t: Tris): Float32Array {
	let ind = indices.get(t);
	if (ind) return ind;
	const n = Math.ceil(t.length / 9 / BLOQUE);
	ind = new Float32Array(n * 6);
	for (let b = 0; b < n; b++) {
		let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
		const fin = Math.min(t.length, (b + 1) * BLOQUE * 9);
		for (let o = b * BLOQUE * 9; o < fin; o += 3) {
			if (t[o] < x0) x0 = t[o];
			if (t[o] > x1) x1 = t[o];
			if (t[o + 1] < y0) y0 = t[o + 1];
			if (t[o + 1] > y1) y1 = t[o + 1];
			if (t[o + 2] < z0) z0 = t[o + 2];
			if (t[o + 2] > z1) z1 = t[o + 2];
		}
		ind.set([x0, y0, z0, x1, y1, z1], b * 6);
	}
	indices.set(t, ind);
	return ind;
}

// El orden por mínimo usa claves enteras (1/64 LDU) para ordenar sin comparador: dentro de una misma
// clave el orden real puede diferir hasta ORDEN_EPS, y el barrido lo tiene en cuenta.
const ORDEN_ESC = 64;
const ORDEN_EPS = 1 / ORDEN_ESC;
const ORDEN_IDX = 2 ** 21; // máximo de triángulos por zona

// Triángulos de `t` (desplazados en `desp`) cuya caja toca `zona`, ordenados por su mínimo en el eje
// `e` y separados en cortos y largos (extensión en `e` mayor que `largo`). Con `minimo` > 0 se
// descartan los que no pueden atravesar ningún plano esa profundidad por los dos lados: su extensión en
// cualquier dirección es a lo sumo la diagonal de su caja, que tendría que medir al menos 2·minimo.
function trisEnZona(t: Tris, zona: Caja, e: number, minimo: number, desp: Vec3 | null, largo = Infinity): {cortos: Float64Array; largos: Float64Array} {
	const [dx, dy, dz] = desp ?? [0, 0, 0];
	// La zona en las coordenadas de `t` (sin desplazar).
	const zx0 = zona.min[0] - dx, zy0 = zona.min[1] - dy, zz0 = zona.min[2] - dz;
	const zx1 = zona.max[0] - dx, zy1 = zona.max[1] - dy, zz1 = zona.max[2] - dz;
	const diag2 = 4 * minimo * minimo;
	const ind = indiceDe(t);
	const sel: number[] = [];
	for (let b = 0; b < ind.length / 6; b++) {
		const k = b * 6;
		if (ind[k] > zx1 || ind[k + 3] < zx0 || ind[k + 1] > zy1 || ind[k + 4] < zy0 || ind[k + 2] > zz1 || ind[k + 5] < zz0) continue;
		const fin = Math.min(t.length, (b + 1) * BLOQUE * 9);
		for (let o = b * BLOQUE * 9; o < fin; o += 9) {
			const x0 = Math.min(t[o], t[o + 3], t[o + 6]);
			const x1 = Math.max(t[o], t[o + 3], t[o + 6]);
			if (x0 > zx1 || x1 < zx0) continue;
			const y0 = Math.min(t[o + 1], t[o + 4], t[o + 7]);
			const y1 = Math.max(t[o + 1], t[o + 4], t[o + 7]);
			if (y0 > zy1 || y1 < zy0) continue;
			const z0 = Math.min(t[o + 2], t[o + 5], t[o + 8]);
			const z1 = Math.max(t[o + 2], t[o + 5], t[o + 8]);
			if (z0 > zz1 || z1 < zz0) continue;
			if (diag2 > 0 && (x1 - x0) ** 2 + (y1 - y0) ** 2 + (z1 - z0) ** 2 < diag2) continue;
			sel.push(o);
		}
	}
	if (sel.length >= ORDEN_IDX) throw new Error(`demasiados triángulos en la zona: ${sel.length}`);
	// Coordenada en el eje `e` desplazada, redondeada a float32 como si los triángulos se hubieran
	// trasladado en su propio arreglo.
	const de = desp ? desp[e] : 0;
	const coord = (o: number, eje: number, d: number) => (desp ? Math.fround(t[o + eje] + d) : t[o + eje]);
	const claves = new Float64Array(sel.length);
	let nLargos = 0;
	for (let n = 0; n < sel.length; n++) {
		const o = sel[n];
		const a = coord(o, e, de), b = coord(o + 3, e, de), c = coord(o + 6, e, de);
		if (Math.max(a, b, c) - Math.min(a, b, c) > largo) nLargos++;
		claves[n] = Math.floor(Math.min(a, b, c) * ORDEN_ESC) * ORDEN_IDX + n;
	}
	claves.sort();
	const cortos = new Float64Array((sel.length - nLargos) * R);
	const largos = new Float64Array(nLargos * R);
	let kc = 0;
	let kl = 0;
	for (const clave of claves) {
		const o = sel[clave - Math.floor(clave / ORDEN_IDX) * ORDEN_IDX];
		const a = coord(o, e, de), b = coord(o + 3, e, de), c = coord(o + 6, e, de);
		const esLargo = Math.max(a, b, c) - Math.min(a, b, c) > largo;
		const filas = esLargo ? largos : cortos;
		const k = esLargo ? kl : kc;
		if (esLargo) kl += R;
		else kc += R;
		for (let v = 0; v < 9; v += 3) {
			filas[k + V + v] = coord(o + v, 0, dx);
			filas[k + V + v + 1] = coord(o + v, 1, dy);
			filas[k + V + v + 2] = coord(o + v, 2, dz);
		}
		for (let i = 0; i < 3; i++) {
			filas[k + MIN + i] = Math.min(filas[k + i], filas[k + 3 + i], filas[k + 6 + i]);
			filas[k + MAX + i] = Math.max(filas[k + i], filas[k + 3 + i], filas[k + 6 + i]);
		}
		planoEn(filas, k);
	}
	return {cortos, largos};
}

const cajasTrisSeTocan = (ta: Float64Array, i: number, tb: Float64Array, j: number) =>
	!(ta[i + MIN] > tb[j + MAX] || tb[j + MIN] > ta[i + MAX]) &&
	!(ta[i + MIN + 1] > tb[j + MAX + 1] || tb[j + MIN + 1] > ta[i + MAX + 1]) &&
	!(ta[i + MIN + 2] > tb[j + MAX + 2] || tb[j + MIN + 2] > ta[i + MAX + 2]);

// Máxima penetración entre dos piezas (0 si no se atraviesan). Corta al superar el valor "suficiente".
// `minimo`: solo interesan penetraciones de al menos ese valor; por debajo puede devolver 0.
// `despA`: desplazamiento de `a` respecto de sus triángulos (`cajaA` ya es la caja desplazada).
// Barrido sobre el eje más largo de la zona común: los triángulos están ordenados por su mínimo en ese
// eje, así que para cada triángulo de `a` solo se miran los de `b` cuyo rango puede solaparse. Los
// triángulos largos de `b` (caras grandes) van aparte, para no obligar a mirar hacia atrás todo el barrido.
export function penetracionPiezas(
	a: Tris,
	cajaA: Caja,
	b: Tris,
	cajaB: Caja,
	suficiente = 8,
	tol = TOL_PENETRACION,
	minimo = 0,
	despA: Vec3 | null = null,
): number {
	const zona: Caja = {
		min: [0, 1, 2].map((i) => Math.max(cajaA.min[i], cajaB.min[i]) - tol) as Caja['min'],
		max: [0, 1, 2].map((i) => Math.min(cajaA.max[i], cajaB.max[i]) + tol) as Caja['max'],
	};
	const ext = [0, 1, 2].map((i) => zona.max[i] - zona.min[i]);
	const e = ext[0] >= ext[1] && ext[0] >= ext[2] ? 0 : ext[1] >= ext[2] ? 1 : 2;
	const {cortos: ta} = trisEnZona(a, zona, e, minimo, despA);
	if (ta.length === 0) return 0;
	const LARGO = Math.max(4, ext[e] / 8);
	const {cortos, largos} = trisEnZona(b, zona, e, minimo, null, LARGO);
	const nb = cortos.length / R;
	let max = 0;
	const probar = (i: number, tb: Float64Array, j: number) => {
		if (!cajasTrisSeTocan(ta, i, tb, j)) return false;
		max = Math.max(max, penetracionEmpaquetada(ta, i, tb, j, tol));
		return max >= suficiente;
	};
	let desde = 0; // primer triángulo corto de b que todavía puede solaparse (sus mínimos crecen)
	for (let i = 0; i < ta.length; i += R) {
		// Un triángulo corto con mínimo < mínimo(a) - LARGO termina antes de que empiece este. Los márgenes
		// ORDEN_EPS cubren el redondeo de las claves de orden (de los dos arreglos).
		const limite = ta[i + MIN + e] - LARGO - 2 * ORDEN_EPS;
		while (desde < nb && cortos[desde * R + MIN + e] < limite) desde++;
		const hasta = ta[i + MAX + e] + ORDEN_EPS;
		for (let n = desde; n < nb; n++) {
			const j = n * R;
			if (cortos[j + MIN + e] > hasta) break;
			if (probar(i, cortos, j)) return max;
		}
		for (let j = 0; j < largos.length; j += R) {
			if (largos[j + MIN + e] > hasta) break;
			if (probar(i, largos, j)) return max;
		}
	}
	return max;
}

// --- Piezas superpuestas (comparten volumen sin que sus triángulos se crucen) ---
//
// Dos piezas en la misma capa que se pisan (un duplicado, dos placas encimadas) no tienen triángulos
// que se atraviesen: sus caras coinciden en los mismos planos. La diferencia con dos piezas que solo se
// tocan está en la orientación: al tocarse, las caras coincidentes miran en sentidos opuestos (la de
// arriba de una contra la de abajo de la otra); al pisarse, miran para el mismo lado (las dos caras de
// arriba). Se mide cuánta área comparten caras coplanares con la misma normal. Solo se usan triángulos
// con orientación conocida (BFC).

const TOL_PLANO = 0.1; // LDU
export const AREA_SUPERPUESTA_MIN = 10; // LDU² (la cara de arriba de un stud tiene ~113)

type Plano = {nx: number; ny: number; nz: number; d: number};

function planoDeTri(t: Tris, o: number): Plano | null {
	const ux = t[o + 3] - t[o], uy = t[o + 4] - t[o + 1], uz = t[o + 5] - t[o + 2];
	const vx = t[o + 6] - t[o], vy = t[o + 7] - t[o + 1], vz = t[o + 8] - t[o + 2];
	const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
	const l = Math.hypot(nx, ny, nz);
	if (l < 1e-6) return null;
	return {nx: nx / l, ny: ny / l, nz: nz / l, d: (nx * t[o] + ny * t[o + 1] + nz * t[o + 2]) / l};
}

// Recorta el polígono convexo `p` (2D) con el triángulo `q` (2D). Devuelve el polígono intersección.
function recortar(p: number[][], q: number[][]): number[][] {
	const signo = Math.sign((q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[1][1] - q[0][1]) * (q[2][0] - q[0][0])) || 1;
	let salida = p;
	for (let e = 0; e < 3 && salida.length > 0; e++) {
		const [a, b] = [q[e], q[(e + 1) % 3]];
		const lado = (v: number[]) => signo * ((b[0] - a[0]) * (v[1] - a[1]) - (b[1] - a[1]) * (v[0] - a[0]));
		const entrada = salida;
		salida = [];
		for (let i = 0; i < entrada.length; i++) {
			const cur = entrada[i];
			const prev = entrada[(i + entrada.length - 1) % entrada.length];
			const lc = lado(cur);
			const lp = lado(prev);
			if (lc >= 0) {
				if (lp < 0) salida.push([prev[0] + ((cur[0] - prev[0]) * lp) / (lp - lc), prev[1] + ((cur[1] - prev[1]) * lp) / (lp - lc)]);
				salida.push(cur);
			} else if (lp >= 0) salida.push([prev[0] + ((cur[0] - prev[0]) * lp) / (lp - lc), prev[1] + ((cur[1] - prev[1]) * lp) / (lp - lc)]);
		}
	}
	return salida;
}

const areaPoligono = (p: number[][]) => {
	let s = 0;
	for (let i = 0; i < p.length; i++) {
		const [a, b] = [p[i], p[(i + 1) % p.length]];
		s += a[0] * b[1] - b[0] * a[1];
	}
	return Math.abs(s) / 2;
};

export type Superposicion = {area: number; ancho: number};

// Área compartida (LDU²) entre caras coplanares con la misma orientación de dos piezas, en el plano
// donde más comparten, y su ancho medio (área / mayor extensión): distingue un solape de verdad de una
// coincidencia fina por imprecisión del modelado (0,5 LDU a lo largo de un borde).
export function superposicion(a: Tris, oa: Uint8Array, cajaA: Caja, b: Tris, ob: Uint8Array, cajaB: Caja): Superposicion {
	const zona: Caja = {
		min: [0, 1, 2].map((i) => Math.max(cajaA.min[i], cajaB.min[i]) - TOL_PLANO) as Caja['min'],
		max: [0, 1, 2].map((i) => Math.min(cajaA.max[i], cajaB.max[i]) + TOL_PLANO) as Caja['max'],
	};
	// Triángulos orientados que tocan la zona; con el índice por bloques se saltean de a 32 los lejanos.
	const [zx0, zy0, zz0] = zona.min;
	const [zx1, zy1, zz1] = zona.max;
	const enZona = (t: Tris, orient: Uint8Array): number[] => {
		const ind = indiceDe(t);
		const sel: number[] = [];
		for (let bq = 0; bq < ind.length / 6; bq++) {
			const q = bq * 6;
			if (ind[q] > zx1 || ind[q + 3] < zx0 || ind[q + 1] > zy1 || ind[q + 4] < zy0 || ind[q + 2] > zz1 || ind[q + 5] < zz0) continue;
			const fin = Math.min(t.length, (bq + 1) * BLOQUE * 9);
			for (let o = bq * BLOQUE * 9; o < fin; o += 9) {
				if (!orient[o / 9]) continue;
				if (Math.max(t[o], t[o + 3], t[o + 6]) < zx0 || Math.min(t[o], t[o + 3], t[o + 6]) > zx1) continue;
				if (Math.max(t[o + 1], t[o + 4], t[o + 7]) < zy0 || Math.min(t[o + 1], t[o + 4], t[o + 7]) > zy1) continue;
				if (Math.max(t[o + 2], t[o + 5], t[o + 8]) < zz0 || Math.min(t[o + 2], t[o + 5], t[o + 8]) > zz1) continue;
				sel.push(o);
			}
		}
		return sel;
	};
	// Clave numérica del plano: normal redondeada a centésimos y distancia en pasos de 0,5 LDU.
	const claveNormal = (p: Plano) => ((Math.round(p.nx * 100) + 100) * 201 + Math.round(p.ny * 100) + 100) * 201 + Math.round(p.nz * 100) + 100;
	const clavePlano = (kn: number, dd: number) => kn * 1e6 + dd + 5e5;
	const selB = enZona(b, ob);
	if (selB.length === 0) return {area: 0, ancho: 0};
	const selA = enZona(a, oa);
	if (selA.length === 0) return {area: 0, ancho: 0};
	// Triángulos de B agrupados por plano.
	const grupos = new Map<number, {o: number; p: Plano}[]>();
	for (const o of selB) {
		const p = planoDeTri(b, o);
		if (!p) continue;
		const clave = clavePlano(claveNormal(p), Math.round(p.d * 2));
		let g = grupos.get(clave);
		if (!g) grupos.set(clave, (g = []));
		g.push({o, p});
	}
	if (grupos.size === 0) return {area: 0, ancho: 0};
	// Por plano de A: área compartida y extensión de lo compartido (en 2D).
	const porPlano = new Map<number, {area: number; min: number[]; max: number[]}>();
	for (const oA of selA) {
		const k = oA / 9;
		const pa = planoDeTri(a, oA);
		if (!pa) continue;
		// Se proyecta sobre el plano de coordenadas más parecido (se descarta el eje dominante de la normal).
		const abs = [Math.abs(pa.nx), Math.abs(pa.ny), Math.abs(pa.nz)];
		const dom = abs[0] >= abs[1] && abs[0] >= abs[2] ? 0 : abs[1] >= abs[2] ? 1 : 2;
		const [u, v] = [0, 1, 2].filter((x) => x !== dom);
		const escala = 1 / abs[dom];
		const tA = [0, 1, 2].map((j) => [a[k * 9 + j * 3 + u], a[k * 9 + j * 3 + v]]);
		const kn = claveNormal(pa);
		const r = Math.round(pa.d * 2);
		for (const dd of [r - 1, r, r + 1]) {
			for (const {o, p} of grupos.get(clavePlano(kn, dd)) ?? []) {
				if (pa.nx * p.nx + pa.ny * p.ny + pa.nz * p.nz < 0.9999 || Math.abs(pa.d - p.d) > TOL_PLANO) continue;
				const tB = [0, 1, 2].map((j) => [b[o + j * 3 + u], b[o + j * 3 + v]]);
				const inter = recortar(tA, tB);
				if (inter.length < 3) continue;
				const area = areaPoligono(inter) * escala;
				if (area < 1e-3) continue;
				const clave = clavePlano(kn, r);
				let e = porPlano.get(clave);
				if (!e) porPlano.set(clave, (e = {area: 0, min: [Infinity, Infinity], max: [-Infinity, -Infinity]}));
				e.area += area;
				for (const pt of inter)
					for (let c = 0; c < 2; c++) {
						e.min[c] = Math.min(e.min[c], pt[c]);
						e.max[c] = Math.max(e.max[c], pt[c]);
					}
			}
		}
	}
	// El plano con el solape más ancho, entre los que comparten un área mínima.
	let mejor: Superposicion = {area: 0, ancho: 0};
	for (const e of porPlano.values()) {
		if (e.area < AREA_SUPERPUESTA_MIN) continue;
		const ancho = e.area / Math.max(e.max[0] - e.min[0], e.max[1] - e.min[1], 1e-6);
		if (ancho > mejor.ancho) mejor = {area: e.area, ancho};
	}
	return mejor;
}

// Pares de índices cuyas cajas se superponen más que la tolerancia (barrido sobre X).
export function paresCandidatos(cajas: Caja[], tol = TOL_PENETRACION): [number, number][] {
	const orden = cajas.map((_, i) => i).sort((i, j) => cajas[i].min[0] - cajas[j].min[0]);
	const pares: [number, number][] = [];
	const encoge = (c: Caja): Caja => ({
		min: c.min.map((v) => v + tol) as Caja['min'],
		max: c.max.map((v) => v - tol) as Caja['max'],
	});
	const chicas = cajas.map(encoge);
	for (let i = 0; i < orden.length; i++) {
		const a = orden[i];
		for (let j = i + 1; j < orden.length; j++) {
			const b = orden[j];
			if (chicas[b].min[0] > chicas[a].max[0]) break;
			if (cajasSeTocan(chicas[a], chicas[b])) pares.push(a < b ? [a, b] : [b, a]);
		}
	}
	return pares;
}
