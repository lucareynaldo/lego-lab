import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cambioSilueta, dimensionFractal, type Imagen} from '../src/imagen.ts';
import {esBasica} from '../src/metricas.ts';

const vacia = (n: number): Imagen => ({ancho: n, alto: n, negro: new Uint8Array(n * n)});

test('una línea vertical tiene dimensión ~1', () => {
	const img = vacia(256);
	for (let y = 0; y < 256; y++) img.negro[y * 256 + 100] = 1;
	assert.ok(Math.abs(dimensionFractal(img) - 1) < 0.05);
});

test('un tablero de 1 px tiene dimensión ~2', () => {
	const img = vacia(256);
	for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) img.negro[y * 256 + x] = (x + y) % 2;
	assert.ok(Math.abs(dimensionFractal(img) - 2) < 0.05);
});

test('un cuadrado lleno se mide por su borde: ~1', () => {
	const img = vacia(256);
	for (let y = 64; y < 192; y++) for (let x = 64; x < 192; x++) img.negro[y * 256 + x] = 1;
	assert.ok(Math.abs(dimensionFractal(img) - 1) < 0.2);
});

test('cambioSilueta: fracción de píxeles cambiados sobre el área final', () => {
	const a = vacia(10);
	const b = vacia(10);
	const c = vacia(10);
	for (let i = 0; i < 10; i++) (b.negro[i] = 1), (c.negro[i] = 1);
	for (let i = 10; i < 20; i++) c.negro[i] = 1;
	const r = cambioSilueta([a, b, c, c]);
	assert.deepEqual(r.porPaso, [0, 0.5, 0.5, 0]);
	assert.equal(r.pasosInvisibles, 2);
	assert.equal(r.min, 0);
});

test('esBasica', () => {
	assert.equal(esBasica('Brick  2 x  4'), true);
	assert.equal(esBasica('Plate  1 x  2'), true);
	assert.equal(esBasica('Brick  1 x  1 x  5'), true);
	assert.equal(esBasica('Tile  2 x  2'), true);
	assert.equal(esBasica('Slope Brick 45  2 x  2'), false);
	assert.equal(esBasica('Brick  1 x  1 with Stud on 1 Side'), false);
	assert.equal(esBasica('Tile  2 x  2 Round'), false);
});
