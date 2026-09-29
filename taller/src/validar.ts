// Corre el verificador y traduce las ubicaciones "submodelo:línea" a líneas del script de diseño.

import {existsSync, readFileSync} from 'node:fs';
import {basename} from 'node:path';
import {normalizarNombre} from '../../verificador/src/ldraw.ts';
import {verificar} from '../../verificador/src/verificar.ts';
import {combinaciones} from './colores.ts';
import {nuevaBiblioteca} from './entorno.ts';

export type HallazgoTaller = {regla: string; mensaje: string; submodelo?: string; paso?: number; donde: string[]};
export type ResultadoValidar = {ok: boolean; piezas: number; pasos: number; submodelos: number; errores: HallazgoTaller[]; avisos: HallazgoTaller[]};

export const nombreSub = (sub: string) => normalizarNombre(/\.(ldr|dat|mpd)$/i.test(sub) ? sub : `${sub}.ldr`);

export async function validarModelo(ruta: string, sub?: string): Promise<ResultadoValidar> {
	const rutaMapa = ruta.replace(/\.mpd$/i, '') + '.mapa.json';
	const mapa: Record<string, string> = existsSync(rutaMapa) ? JSON.parse(readFileSync(rutaMapa, 'utf8')) : {};
	const bib = nuevaBiblioteca();
	const principal = bib.cargarModelo(ruta, basename(ruta));
	const raiz = sub ? nombreSub(sub) : principal;
	if (!bib.archivo(raiz)) throw new Error(`no existe el submodelo ${sub}`);
	const rep = verificar(bib, raiz, {combinacionesConocidas: await combinaciones()});
	const traducir = (h: (typeof rep.hallazgos)[number]): HallazgoTaller => ({
		regla: h.regla,
		mensaje: h.mensaje,
		submodelo: h.submodelo,
		paso: h.paso,
		donde: (h.piezas ?? []).map((p) => mapa[p] ?? p),
	});
	const errores = rep.hallazgos.filter((h) => h.severidad === 'error').map(traducir);
	const avisos = rep.hallazgos.filter((h) => h.severidad === 'aviso').map(traducir);
	return {ok: errores.length === 0, piezas: rep.piezas, pasos: rep.pasos, submodelos: rep.submodelos, errores, avisos};
}
