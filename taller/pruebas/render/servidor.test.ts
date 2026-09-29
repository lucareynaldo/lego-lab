import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {PNG} from 'pngjs';
import {DIR_ESTUDIO, RAIZ} from '../../src/entorno.ts';
import {renderizar} from '../../src/render.ts';

const SET = join(RAIZ, 'referencias/sets-test/modelos/40011-1.mpd');
const SCRIPT = join(DIR_ESTUDIO, 'scripts/servidor-render.mjs');

const puertoLibre = () =>
	new Promise<number>((resolver) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => {
			const {port} = s.address() as {port: number};
			s.close(() => resolver(port));
		});
	});

const medida = (ruta: string) => {
	const p = PNG.sync.read(readFileSync(ruta));
	return [p.width, p.height];
};

test('el servidor de render atiende pedidos seguidos sin volver a arrancar', {timeout: 10 * 60 * 1000}, async (t) => {
	const puerto = await puertoLibre();
	const base = `http://127.0.0.1:${puerto}`;
	// Bundle propio: la prueba nunca toca el de un servidor real que pueda estar corriendo.
	const dirBundle = join(mkdtempSync(join(tmpdir(), 'taller bundle ')), 'bundle');
	const env = {...process.env, TALLER_RENDER_PUERTO: String(puerto), TALLER_BUNDLE_DIR: dirBundle};
	const servidor = spawn(process.execPath, [SCRIPT], {env, stdio: ['ignore', 'pipe', 'pipe']});
	let salida = '';
	servidor.stdout.on('data', (d) => (salida += d));
	servidor.stderr.on('data', (d) => (salida += d));
	const anterior = process.env.TALLER_RENDER_PUERTO;
	process.env.TALLER_RENDER_PUERTO = String(puerto);
	const post = (ruta: string, cuerpo: string, cabeceras: Record<string, string>) => fetch(`${base}${ruta}`, {method: 'POST', body: cuerpo, headers: cabeceras});
	try {
		const limite = Date.now() + 5 * 60 * 1000;
		while (!/\blisto\b/.test(salida)) {
			assert.ok(servidor.exitCode === null, `el servidor terminó:\n${salida}`);
			assert.ok(Date.now() < limite, `el servidor no quedó listo:\n${salida}`);
			await new Promise((r) => setTimeout(r, 500));
		}
		assert.ok((await fetch(`${base}/salud`)).ok);

		// Instancia única: un segundo servidor en el mismo puerto sale antes de tocar el bundle o abrir Chromium.
		const segundo = spawnSync(process.execPath, [SCRIPT], {env, encoding: 'utf8', timeout: 30_000});
		assert.equal(segundo.status, 1);
		assert.match(segundo.stderr, /ya está en uso/);
		assert.doesNotMatch(segundo.stdout, /bundle/);

		// Pedidos que no vienen del cliente del taller.
		const trabajos = JSON.stringify([{composicion: 'taller-vistas', props: {}, salida: join(tmpdir(), 'x'), fotogramas: [0]}]);
		assert.equal((await post('/render', trabajos, {'content-type': 'application/json'})).status, 403);
		assert.equal((await post('/render', trabajos, {'content-type': 'application/json', 'x-taller': '1', origin: 'http://ejemplo.com'})).status, 403);
		assert.equal((await post('/apagar', '', {'x-taller': '1', origin: 'http://ejemplo.com'})).status, 403);
		assert.equal((await post('/render', trabajos, {'content-type': 'text/plain', 'x-taller': '1'})).status, 415);
		const fuera = JSON.stringify([{composicion: 'taller-vistas', props: {}, salida: join(RAIZ, 'taller/no-borrar'), fotogramas: [0]}]);
		const r = await post('/render', fuera, {'content-type': 'application/json', 'x-taller': '1'});
		assert.equal(r.status, 400);
		assert.match((await r.json()).error, /salida fuera/);

		// Sin las copias previas en el bundle: el servidor debe copiar el modelo recién empaquetado.
		rmSync(join(dirBundle, 'public/taller'), {recursive: true, force: true});

		const dir = mkdtempSync(join(tmpdir(), 'taller servidor '));
		const color = join(dir, 'color.png');
		const silueta = join(dir, 'silueta.png');

		let inicio = Date.now();
		renderizar([{modelo: SET, vistas: ['34', 'frente'], lado: 128, modo: 'color', salida: color}]);
		const primera = Date.now() - inicio;
		inicio = Date.now();
		renderizar([{modelo: SET, vistas: ['frente'], lado: 64, modo: 'silueta', salida: silueta}]);
		const segunda = Date.now() - inicio;
		t.diagnostic(`primera ${(primera / 1000).toFixed(1)} s, segunda ${(segunda / 1000).toFixed(1)} s`);

		assert.ok(existsSync(color) && existsSync(silueta));
		assert.deepEqual(medida(color), [256, 128]);
		assert.deepEqual(medida(silueta), [64, 64]);
		// Sin servidor cada llamada paga bundle + Chromium (~25-35 s); el margen es para máquinas cargadas.
		assert.ok(segunda < 20_000, `la segunda llamada tardó ${segunda} ms`);
		// renderizar bloquea el bucle de eventos: se deja leer la salida del servidor antes de mirarla.
		await new Promise((r) => setTimeout(r, 300));
		t.diagnostic(salida.split('\n').filter((l) => /^\d\d:/.test(l)).join('\n'));
		assert.match(salida, /taller-vistas/);
	} finally {
		if (anterior === undefined) delete process.env.TALLER_RENDER_PUERTO;
		else process.env.TALLER_RENDER_PUERTO = anterior;
		try {
			await post('/apagar', '', {'x-taller': '1'});
		} catch {}
		// Cerrar Chromium tarda unos segundos; matar antes lo dejaría huérfano.
		if (servidor.exitCode === null) await Promise.race([new Promise((r) => servidor.once('exit', r)), new Promise((r) => setTimeout(r, 20_000))]);
		servidor.kill();
		rmSync(join(dirBundle, '..'), {recursive: true, force: true});
	}
});
