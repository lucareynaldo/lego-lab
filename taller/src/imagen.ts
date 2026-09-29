// Siluetas: PNG → imagen binaria, dimensión fractal del borde (conteo de cajas) y cambio entre pasos.
// La dimensión fractal se mide sobre el borde, como en los estudios de preferencia (Spehar et al.
// 2003; Hagerhall et al. 2004), donde las siluetas naturales preferidas están cerca de 1,3–1,5.

import {readFileSync} from 'node:fs';
import {PNG} from 'pngjs';

export type Imagen = {ancho: number; alto: number; negro: Uint8Array};

export function leerBinaria(ruta: string): Imagen {
	const png = PNG.sync.read(readFileSync(ruta));
	const negro = new Uint8Array(png.width * png.height);
	for (let i = 0; i < negro.length; i++) {
		const [r, g, b] = [png.data[i * 4], png.data[i * 4 + 1], png.data[i * 4 + 2]];
		negro[i] = 0.299 * r + 0.587 * g + 0.114 * b < 128 ? 1 : 0;
	}
	return {ancho: png.width, alto: png.height, negro};
}

function borde({ancho, alto, negro}: Imagen): Uint8Array {
	const b = new Uint8Array(ancho * alto);
	for (let y = 0; y < alto; y++)
		for (let x = 0; x < ancho; x++) {
			const i = y * ancho + x;
			if (!negro[i]) continue;
			const orilla = x === 0 || y === 0 || x === ancho - 1 || y === alto - 1;
			if (orilla || !negro[i - 1] || !negro[i + 1] || !negro[i - ancho] || !negro[i + ancho]) b[i] = 1;
		}
	return b;
}

function pendiente(xs: number[], ys: number[]): number {
	const n = xs.length;
	const mx = xs.reduce((s, x) => s + x, 0) / n;
	const my = ys.reduce((s, y) => s + y, 0) / n;
	let num = 0;
	let den = 0;
	for (let i = 0; i < n; i++) (num += (xs[i] - mx) * (ys[i] - my)), (den += (xs[i] - mx) ** 2);
	return den === 0 ? 0 : num / den;
}

export function dimensionFractal(img: Imagen): number {
	const b = borde(img);
	const xs: number[] = [];
	const ys: number[] = [];
	for (let s = 2; s <= Math.min(img.ancho, img.alto) / 4; s *= 2) {
		let n = 0;
		for (let by = 0; by < img.alto; by += s)
			for (let bx = 0; bx < img.ancho; bx += s) {
				let hay = false;
				for (let y = by; y < Math.min(by + s, img.alto) && !hay; y++)
					for (let x = bx; x < Math.min(bx + s, img.ancho); x++)
						if (b[y * img.ancho + x]) {
							hay = true;
							break;
						}
				if (hay) n++;
			}
		if (n > 0) xs.push(Math.log(1 / s)), ys.push(Math.log(n));
	}
	return xs.length < 2 ? 0 : pendiente(xs, ys);
}

const INVISIBLE = 0.01;

export function cambioSilueta(pasos: Imagen[]) {
	if (pasos.length === 0) return {porPaso: [], media: 0, min: 0, pasosInvisibles: 0};
	const final = pasos[pasos.length - 1].negro.reduce((s, v) => s + v, 0) || 1;
	let previo: Uint8Array = new Uint8Array(pasos[0].negro.length);
	const porPaso = pasos.map((img) => {
		let distintos = 0;
		for (let i = 0; i < img.negro.length; i++) if (img.negro[i] !== previo[i]) distintos++;
		previo = img.negro;
		return distintos / final;
	});
	return {
		porPaso,
		media: porPaso.reduce((s, x) => s + x, 0) / porPaso.length,
		min: Math.min(...porPaso),
		pasosInvisibles: porPaso.filter((x) => x < INVISIBLE).length,
	};
}
