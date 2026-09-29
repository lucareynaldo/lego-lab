import {join} from 'node:path';
import {renderizar} from '../render.ts';

export type Imagenes = {grilla: string; silueta: string};

// Un solo renderizar con los dos pedidos: grilla 2×2 a 512 px por vista y silueta de frente a 64 px.
export function imagenesEstandar(modelo: string, salidaDir: string, nombre: string): Imagenes {
	const grilla = join(salidaDir, `${nombre}-grilla.png`);
	const silueta = join(salidaDir, `${nombre}-silueta.png`);
	renderizar([
		{modelo, vistas: ['34', 'frente', 'lado', '34atras'], lado: 512, modo: 'color', salida: grilla},
		{modelo, vistas: ['frente'], lado: 64, modo: 'silueta', salida: silueta},
	]);
	return {grilla, silueta};
}
