import assert from 'node:assert/strict';
import {test} from 'node:test';
import {biblioteca} from '../src/entorno.ts';
import {archivoDe, ficha, puntoGrilla} from '../src/ficha.ts';

test('archivoDe normaliza ids', () => {
	assert.equal(archivoDe('3001'), '3001.dat');
	assert.equal(archivoDe('3001.DAT'), '3001.dat');
	assert.equal(archivoDe('s\\3001s01'), 's/3001s01.dat');
});

test('3001: 8 studs en 4×2, 8 anti-studs, 4×3×2', () => {
	const f = ficha(biblioteca(), '3001');
	assert.equal(f.studs.puntos.length, 8);
	assert.deepEqual([f.studs.columnas, f.studs.filas], [4, 2]);
	assert.equal(f.antistuds.puntos.length, 8);
	assert.deepEqual(f.tamano, {x: 4, y: 3, z: 2});
	const s00 = puntoGrilla(f.studs, [0, 0], 'stud');
	assert.deepEqual(s00.pos.map(Math.round), [-30, 0, -10]);
	const a00 = puntoGrilla(f.antistuds, [0, 0], 'anti-stud');
	assert.deepEqual(a00.pos.map(Math.round), [-30, 24, -10]);
});

test('puntoGrilla fuera de rango da un error claro', () => {
	const f = ficha(biblioteca(), '3001');
	assert.throws(() => puntoGrilla(f.studs, [4, 0], 'stud'), /stud \(4,0\) fuera de rango: la pieza tiene 4×2/);
});

test('una baldosa lisa no tiene studs', () => {
	const f = ficha(biblioteca(), '3069b');
	assert.equal(f.studs.puntos.length, 0);
	assert.throws(() => puntoGrilla(f.studs, [0, 0], 'stud'), /no tiene studs/);
});

test('piezas 1×N: anti-studs de sección cuadrada', () => {
	const bib = biblioteca();
	const f = ficha(bib, '3008');
	assert.equal(f.antistuds.puntos.length, 8);
	assert.deepEqual([f.antistuds.columnas, f.antistuds.filas], [8, 1]);
	assert.equal(ficha(bib, '4477').antistuds.puntos.length, 10);
	assert.equal(ficha(bib, '15672').antistuds.puntos.length, 2);
});
