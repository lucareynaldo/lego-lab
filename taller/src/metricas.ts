// Métricas de un modelo. Informan, no deciden: ver diseno/proceso.md, "Calidad: tres capas".

import {mkdirSync} from 'node:fs';
import {basename, join} from 'node:path';
import {cajaEnMundo, mallaDe} from '../../verificador/src/geometria.ts';
import type {Biblioteca} from '../../verificador/src/ldraw.ts';
import {esPieza, pasosDe} from '../../verificador/src/ldraw.ts';
import type {Transform} from '../../verificador/src/matematica.ts';
import {cajaVacia, componer, expandirCaja, IDENTIDAD} from '../../verificador/src/matematica.ts';
import {DIR_CACHE, nuevaBiblioteca} from './entorno.ts';
import {cambioSilueta, dimensionFractal, leerBinaria, type Imagen} from './imagen.ts';
import {renderizar, type PedidoRender} from './render.ts';
import {validarModelo} from './validar.ts';

export const esBasica = (titulo: string) => /^(Brick|Plate|Tile)\s+\d+\s+x\s+\d+(\s+x\s+\d+)?$/.test(titulo.trim());

type PiezaPlana = {archivo: string; color: number; tr: Transform};

// Piezas del modelo en coordenadas del principal y archivos de submodelo usados.
function recorrer(bib: Biblioteca, nombre: string, tr: Transform, color: number, piezas: PiezaPlana[], subs: Set<string>) {
	for (const paso of pasosDe(bib.archivo(nombre)!))
		for (const ref of paso.refs) {
			const a = bib.archivo(ref.archivo);
			const t = componer(tr, ref.transform);
			const c = ref.color === 16 ? color : ref.color;
			if (!a || esPieza(a)) piezas.push({archivo: ref.archivo, color: c, tr: t});
			else {
				subs.add(ref.archivo);
				recorrer(bib, ref.archivo, t, c, piezas, subs);
			}
		}
}

// Pasos globales que numera LDrawLoader: los de cada instancia de archivo alcanzada desde el principal.
function pasosGlobales(bib: Biblioteca, nombre: string): number {
	let n = 0;
	for (const paso of pasosDe(bib.archivo(nombre)!)) {
		n++;
		for (const ref of paso.refs) {
			const a = bib.archivo(ref.archivo);
			if (a && !esPieza(a)) n += pasosGlobales(bib, ref.archivo);
		}
	}
	return n;
}

const iguales = (a: Imagen, b: Imagen) => a.negro.length === b.negro.length && a.negro.every((v, i) => v === b.negro[i]);

export type Metricas = {
	valido: boolean;
	errores: number;
	avisos: number;
	piezas: number;
	pasos: number;
	submodelos: number;
	colores: number;
	noBasicas: number;
	piezasPorPaso: {media: number; max: number};
	studs: {ancho: number; fondo: number; alto: number};
	fractal: number;
	cambioSilueta: {media: number; min: number; pasosInvisibles: number; cuadros: number};
};

const r2 = (x: number) => Math.round(x * 100) / 100;

export async function metricas(ruta: string): Promise<Metricas> {
	const v = await validarModelo(ruta);
	const bib = nuevaBiblioteca();
	const principal = bib.cargarModelo(ruta, basename(ruta));
	const piezas: PiezaPlana[] = [];
	const subs = new Set<string>();
	recorrer(bib, principal, IDENTIDAD, 16, piezas, subs);

	const caja = cajaVacia();
	for (const p of piezas) {
		try {
			const c = cajaEnMundo(mallaDe(bib, p.archivo), p.tr);
			expandirCaja(caja, c.min);
			expandirCaja(caja, c.max);
		} catch {
			// Pieza sin geometría: el verificador ya la reporta.
		}
	}

	const archivos = [principal, ...subs];
	const porPaso = archivos.flatMap((a) => pasosDe(bib.archivo(a)!).map((p) => p.refs.length));
	const titulos = piezas.map((p) => bib.archivo(p.archivo)?.titulo ?? '');

	// Siluetas de frente del modelo completo: final a 512 px (fractal) y un cuadro por paso global a 256 px.
	const dir = join(DIR_CACHE, 'metricas', `${process.pid}-${Date.now()}`);
	mkdirSync(dir, {recursive: true});
	const final = join(dir, 'final.png');
	const pedidos: PedidoRender[] = [{modelo: ruta, vistas: ['frente'], lado: 512, modo: 'silueta', salida: final}];
	const salidas = Array.from({length: pasosGlobales(bib, principal)}, (_, k) => join(dir, `paso-${k + 1}.png`));
	salidas.forEach((salida, k) => pedidos.push({modelo: ruta, vistas: ['frente'], lado: 256, modo: 'silueta', paso: k + 1, salida}));
	renderizar(pedidos);

	// Los cuadros finales idénticos al estado final no aportan cambio: se conserva el primero que lo alcanza.
	let serie = salidas.map(leerBinaria);
	if (serie.length > 0) {
		const ultimo = serie[serie.length - 1];
		serie = serie.slice(0, serie.findIndex((s) => iguales(s, ultimo)) + 1);
	}
	const cambio = cambioSilueta(serie);
	return {
		valido: v.ok,
		errores: v.errores.length,
		avisos: v.avisos.length,
		piezas: piezas.length,
		pasos: porPaso.length,
		submodelos: subs.size,
		colores: new Set(piezas.map((p) => p.color)).size,
		noBasicas: r2(titulos.filter((t) => !esBasica(t)).length / Math.max(1, titulos.length)),
		piezasPorPaso: {media: r2(porPaso.reduce((s, x) => s + x, 0) / Math.max(1, porPaso.length)), max: Math.max(0, ...porPaso)},
		studs: {ancho: r2((caja.max[0] - caja.min[0]) / 20), fondo: r2((caja.max[2] - caja.min[2]) / 20), alto: r2((caja.max[1] - caja.min[1]) / 24)},
		fractal: r2(dimensionFractal(leerBinaria(final))),
		cambioSilueta: {media: r2(cambio.media), min: r2(cambio.min), pasosInvisibles: cambio.pasosInvisibles, cuadros: serie.length},
	};
}
