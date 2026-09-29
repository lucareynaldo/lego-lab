// ¿En qué posición queda un objeto apoyado en la mesa?
//
// Un cuerpo rígido termina apoyado sobre la cara de su envolvente convexa que queda justo debajo
// de su centro de masa. Si esa cara es horizontal, se queda como está; si está inclinada, el objeto
// se inclina hasta apoyarse en ella (una avioneta que se sienta sobre la cola). Mucha inclinación
// significa que se vuelca.

// El build por defecto de quickhull3d usa imports sin extensión que Node no resuelve; el bundle sí funciona.
import qh from 'quickhull3d/dist/quickhull3d.js';
import type {Vec3} from './matematica.ts';
import {cruz, normalizar, punto, restar} from './matematica.ts';

export type Apoyo = {inclinacionGrados: number} | null;

// En LDraw +Y apunta hacia abajo.
const ABAJO: Vec3 = [0, 1, 0];

export function apoyo(vertices: Vec3[], centroDeMasa: Vec3): Apoyo {
	// Sin duplicados (a 0,1 LDU): las piezas comparten muchos vértices y eso enlentece el casco.
	const unicos = [...new Map(vertices.map((v) => [v.map((x) => Math.round(x * 10)).join(','), v])).values()];
	if (unicos.length < 4) return null;
	const caras = qh(unicos);
	for (const [ia, ib, ic] of caras) {
		const a = unicos[ia];
		const b = unicos[ib];
		const c = unicos[ic];
		const n = normalizar(cruz(restar(b, a), restar(c, a)));
		const nAbajo = punto(n, ABAJO);
		if (nAbajo <= 1e-6) continue;
		// Rayo vertical desde el centro de masa hacia abajo: ¿sale por esta cara?
		const t = punto(n, restar(a, centroDeMasa)) / nAbajo;
		if (t < 0) continue;
		const p: Vec3 = [centroDeMasa[0], centroDeMasa[1] + t, centroDeMasa[2]];
		if (!dentroDelTriangulo(p, a, b, c, n)) continue;
		return {inclinacionGrados: (Math.acos(Math.min(1, nAbajo)) * 180) / Math.PI};
	}
	return null;
}

function dentroDelTriangulo(p: Vec3, a: Vec3, b: Vec3, c: Vec3, n: Vec3) {
	const lado = (u: Vec3, v: Vec3) => punto(cruz(restar(v, u), restar(p, u)), n) >= -1e-6;
	return lado(a, b) && lado(b, c) && lado(c, a);
}
