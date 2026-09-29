// Rutas de datos (en .cache/, fuera de git) y bibliotecas LDraw.

import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Biblioteca} from '../../verificador/src/ldraw.ts';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DIR_LDRAW = process.env.LDRAW_DIR ?? join(RAIZ, '.cache/ldraw');
export const DIR_SOMBRA = process.env.LDCAD_SHADOW_DIR ?? join(RAIZ, '.cache/LDCadShadowLibrary-main');
export const DIR_REBRICKABLE = join(RAIZ, '.cache/rebrickable');
export const DIR_CACHE = join(RAIZ, '.cache/taller');
export const DIR_ESTUDIO = join(RAIZ, 'estudio');

// Para consultar piezas: los archivos de la biblioteca se cachean por proceso.
let compartida: Biblioteca | null = null;
export const biblioteca = () => (compartida ??= new Biblioteca(DIR_LDRAW, DIR_SOMBRA));

// Para cargar un modelo: sus archivos embebidos quedan en esta instancia y no se mezclan con otros.
export const nuevaBiblioteca = () => new Biblioteca(DIR_LDRAW, DIR_SOMBRA);
