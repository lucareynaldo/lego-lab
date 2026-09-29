// Muestra los conectores de una pieza y los de sus vecinas, para entender por qué dos piezas
// (no) se consideran conectadas.
//
// Uso: node src/depurar.ts <modelo.mpd> <submodelo> <línea> [radio=30] [pieza.dat]
// (la pieza sirve cuando la línea es un submodelo: elige cuál de sus piezas mirar)

import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Conector} from './conectores.ts';
import {conectoresDe, transformarConector} from './conectores.ts';
import {Biblioteca, esPieza, normalizarNombre, parsearReferencia} from './ldraw.ts';
import type {Transform} from './matematica.ts';
import {componer, largo, restar} from './matematica.ts';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [ruta, sub, lineaTxt, radioTxt, piezaFiltro] = process.argv.slice(2);
const radio = Number(radioTxt ?? 30);
const bib = new Biblioteca(join(raiz, '.cache/ldraw'), join(raiz, '.cache/LDCadShadowLibrary-main'));
bib.cargarModelo(ruta, basename(ruta));
const submodelo = normalizarNombre(sub);

type P = {archivo: string; tr: Transform; linea: number};
const piezas: P[] = [];
function aplanar(nombre: string, tr: Transform, lineaRaiz: number | null) {
	bib.archivo(nombre)!.lineas.forEach((l, i) => {
		const ref = parsearReferencia(l, i + 1);
		if (!ref) return;
		const a = bib.archivo(ref.archivo);
		const t = componer(tr, ref.transform);
		if (!a || esPieza(a)) piezas.push({archivo: ref.archivo, tr: t, linea: lineaRaiz ?? ref.linea});
		else aplanar(ref.archivo, t, lineaRaiz ?? ref.linea);
	});
}
aplanar(submodelo, {r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0]}, null);

const objetivo = piezas.find((p) => p.linea === Number(lineaTxt) && (!piezaFiltro || p.archivo === piezaFiltro));
if (!objetivo) throw new Error(`No hay pieza en ${submodelo}:${lineaTxt}`);

const fmt = (c: Conector) => {
	const v = (x: number[]) => `(${x.map((n) => n.toFixed(1)).join(' ')})`;
	const extra = c.tipo === 'cil' ? `${c.genero} ${c.secs.map((s) => `${s.forma}${s.r}×${s.largo}`).join(' ')} caps=${c.caps}` : c.tipo === 'clip' ? `r=${c.radio}` : c.tipo === 'dedo' ? `r=${c.radio} ${c.grupo}` : `${c.genero} ${c.grupo}`;
	return `${c.tipo} ${extra} base${v(c.base)} eje${v(c.eje)} L=${c.largo.toFixed(1)}${c.grupo ? ` g=${c.grupo}` : ''}`;
};
const ubicados = (p: P) => conectoresDe(bib, p.archivo).map((c) => transformarConector(c, p.tr)).filter((c): c is Conector => c !== null);

console.log(`Pieza ${objetivo.archivo} (${bib.archivo(objetivo.archivo)?.titulo}) en ${submodelo}:${objetivo.linea}`);
const propios = ubicados(objetivo);
for (const c of propios) console.log(`  ${fmt(c)}`);
for (const p of piezas) {
	if (p === objetivo) continue;
	const cs = ubicados(p).filter((c) => propios.some((q) => largo(restar(c.base, q.base)) < radio));
	if (cs.length === 0) continue;
	console.log(`\nVecina ${p.archivo} (${bib.archivo(p.archivo)?.titulo}) línea ${p.linea}`);
	for (const c of cs) console.log(`  ${fmt(c)}`);
}
