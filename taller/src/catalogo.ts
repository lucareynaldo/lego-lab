// Índice de las piezas LDraw usables, con frecuencia de uso y colores reales según los inventarios de
// Rebrickable. Se guarda en .cache/taller/catalogo.json; `piezas reindexar` lo rehace.

import {closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {coloresEquivalentes} from './colores.ts';
import {lineasCsv} from './csv.ts';
import {DIR_CACHE, DIR_LDRAW, DIR_REBRICKABLE} from './entorno.ts';

export type EntradaCatalogo = {id: string; titulo: string; categoria: string; frecuencia: number; colores: number[]};

const RUTA = join(DIR_CACHE, 'catalogo.json');
const VERSION = 1;

// Cabecera = primeros bytes del archivo: alcanza para el título, !LDRAW_ORG y !CATEGORY.
function cabecera(ruta: string): string {
	const fd = openSync(ruta, 'r');
	try {
		const buf = Buffer.alloc(2048);
		const n = readSync(fd, buf, 0, buf.length, 0);
		return buf.toString('latin1', 0, n).replace(/\r\n?/g, '\n');
	} finally {
		closeSync(fd);
	}
}

export function esUsable(cab: string): boolean {
	const titulo = cab.split('\n')[0].replace(/^0\s+/, '');
	if (/^[~=_|]/.test(titulo) || /Moved to/i.test(titulo)) return false;
	const org = cab.match(/^0 !LDRAW_ORG\s+(?:Unofficial_)?(\S+)(?:\s+(\S+))?/m);
	if (!org || org[1] !== 'Part') return false;
	return org[2] !== 'Alias' && org[2] !== 'Physical_Colour';
}

export async function construirCatalogo(): Promise<EntradaCatalogo[]> {
	const equivalentes = await coloresEquivalentes();
	const frecuencia = new Map<string, number>();
	const colores = new Map<string, Set<number>>();
	for await (const [, pieza, color, cantidad] of lineasCsv(join(DIR_REBRICKABLE, 'inventory_parts.csv.gz'))) {
		const id = pieza.toLowerCase();
		frecuencia.set(id, (frecuencia.get(id) ?? 0) + Number(cantidad));
		if (equivalentes.has(Number(color))) {
			let s = colores.get(id);
			if (!s) colores.set(id, (s = new Set()));
			s.add(Number(color));
		}
	}
	const dir = join(DIR_LDRAW, 'parts');
	const out: EntradaCatalogo[] = [];
	for (const f of readdirSync(dir)) {
		if (!f.toLowerCase().endsWith('.dat')) continue;
		const cab = cabecera(join(dir, f));
		if (!esUsable(cab)) continue;
		const titulo = cab.split('\n')[0].replace(/^0\s+/, '').trim();
		const id = f.slice(0, -4).toLowerCase();
		const categoria = cab.match(/^0 !CATEGORY\s+(.+)$/m)?.[1].trim() ?? titulo.split(/\s+/)[0];
		out.push({id, titulo, categoria, frecuencia: frecuencia.get(id) ?? 0, colores: [...(colores.get(id) ?? [])].sort((a, b) => a - b)});
	}
	mkdirSync(DIR_CACHE, {recursive: true});
	writeFileSync(RUTA, JSON.stringify({version: VERSION, piezas: out}));
	return out;
}

let cargado: Promise<EntradaCatalogo[]> | null = null;
export function catalogo(): Promise<EntradaCatalogo[]> {
	return (cargado ??= (async () => {
		if (existsSync(RUTA)) {
			const j = JSON.parse(readFileSync(RUTA, 'utf8'));
			if (j.version === VERSION) return j.piezas as EntradaCatalogo[];
		}
		return construirCatalogo();
	})());
}

export function buscar(cat: EntradaCatalogo[], texto: string, op: {categoria?: string; max?: number; todas?: boolean} = {}): EntradaCatalogo[] {
	const consulta = texto.trim().toLowerCase();
	const palabras = consulta.split(/\s+/).filter(Boolean);
	const exacta = cat.find((e) => e.id === consulta);
	const r = cat.filter((e) => {
		if (e === exacta) return false;
		if (!op.todas && e.frecuencia === 0) return false;
		if (op.categoria && e.categoria.toLowerCase() !== op.categoria.toLowerCase()) return false;
		const t = e.titulo.toLowerCase().replace(/\s+/g, ' ');
		return palabras.every((p) => t.includes(p));
	});
	r.sort((a, b) => b.frecuencia - a.frecuencia || a.id.localeCompare(b.id));
	return [...(exacta ? [exacta] : []), ...r].slice(0, op.max ?? 20);
}
