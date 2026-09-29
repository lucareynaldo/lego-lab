// Qué tiene una pieza para encastrar: studs y anti-studs indexados en grilla (i crece en +X, j en +Z,
// desde la esquina de menor X y Z) y el resto de sus conectores numerados.

import type {Conector} from '../../verificador/src/conectores.ts';
import {conectoresDe} from '../../verificador/src/conectores.ts';
import {mallaDe} from '../../verificador/src/geometria.ts';
import type {Biblioteca} from '../../verificador/src/ldraw.ts';
import {normalizarNombre} from '../../verificador/src/ldraw.ts';
import type {Caja, Vec3} from '../../verificador/src/matematica.ts';
import {normalizar, punto} from '../../verificador/src/matematica.ts';

export const archivoDe = (id: string) => {
	const n = normalizarNombre(id);
	return n.endsWith('.dat') ? n : `${n}.dat`;
};

export const conectoresPieza = (bib: Biblioteca, archivo: string): Conector[] => conectoresDe(bib, archivo);

const ARRIBA: Vec3 = [0, -1, 0];
const haciaArriba = (c: Conector) => punto(normalizar(c.eje), ARRIBA) > 0.999;
const seccion6 = (c: Conector, formas: string[]) => c.tipo === 'cil' && c.secs.some((s) => formas.includes(s.forma) && Math.abs(s.r - 6) < 0.01);

export const esStud = (c: Conector) => c.tipo === 'cil' && c.genero === 'M' && haciaArriba(c) && seccion6(c, ['R']);
export const esAntistud = (c: Conector) => c.tipo === 'cil' && c.genero === 'F' && haciaArriba(c) && seccion6(c, ['R', 'S']);

export type PuntoGrilla = {i: number; j: number; n: number; pos: Vec3};
export type Grilla = {columnas: number; filas: number; puntos: PuntoGrilla[]};

export function grilla(conectores: Conector[], filtro: (c: Conector) => boolean): Grilla {
	const elegidos = conectores.map((c, n) => ({c, n})).filter(({c}) => filtro(c));
	if (elegidos.length === 0) return {columnas: 0, filas: 0, puntos: []};
	const minX = Math.min(...elegidos.map(({c}) => c.base[0]));
	const minZ = Math.min(...elegidos.map(({c}) => c.base[2]));
	const porCelda = new Map<string, PuntoGrilla>();
	for (const {c, n} of elegidos) {
		const i = Math.round((c.base[0] - minX) / 20);
		const j = Math.round((c.base[2] - minZ) / 20);
		// Dos conectores en la misma celda (p. ej., a distinta altura): queda el primero.
		if (!porCelda.has(`${i},${j}`)) porCelda.set(`${i},${j}`, {i, j, n, pos: c.base});
	}
	const puntos = [...porCelda.values()].sort((a, b) => a.j - b.j || a.i - b.i);
	return {columnas: Math.max(...puntos.map((p) => p.i)) + 1, filas: Math.max(...puntos.map((p) => p.j)) + 1, puntos};
}

export function puntoGrilla(g: Grilla, [i, j]: [number, number], que: string): PuntoGrilla {
	if (g.puntos.length === 0) throw new Error(`la pieza no tiene ${que}s`);
	const p = g.puntos.find((x) => x.i === i && x.j === j);
	if (!p) throw new Error(`${que} (${i},${j}) fuera de rango: la pieza tiene ${g.columnas}×${g.filas} (i < ${g.columnas}, j < ${g.filas})`);
	return p;
}

export type Ficha = {
	id: string;
	titulo: string;
	caja: Caja;
	tamano: {x: number; y: number; z: number}; // studs, placas, studs
	studs: Grilla;
	antistuds: Grilla;
	otros: {n: number; tipo: string; genero?: string; pos: Vec3; eje: Vec3}[];
};

const redondear = (x: number, paso = 0.01) => Math.round(x / paso) * paso;

export function ficha(bib: Biblioteca, id: string): Ficha {
	const archivo = archivoDe(id);
	const a = bib.archivo(archivo);
	if (!a) throw new Error(`pieza inexistente: ${id}`);
	const conectores = conectoresPieza(bib, archivo);
	const {caja} = mallaDe(bib, archivo);
	const studs = grilla(conectores, esStud);
	const antistuds = grilla(conectores, esAntistud);
	const enGrilla = new Set([...studs.puntos, ...antistuds.puntos].map((p) => p.n));
	// La altura se mide sin los studs (4 LDU): un 3001 mide 3 placas, no 3,5. Los studs nacen en su base.
	const tope = studs.puntos.length > 0 ? Math.min(...studs.puntos.map((p) => p.pos[1])) : caja.min[1];
	return {
		id: archivo.slice(0, -4),
		titulo: a.titulo,
		caja,
		tamano: {
			x: redondear((caja.max[0] - caja.min[0]) / 20),
			y: redondear((caja.max[1] - tope) / 8),
			z: redondear((caja.max[2] - caja.min[2]) / 20),
		},
		studs,
		antistuds,
		otros: conectores
			.map((c, n) => ({c, n}))
			.filter(({n}) => !enGrilla.has(n))
			.map(({c, n}) => ({n, tipo: c.tipo, genero: 'genero' in c ? c.genero : undefined, pos: c.base, eje: normalizar(c.eje)})),
	};
}
