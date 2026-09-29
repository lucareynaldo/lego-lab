// Transformaciones afines de LDraw: x' = R·x + t, con R en el orden de las líneas tipo 1
// ("a b c d e f g h i" = filas de la matriz).

export type Vec3 = [number, number, number];
export type Mat3 = [number, number, number, number, number, number, number, number, number];
export type Transform = {r: Mat3; t: Vec3};

export const IDENTIDAD: Transform = {r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0]};

export const sumar = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const restar = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const escalar = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const punto = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cruz = (a: Vec3, b: Vec3): Vec3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];
export const largo = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const normalizar = (a: Vec3): Vec3 => {
	const l = largo(a);
	return l === 0 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
};

export function aplicarR(r: Mat3, v: Vec3): Vec3 {
	return [
		r[0] * v[0] + r[1] * v[1] + r[2] * v[2],
		r[3] * v[0] + r[4] * v[1] + r[5] * v[2],
		r[6] * v[0] + r[7] * v[1] + r[8] * v[2],
	];
}

export const aplicar = (tr: Transform, p: Vec3): Vec3 => sumar(aplicarR(tr.r, p), tr.t);

export function multiplicarR(a: Mat3, b: Mat3): Mat3 {
	const m = new Array(9) as Mat3;
	for (let i = 0; i < 3; i++)
		for (let j = 0; j < 3; j++) m[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
	return m;
}

// padre ∘ hijo: primero se aplica el hijo, después el padre.
export const componer = (padre: Transform, hijo: Transform): Transform => ({
	r: multiplicarR(padre.r, hijo.r),
	t: aplicar(padre, hijo.t),
});

export function determinante(r: Mat3) {
	return r[0] * (r[4] * r[8] - r[5] * r[7]) - r[1] * (r[3] * r[8] - r[5] * r[6]) + r[2] * (r[3] * r[7] - r[4] * r[6]);
}

// Escala de cada eje local (norma de cada columna).
export const escalasEjes = (r: Mat3): Vec3 => [
	Math.hypot(r[0], r[3], r[6]),
	Math.hypot(r[1], r[4], r[7]),
	Math.hypot(r[2], r[5], r[8]),
];

// Inversa de una transformación rígida (rotación ortonormal).
export function invertirRigida(tr: Transform): Transform {
	const r = tr.r;
	const rt: Mat3 = [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]];
	return {r: rt, t: escalar(aplicarR(rt, tr.t), -1)};
}

export type Caja = {min: Vec3; max: Vec3};

export const cajaVacia = (): Caja => ({min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]});

export function expandirCaja(c: Caja, p: Vec3) {
	for (let i = 0; i < 3; i++) {
		if (p[i] < c.min[i]) c.min[i] = p[i];
		if (p[i] > c.max[i]) c.max[i] = p[i];
	}
}

export const cajasSeTocan = (a: Caja, b: Caja, margen = 0) =>
	a.min[0] <= b.max[0] + margen &&
	b.min[0] <= a.max[0] + margen &&
	a.min[1] <= b.max[1] + margen &&
	b.min[1] <= a.max[1] + margen &&
	a.min[2] <= b.max[2] + margen &&
	b.min[2] <= a.max[2] + margen;
