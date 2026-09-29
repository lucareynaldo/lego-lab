import assert from 'node:assert/strict';
import {test} from 'node:test';
import {coloresEquivalentes, colorDe} from '../src/colores.ts';
import {campos} from '../src/csv.ts';
import {biblioteca} from '../src/entorno.ts';

test('campos respeta comillas con comas', () => {
	assert.deepEqual(campos('3001,"Brick 2 x 4, Classic",11,Plastic'), ['3001', 'Brick 2 x 4, Classic', '11', 'Plastic']);
	assert.deepEqual(campos('a,"con ""comillas""",c'), ['a', 'con "comillas"', 'c']);
});

test('colorDe acepta código, nombre LDraw y nombre con espacios', () => {
	const bib = biblioteca();
	assert.equal(colorDe(bib, 70).codigo, 70);
	assert.equal(colorDe(bib, 'Reddish_Brown').codigo, 70);
	assert.equal(colorDe(bib, 'reddish brown').codigo, 70);
	assert.equal(colorDe(bib, '4').codigo, 4);
	assert.throws(() => colorDe(bib, 'violeta imaginario'), /color desconocido/);
});

test('los colores sólidos clásicos coinciden entre LDraw y Rebrickable', async () => {
	const eq = await coloresEquivalentes();
	for (const c of [0, 1, 2, 4, 14, 15, 19, 70, 71, 72]) assert.ok(eq.has(c), `color ${c}`);
});
