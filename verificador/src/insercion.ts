// Camino de inserción: ¿puede una pieza (o un sub-armado) llegar a su lugar moviéndose en línea recta,
// sin atravesar lo que ya está colocado?
//
// No se exige que venga "desde el infinito": alcanza con que pueda recorrer libre lo que penetra el
// encastre (4 LDU un stud, 8-20 un pin) más un margen. Una vez desencastrada se la puede maniobrar;
// un obstáculo más lejano no impide armarla.
//
// Lo que ya se solapa con la pieza en su posición final (colisiones y roces, reportados aparte) no
// cuenta como obstáculo del recorrido.

import {penetracionPiezas} from './colisiones.ts';
import type {Caja, Vec3} from './matematica.ts';
import {cajasSeTocan, escalar} from './matematica.ts';
import type {Tris} from './geometria.ts';

export type Cuerpo = {tris: Tris; caja: Caja};

// `solapado`: si el obstáculo ya se solapa con lo que se mueve en la posición final. No cambia entre
// pruebas; quien llama puede guardarlo (el desarmado prueba la misma pieza muchas veces).
export type Obstaculo = {caja: Caja; tris: () => Tris; solapado?: () => boolean};

export type Recorrido = {libre: true} | {libre: false; bloqueador: number; distancia: number};

const PASO = 4; // LDU entre muestras del recorrido (un stud mide 4 de alto)
const MARGEN = 8; // LDU de espacio libre extra para acomodar la pieza antes de empujarla (una placa)

// Hasta dónde puede llegar la pieza en un recorrido (su caja se corre a lo sumo esto).
export const alcanceRecorrido = (profundidad: number) => profundidad + MARGEN;

const trasladarCaja =(c: Caja, d: Vec3): Caja => ({
	min: [c.min[0] + d[0], c.min[1] + d[1], c.min[2] + d[2]],
	max: [c.max[0] + d[0], c.max[1] + d[1], c.max[2] + d[2]],
});

function union(cajas: Caja[]): Caja {
	const min: Vec3 = [Infinity, Infinity, Infinity];
	const max: Vec3 = [-Infinity, -Infinity, -Infinity];
	for (const c of cajas)
		for (let i = 0; i < 3; i++) {
			if (c.min[i] < min[i]) min[i] = c.min[i];
			if (c.max[i] > max[i]) max[i] = c.max[i];
		}
	return {min, max};
}

// `movil`: piezas que se mueven juntas (ya en su posición final). `obstaculos`: lo ya colocado
// que puede estorbar. `dir`: dirección desde la que llega (se recorre desde lejos hasta el lugar).
export function recorrer(
	movil: Cuerpo[],
	obstaculos: Obstaculo[],
	dir: Vec3,
	profundidad: number,
	umbral: number,
): Recorrido {
	if (obstaculos.length === 0) return {libre: true};
	const cajaMovil = union(movil.map((m) => m.caja));
	const largoMax = alcanceRecorrido(profundidad);
	// Solo importan los obstáculos que toca el volumen barrido.
	const barrido = union([cajaMovil, trasladarCaja(cajaMovil, escalar(dir, largoMax))]);
	const yaSolapados = (o: Obstaculo) =>
		o.solapado?.() ??
		movil.some((m) => cajasSeTocan(m.caja, o.caja) && penetracionPiezas(m.tris, m.caja, o.tris(), o.caja, umbral) > 0);
	const candidatos = obstaculos
		.map((o, i) => ({...o, i}))
		.filter((o) => cajasSeTocan(o.caja, barrido))
		.filter((o) => !yaSolapados(o));
	if (candidatos.length === 0) return {libre: true};

	for (let s = PASO; s <= largoMax; s += PASO) {
		const d = escalar(dir, s);
		const cajaEnS = trasladarCaja(cajaMovil, d);
		const cerca = candidatos.filter((o) => cajasSeTocan(o.caja, cajaEnS));
		if (cerca.length === 0) {
			// Más allá, ¿vuelve a cruzarse con algo? Si la caja ya dejó atrás a todos, está libre.
			const quedan = candidatos.some((o) => cajasSeTocan(o.caja, union([cajaEnS, trasladarCaja(cajaMovil, escalar(dir, largoMax))])));
			if (!quedan) return {libre: true};
			continue;
		}
		for (const m of movil) {
			const cm = trasladarCaja(m.caja, d);
			for (const o of cerca) {
				if (!cajasSeTocan(cm, o.caja)) continue;
				// La pieza corrida `d`: se pasa el desplazamiento en vez de copiar sus triángulos.
				if (penetracionPiezas(m.tris, cm, o.tris(), o.caja, umbral, undefined, umbral, d) >= umbral) return {libre: false, bloqueador: o.i, distancia: s};
			}
		}
	}
	return {libre: true};
}
