import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {PNG} from 'pngjs';
import {RAIZ} from '../../src/entorno.ts';
import {extraerSub, renderizar} from '../../src/render.ts';

const SET = join(RAIZ, 'referencias/sets-test/modelos/40014-1.mpd');

test('extraerSub pone primero el bloque pedido', () => {
	const mpd = '0 FILE a.ldr\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 b.ldr\n0 NOFILE\n0 FILE b.ldr\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat\n0 NOFILE\n';
	assert.ok(extraerSub(mpd, 'b').startsWith('0 FILE b.ldr\n'));
	assert.throws(() => extraerSub(mpd, 'c'), /no existe el submodelo c/);
});

test('grilla de 4 vistas en color y silueta a 64 px', {timeout: 10 * 60 * 1000}, () => {
	const dir = mkdtempSync(join(tmpdir(), 'taller render '));
	const color = join(dir, 'color.png');
	const silueta = join(dir, 'silueta.png');
	renderizar([
		{modelo: SET, vistas: ['34', 'frente', 'lado', '34atras'], lado: 256, modo: 'color', salida: color},
		{modelo: SET, vistas: ['frente'], lado: 64, modo: 'silueta', salida: silueta},
	]);
	assert.ok(existsSync(color) && existsSync(silueta));
	const c = PNG.sync.read(readFileSync(color));
	assert.deepEqual([c.width, c.height], [512, 512]);
	const s = PNG.sync.read(readFileSync(silueta));
	assert.deepEqual([s.width, s.height], [64, 64]);
	// Silueta: casi todo negro o blanco (el antialiasing deja grises en el borde).
	let extremos = 0;
	let negros = 0;
	for (let i = 0; i < s.data.length; i += 4) {
		const v = s.data[i];
		if (v < 32 || v > 223) extremos++;
		if (v < 128) negros++;
	}
	assert.ok(extremos / (s.width * s.height) > 0.9);
	assert.ok(negros > 0);
});
