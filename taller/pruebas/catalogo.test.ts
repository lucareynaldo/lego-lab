import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buscar, catalogo, esUsable} from '../src/catalogo.ts';

test('esUsable descarta alias, movidas y subpartes', () => {
	assert.equal(esUsable('0 Brick  2 x  4\n0 !LDRAW_ORG Part UPDATE 2004-03'), true);
	assert.equal(esUsable('0 ~Moved to 3001\n0 !LDRAW_ORG Part'), false);
	assert.equal(esUsable('0 =Brick  2 x  4\n0 !LDRAW_ORG Part Alias'), false);
	assert.equal(esUsable('0 _Brick  2 x  4 Mirrored\n0 !LDRAW_ORG Part'), false);
	assert.equal(esUsable('0 Brick  2 x  4 Red\n0 !LDRAW_ORG Part Physical_Colour'), false);
});

test('buscar ordena por frecuencia y filtra piezas nunca vendidas', async () => {
	const cat = await catalogo();
	const r = buscar(cat, 'brick 2 x 4');
	assert.equal(r[0].id, '3001');
	assert.ok(r.every((e) => e.frecuencia > 0));
	assert.ok(r[0].colores.includes(4) && r[0].colores.includes(15));
});

test('buscar por id exacto lo pone primero; --todas incluye piezas sin inventario', async () => {
	const cat = await catalogo();
	assert.equal(buscar(cat, '3471', {todas: true})[0].id, '3471');
	const arboles = buscar(cat, 'plant tree', {todas: true, max: 100}).map((e) => e.id);
	assert.ok(arboles.includes('3471'));
});

test('filtro por categoría', async () => {
	const cat = await catalogo();
	const r = buscar(cat, 'slope', {categoria: 'Slope', max: 50});
	assert.ok(r.length > 0 && r.every((e) => e.categoria.toLowerCase() === 'slope'));
});
