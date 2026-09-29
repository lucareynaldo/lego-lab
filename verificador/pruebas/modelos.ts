// Pruebas con modelos: cada modelo de prueba tiene que disparar exactamente las reglas de error esperadas.
// Es la red contra "arreglos" que bajan falsos positivos apagando detecciones reales.
// Uso: node --no-warnings pruebas/modelos.ts   (sale con código 1 si alguna falla)

import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Biblioteca} from '../src/ldraw.ts';
import {verificar} from '../src/verificar.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '../..');

// Reglas de error que cada modelo debe disparar (y ninguna otra), y avisos que no pueden faltar.
const esperado: Record<string, {errores: string[]; avisos?: string[]}> = {
	'voladizo-bien.ldr': {errores: []},
	// En el orden del archivo el ladrillo no entra, pero existe otro orden: es un problema de los pasos.
	'voladizo-mal-ordenado.ldr': {errores: [], avisos: ['orden-sin-camino']},
	// Un ladrillo levantado 40 LDU (queda suelto: flotante en su paso, flota en el modelo terminado y el
	// sub-armado del murciélago termina en dos partes), otro encimado sobre uno existente (superpuestas:
	// comparten volumen) y una pieza inexistente. Antes, un stud metido 16 LDU dentro del ladrillo de
	// arriba contaba como encastre y escondía que el ladrillo levantado estaba suelto.
	'murcielago-roto.mpd': {errores: ['pieza-inexistente', 'superpuestas', 'flotante', 'flota', 'subarmado-en-varias-partes']},
	// Pieza por pieza no hay orden: el par de arriba (unido por un pin con collar) solo baja entero. Se
	// arma preparando ese par aparte, así que no es un error sino un aviso que pide el sub-armado.
	'trabado.ldr': {errores: [], avisos: ['requiere-subarmado']},
	// El mismo modelo con ese par como sub-armado: se arma.
	'trabado-con-subarmado.mpd': {errores: []},
	// Un ladrillo apoyado sobre los studs sin encastrar: no está en el aire, pero se cae al levantarlo.
	'apoyado.ldr': {errores: [], avisos: ['apoyado-sin-conexion']},
};

let fallas = 0;
for (const [archivo, {errores: reglas, avisos = []}] of Object.entries(esperado)) {
	const bib = new Biblioteca(join(raiz, '.cache/ldraw'), join(raiz, '.cache/LDCadShadowLibrary-main'));
	const principal = bib.cargarModelo(join(aqui, archivo), archivo);
	const r = verificar(bib, principal);
	const obtenidas = [...new Set(r.hallazgos.filter((h) => h.severidad === 'error').map((h) => h.regla))].sort();
	const avisosObtenidos = new Set(r.hallazgos.filter((h) => h.severidad === 'aviso').map((h) => h.regla));
	const faltan = avisos.filter((a) => !avisosObtenidos.has(a));
	const ok = JSON.stringify(obtenidas) === JSON.stringify([...reglas].sort()) && faltan.length === 0;
	if (!ok) fallas++;
	console.log(`${ok ? '✓' : '✗'} ${archivo}: ${obtenidas.join(', ') || 'sin errores'}${ok ? '' : `  (esperado: ${reglas.join(', ') || 'sin errores'}${faltan.length ? `; faltan avisos: ${faltan.join(', ')}` : ''})`}`);
}
console.log(`\n${Object.keys(esperado).length - fallas}/${Object.keys(esperado).length} modelos de prueba bien`);
process.exitCode = fallas > 0 ? 1 : 0;
