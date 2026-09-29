import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {argsCorrida, prepararCarpeta} from '../../src/experimento/correr.ts';

test('prepararCarpeta: consigna sin placeholders, import file:/// y hechos copiados', () => {
	const base = mkdtempSync(join(tmpdir(), 'corr-test-'));
	const dir = prepararCarpeta({id: 'r99', nivel: 'low', orden: 0}, base);
	assert.equal(dir, join(base, 'r99'));
	const consigna = readFileSync(join(dir, 'consigna.md'), 'utf8');
	assert.ok(!consigna.includes('{{'));
	assert.ok(!consigna.includes('<!--'));
	assert.match(consigna, /import \{Modelo, grilla\} from 'file:\/\/\/.*dsl\.ts';/);
	assert.ok(consigna.includes(dir.split(String.fromCharCode(92)).join('/')));
	assert.ok(existsSync(join(dir, 'hechos-arbol.md')));
});

test('argsCorrida: nivel, tope y sin --bare', () => {
	const a = argsCorrida('max', 30);
	assert.equal(a[a.indexOf('--effort') + 1], 'max');
	assert.equal(a[a.indexOf('--max-budget-usd') + 1], '30');
	assert.ok(!a.includes('--bare'));
	assert.equal(a[a.indexOf('--setting-sources') + 1], '');
	assert.ok(a.includes('stream-json') && a.includes('--verbose'));
});

test('correrTodas: respeta la concurrencia, termina todas y reanuda solo lo de infraestructura', async () => {
	const {correrTodas} = await import('../../src/experimento/correr.ts');
	const {readdirSync} = await import('node:fs');
	const raiz = mkdtempSync(join(tmpdir(), 'corr-pool-'));
	const registro = join(raiz, 'registro.txt');
	writeFileSync(registro, '');
	process.env.CLAUDE_BIN = join(import.meta.dirname, 'fixtures/claude-falso.mjs');
	process.env.REGISTRO_FALSO = registro;
	process.env.FALSO_CAE = 'f3';
	const corridas = Array.from({length: 5}, (_, i) => ({id: `f${i + 1}`, nivel: 'low' as const, orden: i}));
	const op = {concurrencia: 2, tope: 1, limiteMin: 1, corridas, base: join(raiz, 'trabajo'), salida: join(raiz, 'salida')};
	await correrTodas(op);

	const eventos = readFileSync(registro, 'utf8').trim().split('\n').map((l) => l.split(' ')).map(([id, t, ms]) => ({id, t, ms: Number(ms)}));
	eventos.sort((a, b) => a.ms - b.ms || (a.t === 'fin' ? -1 : 1));
	let vivos = 0;
	let maximo = 0;
	for (const e of eventos) {
		vivos += e.t === 'inicio' ? 1 : -1;
		maximo = Math.max(maximo, vivos);
	}
	assert.ok(maximo <= 2, `concurrencia máxima ${maximo}`);
	assert.equal(maximo, 2);
	assert.deepEqual(readdirSync(join(raiz, 'salida')).sort(), ['f1', 'f2', 'f3', 'f4', 'f5']);
	const leer = (id: string) => JSON.parse(readFileSync(join(raiz, 'salida', id, 'resultado.json'), 'utf8'));
	assert.equal(leer('f1').resumen.costoUsd, 0.5);
	assert.equal(leer('f1').infraestructura, false);
	assert.equal(leer('f3').infraestructura, true);

	// reanudación: solo f3 (infraestructura) se repite
	process.env.FALSO_CAE = '';
	writeFileSync(registro, '');
	await correrTodas(op);
	const ids = readFileSync(registro, 'utf8').trim().split('\n').filter((l) => l.includes('inicio')).map((l) => l.split(' ')[0]);
	assert.deepEqual(ids, ['f3']);
	assert.equal(leer('f3').infraestructura, false);
});

test('--prueba escribe en el temporal, nunca en la carpeta real de corridas', async () => {
	const {prueba} = await import('../../src/experimento/correr.ts');
	const {tmpdir: tmp} = await import('node:os');
	const raiz = mkdtempSync(join(tmpdir(), 'corr-prueba-'));
	process.env.CLAUDE_BIN = join(import.meta.dirname, 'fixtures/claude-falso.mjs');
	process.env.REGISTRO_FALSO = join(raiz, 'registro.txt');
	process.env.FALSO_CAE = '';
	const salida = await prueba();
	assert.ok(salida.startsWith(tmp()), salida);
	assert.ok(!salida.includes('.cache'));
	assert.equal(JSON.parse(readFileSync(join(salida, 'prueba', 'resultado.json'), 'utf8')).resumen.final, 'ENTREGADO');
});

test('un reintento por infraestructura limpia el destino antes de copiar', async () => {
	const {correrTodas} = await import('../../src/experimento/correr.ts');
	const {mkdirSync} = await import('node:fs');
	const raiz = mkdtempSync(join(tmpdir(), 'corr-limpia-'));
	process.env.CLAUDE_BIN = join(import.meta.dirname, 'fixtures/claude-falso.mjs');
	process.env.REGISTRO_FALSO = join(raiz, 'registro.txt');
	process.env.FALSO_CAE = '';
	const destino = join(raiz, 'salida', 'g1');
	mkdirSync(destino, {recursive: true});
	// restos del intento que falló por infraestructura: una entrega que este intento no produce
	writeFileSync(join(destino, 'modelo.mpd'), '0 viejo');
	writeFileSync(join(destino, 'resultado.json'), JSON.stringify({infraestructura: true}));
	await correrTodas({concurrencia: 1, tope: 1, limiteMin: 1, corridas: [{id: 'g1', nivel: 'low', orden: 0}], base: join(raiz, 'trabajo'), salida: join(raiz, 'salida')});
	assert.ok(!existsSync(join(destino, 'modelo.mpd')));
	assert.equal(JSON.parse(readFileSync(join(destino, 'resultado.json'), 'utf8')).infraestructura, false);
});
