import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {auditar, contaminacion} from '../../src/experimento/auditar.ts';
import {resumirTranscript} from '../../src/experimento/transcript.ts';

const RAIZ = 'C:/Users/User/Documents/github/lego-lab';
const TALLER = `${RAIZ}/taller`;

test('contaminación: prohibidas marcan; binarios, taller/ y librería no; el resto va a rutasFuera', () => {
	const dir = 'C:/Temp/lego-lab-exp01/r03';
	const c = (rutas: string[]) => contaminacion(rutas, [dir], 'r03');
	assert.equal(c([RAIZ + '/referencias/sets-test/x.mpd']).motivos.length, 1);
	assert.equal(c([RAIZ + '/diseno/experimentos/01-arbol-esfuerzo/preregistro.md']).motivos.length, 1);
	assert.equal(c([RAIZ + '/.cache/experimentos/01/corridas/r04/modelo.mpd']).motivos.length, 1);
	assert.equal(c(['C:/Temp/lego-lab-exp01/r04/diseno.ts']).motivos.length, 1);
	const ok = c([dir + '/diseno.ts', TALLER + '/src/dsl.ts', TALLER + '/node_modules/pngjs/a.js', '/c/Program Files/nodejs/node.exe', RAIZ + '/.cache/ldraw/parts/3001.dat', '/dev/null']);
	assert.deepEqual(ok, {motivos: [], fuera: []});
	// .. se colapsa y las relativas se resuelven contra la carpeta de trabajo
	assert.equal(c([TALLER + '/../diseno/x.md']).motivos.length, 1);
	assert.equal(c([dir + '/../r04/x']).motivos.length, 1);
	assert.equal(contaminacion(['../../../diseno/x'], [RAIZ + '/.cache/tmp/r03'], 'r03').motivos.length, 1);
	assert.equal(c(['../r04/modelo.mpd']).motivos.length, 1);
	assert.equal(c(['diseno.ts']).motivos.length + c(['diseno.ts']).fuera.length, 0);
	// calibracion solo delata otra corrida; tree solo como palabra
	assert.deepEqual(c([TALLER + '/pruebas/calibracion.txt']), {motivos: [], fuera: []});
	assert.equal(c(['C:/Users/User/streets/a.txt']).fuera.length, 1);
	assert.equal(c(['C:/Users/User/mi-tree/a.txt']).motivos.length, 1);
	const raro = c(['C:/Users/User/Documents/otra/cosa.txt']);
	assert.deepEqual(raro.motivos, []);
	assert.deepEqual(raro.fuera, ['C:/Users/User/Documents/otra/cosa.txt']);
});

function corrida(base: string, id: string, rutas: string[], mpd?: string) {
	const dir = join(base, 'corridas', id);
	mkdirSync(dir, {recursive: true});
	const resumen = {...resumirTranscript(''), rutasLeidas: rutas};
	writeFileSync(join(dir, 'resultado.json'), JSON.stringify({id, nivel: 'low', resumen}));
	if (mpd) writeFileSync(join(dir, 'modelo.mpd'), mpd);
}

test('auditar: sin modelo no entregó; con 3471.dat lista la prohibida', async () => {
	const base = mkdtempSync(join(tmpdir(), 'aud-test-'));
	const trabajo = join(base, 'trabajo');
	const op = {conMetricas: false, corridas: join(base, 'corridas'), base: trabajo};
	corrida(base, 'r01', [`${RAIZ}/referencias/sets-test/x.mpd`]);
	const a = await auditar('r01', op);
	assert.equal(a.entrego, false);
	assert.equal(a.valido, null);
	assert.equal(a.contaminada, true);
	assert.deepEqual(a.rutasFuera, []);

	const mpd = '0 FILE modelo.mpd\n0 Name: modelo.mpd\n0 STEP\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 3471.dat\n0 STEP\n';
	corrida(base, 'r02', [join(trabajo, 'r02', 'diseno.ts')], mpd);
	const b = await auditar('r02', op);
	assert.equal(b.entrego, true);
	assert.equal(b.contaminada, false);
	assert.deepEqual(b.prohibidas, ['3471']);
	assert.equal(b.metricas, null);
	assert.equal(typeof b.valido, 'boolean');
});

test('auditar: prohibida dentro de un submodelo y pieza normal no marca', async () => {
	const base = mkdtempSync(join(tmpdir(), 'aud-test-'));
	const op = {conMetricas: false, corridas: join(base, 'corridas'), base: join(base, 't')};
	const mpd = '0 FILE modelo.mpd\n0 Name: modelo.mpd\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 sub.ldr\n0 FILE sub.ldr\n0 Name: sub.ldr\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat\n1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3778.dat\n';
	corrida(base, 'r05', [], mpd);
	assert.deepEqual((await auditar('r05', op)).prohibidas, ['3778']);
});

test('contaminación: leer código del experimento marca; listar la carpeta no', () => {
	const dir = 'C:/Temp/lego-lab-exp01/r03';
	const linea = (name: string, input: object) => JSON.stringify({type: 'assistant', message: {content: [{type: 'tool_use', name, input}]}});
	const rutasDe = (...lineas: string[]) => resumirTranscript(lineas.join('\n')).rutasLeidas;
	const c = (rutas: string[]) => contaminacion(rutas, [dir], 'r03');
	assert.equal(c(rutasDe(linea('Read', {file_path: TALLER + '/src/experimento/juez.ts'}))).motivos.length, 1);
	assert.match(c(rutasDe(linea('Read', {file_path: TALLER + '/src/experimento/juez.ts'}))).motivos[0], /leyó código del experimento/);
	assert.equal(c(rutasDe(linea('Bash', {command: 'ls -la ' + TALLER + '/src/experimento'}))).motivos.length, 0);
	assert.equal(c(rutasDe(linea('Bash', {command: 'ls ' + TALLER + '/src/experimento/'}))).motivos.length, 0);
	assert.equal(c(rutasDe(linea('Bash', {command: 'cat ' + TALLER + '/pruebas/experimento/bt.test.ts'}))).motivos.length, 1);
	assert.equal(c(rutasDe(linea('Read', {file_path: TALLER + '/src/dsl.ts'}))).motivos.length, 0);
});
