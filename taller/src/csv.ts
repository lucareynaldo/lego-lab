import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {createGunzip} from 'node:zlib';

// Separa una línea CSV respetando comillas ("a, b" es un campo; "" es una comilla).
export function campos(linea: string): string[] {
	const out: string[] = [];
	let actual = '';
	let comillas = false;
	for (let i = 0; i < linea.length; i++) {
		const ch = linea[i];
		if (comillas) {
			if (ch === '"' && linea[i + 1] === '"') (actual += '"'), i++;
			else if (ch === '"') comillas = false;
			else actual += ch;
		} else if (ch === '"') comillas = true;
		else if (ch === ',') out.push(actual), (actual = '');
		else actual += ch;
	}
	out.push(actual);
	return out;
}

// Filas de un CSV (opcionalmente .gz), sin la cabecera.
export async function* lineasCsv(ruta: string): AsyncGenerator<string[]> {
	const entrada = ruta.endsWith('.gz') ? createReadStream(ruta).pipe(createGunzip()) : createReadStream(ruta);
	let primera = true;
	for await (const l of createInterface({input: entrada, crlfDelay: Infinity})) {
		if (primera) {
			primera = false;
			continue;
		}
		if (l) yield campos(l);
	}
}
