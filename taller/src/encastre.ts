// Encastre por conector: calcula dónde va una pieza para que uno de sus conectores quede en uno de otra
// pieza. Evita que el diseñador escriba matrices a mano.

import type {Conector} from '../../verificador/src/conectores.ts';
import type {Mat3, Transform, Vec3} from '../../verificador/src/matematica.ts';
import {aplicar, aplicarR, cruz, escalar, IDENTIDAD, largo, multiplicarR, normalizar, punto, restar} from '../../verificador/src/matematica.ts';

// Rotación de `grados` alrededor de `eje` (Rodrigues), por filas como en LDraw.
export function rotacionEje(eje: Vec3, grados: number): Mat3 {
	const [x, y, z] = normalizar(eje);
	const a = (grados * Math.PI) / 180;
	const c = Math.cos(a);
	const s = Math.sin(a);
	const k = 1 - c;
	return [
		c + x * x * k, x * y * k - z * s, x * z * k + y * s,
		y * x * k + z * s, c + y * y * k, y * z * k - x * s,
		z * x * k - y * s, z * y * k + x * s, c + z * z * k,
	];
}

// La rotación mínima que lleva la dirección a en la dirección b.
export function rotacionEntre(a: Vec3, b: Vec3): Mat3 {
	const u = normalizar(a);
	const v = normalizar(b);
	const c = punto(u, v);
	if (c > 1 - 1e-12) return [...IDENTIDAD.r] as Mat3;
	if (c < -1 + 1e-12) {
		const aux: Vec3 = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
		return rotacionEje(cruz(u, aux), 180);
	}
	const k = cruz(u, v);
	const s = largo(k);
	return rotacionEje(escalar(k, 1 / s), (Math.atan2(s, c) * 180) / Math.PI);
}

const EJES: Record<string, Vec3> = {X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1]};

export function parsearRot(s: string): Mat3 {
	let r = [...IDENTIDAD.r] as Mat3;
	for (const tok of s.trim().split(/\s+/).filter(Boolean)) {
		const m = tok.match(/^([XYZ])(-?\d+(?:\.\d+)?)$/i);
		if (!m) throw new Error(`rotación inválida: "${tok}" (se espera algo como "X90 Y-45")`);
		r = multiplicarR(rotacionEje(EJES[m[1].toUpperCase()], Number(m[2])), r);
	}
	return r;
}

const EXACTOS = [0, 1, -1, 0.5, -0.5];
function limpio(n: number): number {
	for (const e of EXACTOS) if (Math.abs(n - e) < 1e-9) return e;
	const r = Math.round(n * 1e6) / 1e6;
	return Object.is(r, -0) ? 0 : r;
}

export const limpiar = (tr: Transform): Transform => ({r: tr.r.map(limpio) as Mat3, t: tr.t.map(limpio) as Vec3});

// Transform de la pieza nueva (en el sistema del submodelo) para que su conector `conNueva` (local)
// quede sobre `conBase` (local de la pieza base, ubicada en `base`).
export function encastrar(base: Transform, conBase: Conector, conNueva: Conector, giro = 0): Transform {
	const pB = aplicar(base, conBase.base);
	const aB = normalizar(aplicarR(base.r, conBase.eje));
	const r = multiplicarR(rotacionEje(aB, giro), rotacionEntre(conNueva.eje, aB));
	return limpiar({r, t: restar(pB, aplicarR(r, conNueva.base))});
}
