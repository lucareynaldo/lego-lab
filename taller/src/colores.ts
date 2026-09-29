// Colores: por código LDraw o por nombre de LDConfig.ldr. Los inventarios de Rebrickable usan sus propios
// ids; para los colores sólidos clásicos coinciden con el código LDraw, pero no para todos. Un código se
// considera equivalente si el id de Rebrickable tiene el mismo nombre o un RGB casi igual.

import {join} from 'node:path';
import type {Biblioteca} from '../../verificador/src/ldraw.ts';
import {lineasCsv} from './csv.ts';
import {biblioteca, DIR_REBRICKABLE} from './entorno.ts';

export type Color = {codigo: number; nombre: string; rgb: string};

// gray/grey: LDraw escribe Grey y Rebrickable Gray.
const clave = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '').replace(/gray/g, 'grey');

export function colorDe(bib: Biblioteca, valor: string | number): Color {
	const texto = String(valor).trim();
	if (/^\d+$/.test(texto)) {
		const c = bib.colores.get(Number(texto));
		if (c) return {codigo: Number(texto), ...c};
	} else {
		for (const [codigo, c] of bib.colores) if (clave(c.nombre) === clave(texto)) return {codigo, ...c};
	}
	throw new Error(`color desconocido: ${valor}`);
}

const DISTANCIA_MAX = 40; // suma de diferencias por canal (0–765)
const distancia = (a: string, b: string) =>
	[0, 2, 4].reduce((s, i) => s + Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)), 0);

let equivalentes: Promise<Set<number>> | null = null;
export function coloresEquivalentes(): Promise<Set<number>> {
	return (equivalentes ??= (async () => {
		const bib = biblioteca();
		const out = new Set<number>();
		for await (const [id, nombre, rgb] of lineasCsv(join(DIR_REBRICKABLE, 'colors.csv.gz'))) {
			const c = bib.colores.get(Number(id));
			if (c && (clave(c.nombre) === clave(nombre) || distancia(c.rgb, rgb) <= DISTANCIA_MAX)) out.add(Number(id));
		}
		return out;
	})());
}

let combos: Promise<Set<string>> | null = null;
export function combinaciones(): Promise<Set<string>> {
	return (combos ??= (async () => {
		const out = new Set<string>();
		for await (const [, pieza, color] of lineasCsv(join(DIR_REBRICKABLE, 'inventory_parts.csv.gz'))) out.add(`${pieza}|${color}`);
		return out;
	})());
}
