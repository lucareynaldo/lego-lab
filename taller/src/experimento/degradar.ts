import {mezclar} from './azar.ts';

export type TipoDegradacion = 'quitar' | 'recolorear' | 'tosca';

const COLORES = [1, 2, 4, 14, 15, 0, 71, 70];
const LINEA_1 = /^(1\s+)(\S+)(\s+)((?:\S+\s+){11}\S+)(\s+)(.+?)(\s*)$/;

function nombreNorm(n: string): string {
	return n.trim().split('\\').join('/').toLowerCase();
}

// Índices de las líneas tipo 1 que referencian una pieza (.dat), no un submodelo.
function lineasDePieza(lineas: string[]): number[] {
	const bloques = new Set<string>();
	for (const l of lineas) {
		const m = /^0\s+FILE\s+(.+?)\s*$/.exec(l);
		if (m) bloques.add(nombreNorm(m[1]!));
	}
	const r: number[] = [];
	lineas.forEach((l, i) => {
		const m = LINEA_1.exec(l);
		if (!m) return;
		const archivo = nombreNorm(m[6]!);
		if (/\.(ldr|mpd)$/.test(archivo) || bloques.has(archivo)) return;
		r.push(i);
	});
	return r;
}

export function degradar(mpd: string, tipo: TipoDegradacion, azar: () => number): string {
	const lineas = mpd.split('\n');
	const piezas = lineasDePieza(lineas);
	const n = piezas.length;
	if (tipo === 'tosca') {
		for (const i of piezas) {
			const m = LINEA_1.exec(lineas[i]!)!;
			lineas[i] = `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}3005.dat${m[7]}`;
		}
		return lineas.join('\n');
	}
	const elegidas = mezclar(piezas, azar).slice(0, Math.round((tipo === 'quitar' ? 0.3 : 0.5) * n));
	if (tipo === 'quitar') {
		const fuera = new Set(elegidas);
		return lineas.filter((_, i) => !fuera.has(i)).join('\n');
	}
	for (const i of elegidas) {
		const m = LINEA_1.exec(lineas[i]!)!;
		const posibles = COLORES.filter((c) => String(c) !== m[2]);
		const c = posibles[Math.floor(azar() * posibles.length)]!;
		lineas[i] = `${m[1]}${c}${m[3]}${m[4]}${m[5]}${m[6]}${m[7]}`;
	}
	return lineas.join('\n');
}
