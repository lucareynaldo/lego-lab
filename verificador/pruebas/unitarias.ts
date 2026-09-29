// Pruebas unitarias de reglas de conexión: casos mínimos que no deben romperse al ajustar tolerancias.
// Uso: node --no-warnings pruebas/unitarias.ts   (sale con código 1 si alguna falla)

import type {Conector, Seccion} from '../src/conectores.ts';
import {conexiones} from '../src/conexiones.ts';
import type {Vec3} from '../src/matematica.ts';

const cil = (genero: 'M' | 'F', base: Vec3, eje: Vec3, secs: Seccion[], caps = 'one'): Conector => ({
	id: '',
	grupo: '',
	escala: 'none',
	tipo: 'cil',
	genero,
	base,
	eje,
	secs,
	caps,
	largo: secs.reduce((s, x) => s + x.largo, 0),
});
const S = (forma: string, r: number, largo: number): Seccion => ({forma, r, largo});
const X: Vec3 = [1, 0, 0];
const ARRIBA: Vec3 = [0, -1, 0];

const casos: {nombre: string; a: Conector; b: Conector; conecta: boolean}[] = [
	{
		nombre: 'stud en anti-stud de un ladrillo',
		a: cil('M', [0, 0, 0], ARRIBA, [S('R', 6, 4)]),
		b: cil('F', [0, 0, 0], ARRIBA, [S('R', 6, 20)]),
		conecta: true,
	},
	{
		// Regresión: una muestra en el borde collar/eje caía en el collar y daba "choca".
		nombre: 'pin-eje con collar dentro de un buje',
		a: cil('M', [-10, 0, 20], X, [S('L_', 6.25, 2), S('R', 6, 16), S('R', 8, 2), S('A', 6, 20)], 'none'),
		b: cil('F', [10, 0, 20], X, [S('A', 6, 20)], 'none'),
		conecta: true,
	},
	{
		nombre: 'pin en agujero de viga Technic',
		a: cil('M', [-10, 0, 0], X, [S('R', 8, 2), S('R', 6, 16), S('_L', 6.25, 2)]),
		b: cil('F', [-10, 0, 0], X, [S('R', 8, 2), S('R', 6, 16), S('R', 8, 2)], 'none'),
		conecta: true,
	},
	{
		// Encastre parcial: el stud queda 2 LDU afuera y solo toca el avellanado (R8) del agujero.
		nombre: 'stud apenas metido en un agujero Technic',
		a: cil('M', [12, 0, 0], [-1, 0, 0], [S('R', 6, 4)]),
		b: cil('F', [10, 0, 0], [-1, 0, 0], [S('R', 8, 2), S('R', 6, 16), S('R', 8, 2)], 'none'),
		conecta: true,
	},
	{
		// Encastre parcial con solape cero: el pin llega justo al borde del agujero.
		nombre: 'pin que llega justo al borde de un agujero',
		a: cil('M', [-40, 0, 0], X, [S('R', 6, 20)], 'none'),
		b: cil('F', [-20, 0, 0], X, [S('R', 6, 20)], 'none'),
		conecta: true,
	},
	{
		nombre: 'pin a 5 LDU de un agujero (no conecta)',
		a: cil('M', [-45, 0, 0], X, [S('R', 6, 20)], 'none'),
		b: cil('F', [-20, 0, 0], X, [S('R', 6, 20)], 'none'),
		conecta: false,
	},
	{
		nombre: 'pin redondo en agujero de eje (no entra)',
		a: cil('M', [0, 0, 0], X, [S('R', 6, 20)]),
		b: cil('F', [0, 0, 0], X, [S('A', 6, 20)], 'none'),
		conecta: false,
	},
	{
		// El anti-stud de un ladrillo mide 20 LDU, pero un stud solo entra 4: con la base 12 LDU adentro, las
		// dos piezas están encimadas.
		nombre: 'stud con la base metida 12 LDU en un anti-stud (no conecta)',
		a: cil('M', [0, -12, 0], ARRIBA, [S('R', 6, 4)]),
		b: cil('F', [0, 0, 0], ARRIBA, [S('R', 6, 20)]),
		conecta: false,
	},
	{
		nombre: 'stud a medio stud de distancia (no conecta)',
		a: cil('M', [0, 0, 0], ARRIBA, [S('R', 6, 4)]),
		b: cil('F', [10, 0, 0], ARRIBA, [S('R', 6, 20)]),
		conecta: false,
	},
];

let fallas = 0;
for (const c of casos) {
	const ok = conexiones([{pieza: 0, c: c.a}, {pieza: 1, c: c.b}]).length > 0 === c.conecta;
	if (!ok) fallas++;
	console.log(`${ok ? '✓' : '✗'} ${c.nombre}`);
}
// Agujero pasante: el macho puede salir por los dos lados solo si su perfil pasa por el agujero.
const pasantes: {nombre: string; a: Conector; b: Conector; ambos: boolean}[] = [
	{
		nombre: 'pin sin collar en agujero Technic: sale por los dos lados',
		a: cil('M', [-10, 0, 0], X, [S('R', 6, 20)], 'none'),
		b: cil('F', [-10, 0, 0], X, [S('R', 8, 2), S('R', 6, 16), S('R', 8, 2)], 'none'),
		ambos: true,
	},
	{
		// El collar (R8) del pin queda en el avellanado; no pasa por la parte angosta (R6) del agujero.
		nombre: 'pin con collar en agujero Technic: sale solo por donde entró',
		a: cil('M', [-20, 0, 0], X, [S('R', 6, 18), S('R', 8, 4), S('R', 6, 18)], 'none'),
		b: cil('F', [0, 0, 0], X, [S('R', 8, 2), S('R', 6, 16), S('R', 8, 2)], 'none'),
		ambos: false,
	},
];
for (const c of pasantes) {
	const con = conexiones([{pieza: 0, c: c.a}, {pieza: 1, c: c.b}]);
	const ok = con.length === 1 && con[0].ejes.length === 1 && con[0].ejes[0].ambos === c.ambos;
	if (!ok) fallas++;
	console.log(`${ok ? '✓' : '✗'} ${c.nombre}`);
}
const total = casos.length + pasantes.length;
console.log(`\n${total - fallas}/${total} pruebas bien`);
process.exitCode = fallas > 0 ? 1 : 0;
