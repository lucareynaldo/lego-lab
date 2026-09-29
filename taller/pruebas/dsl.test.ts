import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {verificar} from '../../verificador/src/verificar.ts';
import {grilla, Modelo} from '../src/dsl.ts';
import {nuevaBiblioteca} from '../src/entorno.ts';

function construirFixture(nombre: string) {
	const dir = mkdtempSync(join(tmpdir(), 'taller dsl '));
	const salida = join(dir, 'modelo.mpd');
	const r = spawnSync(process.execPath, ['--no-warnings', join(import.meta.dirname, 'fixtures', nombre)], {env: {...process.env, TALLER_SALIDA: salida}, encoding: 'utf8'});
	return {r, salida};
}

test('dos 3001 encastrados pasan el verificador sin errores ni avisos', () => {
	const {r, salida} = construirFixture('dos-ladrillos.ts');
	assert.equal(r.status, 0, r.stderr);
	const bib = nuevaBiblioteca();
	const principal = bib.cargarModelo(salida, 'modelo.mpd');
	assert.equal(principal, 'dos-ladrillos.ldr');
	const rep = verificar(bib, principal);
	assert.deepEqual(rep.hallazgos, []);
	assert.equal(rep.piezas, 2);
	const mapa = JSON.parse(readFileSync(salida.replace(/\.mpd$/, '.mapa.json'), 'utf8'));
	assert.match(Object.values(mapa).join('\n'), /dos-ladrillos\.ts:\d+ \(arriba\)/);
});

test('texto: cabecera, STEP y mapa con la numeración de pasosDe', () => {
	const m = new Modelo('x');
	const s = m.sub('s');
	s.poner('3001', 4, {en: grilla(0, 0, 0)});
	s.paso();
	m.raiz.colocar(s);
	const {mpd, mapa} = m.texto();
	const bloqueS = mpd.split('0 FILE s.ldr\n')[1].split('0 NOFILE')[0].split('\n');
	const clave = Object.keys(mapa).find((k) => k.startsWith('s.ldr:'))!;
	const n = Number(clave.split(':')[1]);
	assert.match(bloqueS[n - 1], /^1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001\.dat$/);
	assert.ok(mpd.startsWith('0 FILE x.ldr\n'));
});

test('ids con mayúsculas y .dat; colores por nombre con espacios', () => {
	const m = new Modelo('x');
	const p = m.raiz.poner('3001.DAT', 'reddish brown');
	assert.equal(p.archivo, '3001.dat');
	assert.equal(p.color.codigo, 70);
});

test('errores con la línea del script', () => {
	const m = new Modelo('x');
	const a = m.raiz.poner('3001', 4);
	assert.throws(() => m.raiz.poner('3001', 4, {sobre: a, stud: [9, 9]}), /dsl\.test\.ts:\d+: stud \(9,9\) fuera de rango/);
	assert.throws(() => m.raiz.poner('noexiste', 4), /dsl\.test\.ts:\d+: pieza inexistente: noexiste/);
	const t = m.raiz.poner('3069b', 4, {en: [0, -24, 0]});
	assert.throws(() => m.raiz.poner('3001', 4, {sobre: t, stud: [0, 0]}), /no tiene studs/);
	assert.throws(() => m.raiz.poner('3001', 4, {sobre: a}), /hay que indicar stud/);
	assert.throws(() => m.raiz.poner('3001', 4, {sobre: a, stud: [0, 0], en: [0, 0, 0]}), /una sola forma/);
});

test('nombres saneados, duplicados y ciclos', () => {
	const m = new Modelo('x');
	const s = m.sub('Copa Alta');
	assert.equal(s.archivo, 'copa-alta.ldr');
	assert.throws(() => m.sub('copa alta'), /ya existe/);
	const t = m.sub('t');
	t.colocar(s);
	assert.throws(() => s.colocar(t), /ciclo/);
	assert.throws(() => s.colocar(s), /ciclo/);
});

test('sobre exige que la base esté en el mismo submodelo', () => {
	const m = new Modelo('x');
	const a = m.sub('a').poner('3001', 4);
	assert.throws(() => m.sub('b').poner('3001', 4, {sobre: a, stud: [0, 0]}), /otro submodelo/);
});

test('opciones huérfanas o incoherentes se rechazan', () => {
	const m = new Modelo('x');
	const a = m.raiz.poner('3001', 4);
	assert.throws(() => m.raiz.poner('3001', 4, {stud: [0, 0]}), /dsl\.test\.ts:\d+: stud sin "sobre"/);
	assert.throws(() => m.raiz.poner('3001', 4, {antistud: [0, 0]}), /antistud sin "debajo"/);
	assert.throws(() => m.raiz.poner('3001', 4, {propio: 0}), /propio sin "conector"/);
	assert.throws(() => m.raiz.poner('3001', 4, {con: [0, 0]}), /con sin/);
	assert.throws(() => m.raiz.poner('3001', 4, {rot: 'Y90'}), /rot sin "en"/);
	assert.throws(() => m.raiz.poner('3001', 4, {en: [0, 0, 0], giro: 90}), /giro sin/);
	assert.throws(() => m.raiz.poner('3001', 4, {sobre: a, stud: [0, 0], giro: 45}), /giro debe ser 0, 90, 180 o 270/);
});

test('con conector se admite cualquier giro', () => {
	const m = new Modelo('x');
	const a = m.raiz.poner('3001', 4);
	const b = m.raiz.poner('3001', 4, {conector: {de: a, n: 0}, propio: 0, giro: 45});
	assert.ok(b);
});

test('colocar con rot inválido lleva la línea del script', () => {
	const m = new Modelo('x');
	const s = m.sub('s');
	assert.throws(() => m.raiz.colocar(s, {rot: 'Q9'}), /dsl\.test\.ts:\d+: /);
});
