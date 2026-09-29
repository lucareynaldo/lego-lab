import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {pathToFileURL} from 'node:url';

const CLI = join(import.meta.dirname, '../src/cli.ts');
const correr = (args: string[], cwd?: string) => spawnSync(process.execPath, ['--no-warnings', CLI, ...args], {encoding: 'utf8', cwd});

test('piezas buscar devuelve JSON ordenado por frecuencia', () => {
	const r = correr(['piezas', 'buscar', 'brick', '2', 'x', '4', '--max', '3']);
	assert.equal(r.status, 0, r.stderr);
	const j = JSON.parse(r.stdout);
	assert.equal(j[0].id, '3001');
	assert.equal(j.length, 3);
});

test('piezas ver 3001', () => {
	const r = correr(['piezas', 'ver', '3001']);
	assert.equal(r.status, 0, r.stderr);
	const j = JSON.parse(r.stdout);
	assert.equal(j.studs.cantidad, 8);
	assert.ok(j.colores.some((c: {codigo: number}) => c.codigo === 4));
});

test('construir en una carpeta con espacios y validar OK', () => {
	const dir = mkdtempSync(join(tmpdir(), 'taller cli '));
	const script = join(dir, 'mi diseno.ts');
	// El fixture importa '../../src/dsl.ts'; desde otra carpeta hace falta una URL file:// absoluta
	// (en Windows, "C:/…" como especificador ESM se lee como un esquema "c:").
	const fuente = readFileSync(join(import.meta.dirname, 'fixtures/dos-ladrillos.ts'), 'utf8');
	writeFileSync(script, fuente.replace('../../src/dsl.ts', pathToFileURL(join(import.meta.dirname, '../src/dsl.ts')).href));
	const c = correr(['construir', script, '--salida', join(dir, 'modelo.mpd')], dir);
	assert.equal(c.status, 0, c.stderr);
	assert.ok(existsSync(join(dir, 'modelo.mpd')));
	const v = correr(['validar', join(dir, 'modelo.mpd')], dir);
	assert.equal(v.status, 0, v.stdout + v.stderr);
	assert.equal(JSON.parse(v.stdout).ok, true);
});

test('validar un modelo roto señala la línea del script', () => {
	const dir = mkdtempSync(join(tmpdir(), 'taller cli '));
	const c = correr(['construir', join(import.meta.dirname, 'fixtures/flotante.ts'), '--salida', join(dir, 'modelo.mpd')], dir);
	assert.equal(c.status, 0, c.stderr);
	const v = correr(['validar', join(dir, 'modelo.mpd')], dir);
	assert.equal(v.status, 1);
	const j = JSON.parse(v.stdout);
	assert.equal(j.ok, false);
	// El verificador puede señalar la pieza suelta, la base o las dos: alcanza con que traduzca a líneas del script.
	assert.ok(j.errores.some((e: {donde: string[]}) => e.donde.some((d) => /flotante\.ts:\d+/.test(d))), v.stdout);
});

test('comando desconocido: código 2 y uso', () => {
	const r = correr(['volar']);
	assert.equal(r.status, 2);
	assert.match(r.stderr, /Uso:/);
});
