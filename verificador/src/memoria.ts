// Liberación de memoria entre modelos, para procesos que atienden muchos (banco de pruebas).

import {liberarConectores} from './conectores.ts';
import {liberarGeometria} from './geometria.ts';
import type {Biblioteca} from './ldraw.ts';

// Las piezas embebidas de un modelo quedan en los cachés globales con una clave propia del modelo:
// nadie más las va a usar, así que se borran al terminar con él.
export function liberarModelo(bib: Biblioteca) {
	liberarGeometria(bib.id);
	liberarConectores(bib.id);
}
