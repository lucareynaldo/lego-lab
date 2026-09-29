import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {armarPrompt, combinarOrdenes, juzgarPar, parsearVeredicto, type Veredicto} from '../../src/experimento/juez.ts';
import {DEFINICIONES, elegirJuez} from '../../src/experimento/seleccion-juez.ts';

const v = (general: 'A' | 'B' | 'empate'): Veredicto => ({reconoce: 'A', creatividad: 'A', tecnica: 'A', historia: 'A', general});
const json = '{"reconoce":"A","creatividad":"B","tecnica":"empate","historia":"A","general":"B"}';

test('parsearVeredicto: texto + JSON final', () => {
	assert.deepEqual(parsearVeredicto(`Razono.\nMás texto.\n${json}\n`), {reconoce: 'A', creatividad: 'B', tecnica: 'empate', historia: 'A', general: 'B'});
});

test('parsearVeredicto: JSON inválido, clave faltante o valor inválido dan null', () => {
	assert.equal(parsearVeredicto('x\n{"reconoce":"A"'), null);
	assert.equal(parsearVeredicto('x\n{"reconoce":"A","creatividad":"B","tecnica":"A","historia":"A"}'), null);
	assert.equal(parsearVeredicto(json.replace('"B"}', '"C"}')), null);
	assert.equal(parsearVeredicto(''), null);
});

test('combinarOrdenes: da vuelta ba', () => {
	assert.equal(combinarOrdenes(v('A'), v('B')).general, 'A');
	assert.equal(combinarOrdenes(v('A'), v('A')).general, 'empate');
	assert.equal(combinarOrdenes(v('empate'), v('empate')).general, 'empate');
});

test('armarPrompt: sin placeholders', () => {
	const p = armarPrompt({grilla: 'C:\\a\\g.png', silueta: 'C:\\a\\s.png'}, {grilla: '/b/g.png', silueta: '/b/s.png'}, 'Tema.');
	assert.ok(!p.includes('{{'));
	assert.match(p, /A grilla: C:\/a\/g\.png/);
});

test('elegirJuez: más aciertos, luego consistencia, luego Opus', () => {
	const e = (aciertos: number, consistencia: number) => ({aciertos, total: 30, consistencia, costoUsd: 0});
	assert.equal(elegirJuez({'claude-fable-5-1': e(28, 0.5), 'claude-opus-5-5': e(25, 0.9)}), 'claude-fable-5-1');
	assert.equal(elegirJuez({'claude-fable-5-1': e(26, 0.9), 'claude-opus-5-5': e(25, 0.5)}), 'claude-fable-5-1');
	assert.equal(elegirJuez({'claude-fable-5-1': e(26, 0.5), 'claude-opus-5-5': e(25, 0.5)}), 'claude-opus-5-5');
});

test('juzgarPar con claude falso', async () => {
	process.env.CLAUDE_BIN = join(import.meta.dirname, 'fixtures/juez-falso.mjs');
	const im = {grilla: 'g.png', silueta: 's.png'};
	const dir = mkdtempSync(join(tmpdir(), 'juez-test-'));
	const r = await juzgarPar('claude-opus-5-5', im, im, 'Tema.', dir);
	assert.equal(r.veredicto?.general, 'A');
	assert.equal(r.costoUsd, 0.25);
	process.env.FALSO_VEREDICTO = 'no es json';
	const malo = await juzgarPar('claude-opus-5-5', im, im, 'Tema.', dir);
	assert.equal(malo.veredicto, null);
	assert.equal(malo.costoUsd, 0.5);
	delete process.env.FALSO_VEREDICTO;
});

test('juzgarPar: un juez colgado se mata al vencer el tope y se reintenta una vez', async () => {
	process.env.CLAUDE_BIN = join(import.meta.dirname, 'fixtures/juez-colgado.mjs');
	const im = {grilla: 'g.png', silueta: 's.png'};
	const dir = mkdtempSync(join(tmpdir(), 'juez-tope-'));
	const marca = join(dir, 'colgar-una-vez');
	writeFileSync(marca, '');
	process.env.JUEZ_COLGAR_ARCHIVO = marca;
	try {
		const t0 = Date.now();
		const r = await juzgarPar('claude-opus-5-5', im, im, 'Tema.', dir, 1500);
		assert.equal(r.veredicto?.general, 'B');
		assert.ok(Date.now() - t0 < 15_000);
		process.env.JUEZ_COLGAR_SIEMPRE = '1';
		const t1 = Date.now();
		const nulo = await juzgarPar('claude-opus-5-5', im, im, 'Tema.', dir, 1000);
		assert.equal(nulo.veredicto, null);
		assert.match(nulo.crudo, /tope de 1000 ms/);
		assert.ok(Date.now() - t1 < 15_000);
	} finally {
		delete process.env.JUEZ_COLGAR_ARCHIVO;
		delete process.env.JUEZ_COLGAR_SIEMPRE;
	}
});

test('seleccion-juez documenta la definición de consistencia', () => {
	assert.match(DEFINICIONES.consistencia, /empate\/empate cuenta como inconsistente/i);
	assert.match(DEFINICIONES.consistencia, /null/);
});
