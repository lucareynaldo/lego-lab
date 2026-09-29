// Arma un .ldr plano con el estado de un sub-armado hasta un paso, para mirar un hallazgo:
// lo colocado antes queda en gris, las piezas señaladas en rojo y la que bloquea en azul.
//
// Uso: node src/vista.ts <modelo.mpd> <reporte.json> <n° de hallazgo> <salida.ldr> [radio=100]
//      (el n° es el índice dentro de reporte.hallazgos; solo se incluye lo que está a menos de
//      `radio` LDU de lo señalado, para que la cámara encuadre la zona del problema)

import {readFileSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Referencia} from './ldraw.ts';
import {Biblioteca, esPieza, parsearReferencia, pasosDe} from './ldraw.ts';
import type {Transform} from './matematica.ts';
import {componer} from './matematica.ts';
import type {Hallazgo} from './verificar.ts';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [ruta, rutaReporte, indice, salida, radioTxt] = process.argv.slice(2);
const radio = Number(radioTxt ?? 100);
const bib = new Biblioteca(join(raiz, '.cache/ldraw'), join(raiz, '.cache/LDCadShadowLibrary-main'));
const principal = bib.cargarModelo(ruta, basename(ruta));
const h: Hallazgo = JSON.parse(readFileSync(rutaReporte, 'utf8')).hallazgos[Number(indice)];
if (!h.piezas) throw new Error('El hallazgo no señala piezas');
// Hallazgos del modelo terminado (colisiones, vuelco): sin paso, se mira el modelo principal completo.
const submodelo = h.submodelo ?? principal;
const hastaPaso = h.paso ?? Infinity;

// El último origen es el bloqueador (así lo arma la regla de inserción); el resto, la pieza que entra.
const bloqueador = h.regla === 'sin-camino-recto' || h.regla === 'orden-sin-camino' || h.regla === 'requiere-subarmado' ||h.regla === 'camino-dudoso' ? h.piezas.at(-1) : undefined;
const senaladas = new Set(bloqueador ? h.piezas.slice(0, -1) : h.piezas);

type P = {archivo: string; tr: Transform; origen: string};
function ubicar(padre: string, ref: Referencia): P[] {
	const a = bib.archivo(ref.archivo);
	if (!a || esPieza(a)) return [{archivo: ref.archivo, tr: ref.transform, origen: `${padre}:${ref.linea}`}];
	return pasosDe(a).flatMap((paso) => paso.refs.flatMap((r) => ubicar(ref.archivo, r).map((p) => ({...p, tr: componer(ref.transform, p.tr)}))));
}

const hasta: {p: P; k: number}[] = [];
pasosDe(bib.archivo(submodelo)!).forEach((paso, k) => {
	if (k + 1 <= hastaPaso) for (const ref of paso.refs) for (const p of ubicar(submodelo, ref)) hasta.push({p, k});
});
const marcadas = hasta.filter(({p}) => senaladas.has(p.origen)).map(({p}) => p.tr.t);
const centro = [0, 1, 2].map((i) => marcadas.reduce((acc, t) => acc + t[i], 0) / Math.max(1, marcadas.length));
const lineas = [`0 Vista: ${h.regla} en ${submodelo} paso ${h.paso ?? "final"}`, `0 ${h.mensaje}`];
for (const {p, k} of hasta) {
	const esSenalada = senaladas.has(p.origen);
	if (k + 1 === hastaPaso && !esSenalada) continue; // del paso actual solo lo señalado
	if (!esSenalada && Math.hypot(...p.tr.t.map((x, i) => x - centro[i])) > radio) continue;
	const color = esSenalada ? 4 : p.origen === bloqueador ? 1 : 7;
	const [x, y, z] = p.tr.t;
	lineas.push(`1 ${color} ${x} ${y} ${z} ${p.tr.r.join(' ')} ${p.archivo}`);
}
// Piezas personalizadas embebidas en el modelo original (no están en la biblioteca LDraw).
const embebidos = new Set<string>();
const pendientes = hasta.map(({p}) => p.archivo);
while (pendientes.length > 0) {
	const n = pendientes.pop()!;
	const a = bib.archivo(n);
	if (!a?.embebido || embebidos.has(n)) continue;
	embebidos.add(n);
	for (const l of a.lineas) {
		const ref = parsearReferencia(l, 0);
		if (ref) pendientes.push(ref.archivo);
	}
}
const partes = ['0 FILE vista.ldr', ...lineas];
for (const n of embebidos) partes.push(`0 FILE ${n}`, ...bib.archivo(n)!.lineas);
writeFileSync(salida, partes.join('\n') + '\n');
console.log(`${salida}: ${lineas.length - 2} piezas`);
