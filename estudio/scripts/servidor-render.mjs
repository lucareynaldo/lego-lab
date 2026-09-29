// Servidor de render persistente: un bundle y un navegador para muchos pedidos.
// Cada `render-secuencias.mjs` paga ~30 s de webpack + Chromium; con varios agentes renderizando a la vez
// eso además multiplica la memoria. Acá se paga una vez y los pedidos se atienden de a uno (cola única).
//
// Uso: node scripts/servidor-render.mjs   (solo 127.0.0.1)
//   TALLER_RENDER_PUERTO  puerto (7654 por defecto)
//   TALLER_BUNDLE_DIR     carpeta del bundle en caché (<repo>/.cache/taller/bundle por defecto)
// Rutas (los POST exigen `X-Taller: 1`, sin Origin, y /render además content-type application/json):
//   POST /render  cuerpo = el mismo arreglo de trabajos que render-secuencias.mjs → {ok:true} | {ok:false,error}
//   GET  /salud   → {ok:true}
//   POST /apagar  cierra el navegador y termina

import {bundle} from '@remotion/bundler';
import {openBrowser, renderFrames, selectComposition} from '@remotion/renderer';
import {copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(aqui, '../..');
const DIR_SRC = resolve(aqui, '../src');
const DIR_PUBLIC = resolve(aqui, '../public');
const DIR_BUNDLE = resolve(process.env.TALLER_BUNDLE_DIR ?? join(RAIZ, '.cache/taller/bundle'));
const puerto = Number(process.env.TALLER_RENDER_PUERTO ?? 7654);
// En Windows, ANGLE usa la GPU; en Linux sin GPU (p. ej., contenedores en la nube) hace falta SwiftShader.
const chromiumOptions = {gl: process.env.TALLER_GL ?? (process.platform === 'win32' ? 'angle' : 'swangle')};
const timeoutInMilliseconds = 10 * 60 * 1000;
// Solo se escribe (y se borra) `salida` dentro de estas carpetas.
const SALIDAS_PERMITIDAS = [resolve(tmpdir()), join(RAIZ, '.cache')];

// Remotion toma la raíz del proyecto del directorio actual, y el script npm corre desde taller/.
process.chdir(resolve(aqui, '..'));

const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);

const dentroDe = (ruta, dir) => {
	const r = relative(dir, ruta);
	return r !== '' && !r.startsWith('..') && !isAbsolute(r);
};

function masReciente(dir) {
	let max = 0;
	for (const e of readdirSync(dir, {withFileTypes: true})) {
		const ruta = join(dir, e.name);
		max = Math.max(max, e.isDirectory() ? masReciente(ruta) : statSync(ruta).mtimeMs);
	}
	return max;
}

async function prepararBundle() {
	const marca = join(DIR_BUNDLE, '.completo');
	if (existsSync(marca) && statSync(marca).mtimeMs > masReciente(DIR_SRC)) {
		log(`bundle en caché: ${DIR_BUNDLE}`);
		return DIR_BUNDLE;
	}
	const inicio = Date.now();
	// Se construye aparte y se cambia de nombre al final: nunca queda un bundle a medias en DIR_BUNDLE.
	const nuevo = `${DIR_BUNDLE}.nuevo-${process.pid}`;
	rmSync(nuevo, {recursive: true, force: true});
	mkdirSync(dirname(DIR_BUNDLE), {recursive: true});
	await bundle({entryPoint: join(DIR_SRC, 'index.ts'), publicDir: DIR_PUBLIC, outDir: nuevo});
	writeFileSync(join(nuevo, '.completo'), '');
	let final = DIR_BUNDLE;
	try {
		const viejo = `${DIR_BUNDLE}.viejo-${process.pid}`;
		if (existsSync(DIR_BUNDLE)) renameSync(DIR_BUNDLE, viejo);
		renameSync(nuevo, DIR_BUNDLE);
		rmSync(viejo, {recursive: true, force: true});
	} catch (e) {
		// Windows no deja renombrar una carpeta en uso: se sirve la nueva desde donde quedó.
		log(`no se pudo reemplazar ${DIR_BUNDLE} (${e.message}); se usa ${nuevo}`);
		final = nuevo;
	}
	log(`bundle nuevo en ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
	return final;
}

// El bundle copió estudio/public al crearse; los modelos empaquetados después no están ahí.
// Se copia cada archivo de public que nombre una prop (props.modelo y similares) si falta o cambió.
function sincronizarPublicos(props) {
	for (const valor of Object.values(props ?? {})) {
		if (typeof valor !== 'string' || valor.length === 0) continue;
		const origen = resolve(DIR_PUBLIC, valor);
		if (!dentroDe(origen, DIR_PUBLIC) || !existsSync(origen) || !statSync(origen).isFile()) continue;
		const destino = join(serveUrl, 'public', relative(DIR_PUBLIC, origen));
		const o = statSync(origen);
		if (existsSync(destino)) {
			const d = statSync(destino);
			if (d.size === o.size && d.mtimeMs >= o.mtimeMs) continue;
		}
		mkdirSync(dirname(destino), {recursive: true});
		copyFileSync(origen, destino);
	}
}

let serveUrl;
let navegador;

async function reabrirNavegador() {
	try {
		await navegador.close({silent: true});
	} catch {}
	navegador = await openBrowser('chrome', {chromiumOptions});
	log('navegador reabierto');
}

function validar(trabajos) {
	if (!Array.isArray(trabajos)) throw new Error('se esperaba un arreglo de trabajos');
	for (const t of trabajos) {
		if (typeof t?.composicion !== 'string' || typeof t?.salida !== 'string') throw new Error('cada trabajo necesita composicion y salida');
		const salida = resolve(t.salida);
		if (!SALIDAS_PERMITIDAS.some((d) => dentroDe(salida, d))) throw new Error(`salida fuera de ${SALIDAS_PERMITIDAS.join(' o ')}: ${t.salida}`);
		t.salida = salida;
	}
	return trabajos;
}

async function renderizarTrabajo(t) {
	sincronizarPublicos(t.props);
	const composition = await selectComposition({serveUrl, id: t.composicion, inputProps: t.props, puppeteerInstance: navegador, chromiumOptions, timeoutInMilliseconds});
	rmSync(t.salida, {recursive: true, force: true});
	mkdirSync(t.salida, {recursive: true});
	for (const frameRange of t.fotogramas ?? [null]) {
		await renderFrames({
			frameRange,
			composition,
			serveUrl,
			inputProps: t.props,
			outputDir: t.salida,
			imageFormat: 'png',
			puppeteerInstance: navegador,
			chromiumOptions,
			concurrency: 2,
			timeoutInMilliseconds,
			onStart: () => {},
			onFrameUpdate: () => {},
		});
	}
	// Remotion rellena con ceros cuando hay 10 o más fotogramas (element-07.png).
	for (const f of readdirSync(t.salida)) {
		const m = f.match(/^element-0+(\d+)\.png$/);
		if (m) renameSync(join(t.salida, f), join(t.salida, `element-${m[1]}.png`));
	}
	return t.fotogramas?.length ?? composition.durationInFrames;
}

let pedidos = 0;
async function atender(trabajos) {
	const n = ++pedidos;
	for (const [i, t] of trabajos.entries()) {
		const inicio = Date.now();
		let imagenes;
		try {
			imagenes = await renderizarTrabajo(t);
		} catch (e) {
			// Si Chromium se cayó, cualquier error siguiente vuelve a fallar: se reabre y se reintenta una vez.
			log(`#${n} [${i + 1}/${trabajos.length}] error, reintento con navegador nuevo: ${e?.message ?? e}`);
			await reabrirNavegador();
			imagenes = await renderizarTrabajo(t);
		}
		log(`#${n} [${i + 1}/${trabajos.length}] ${t.composicion} → ${t.salida}: ${imagenes} imágenes, ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
	}
}

// Cola única: cada pedido espera al anterior, gane o falle. Arranca cuando el bundle y el navegador estén listos,
// así /salud responde enseguida y los pedidos que llegan durante el arranque esperan en vez de caer al render directo.
let avisarListo;
let cola = new Promise((r) => (avisarListo = r));
const encolar = (trabajos) => {
	const p = cola.then(() => atender(trabajos));
	cola = p.catch(() => {});
	return p;
};

function responder(res, codigo, cuerpo) {
	if (res.writableEnded || res.destroyed) return;
	res.writeHead(codigo, {'content-type': 'application/json'});
	res.end(JSON.stringify(cuerpo));
}

// Cualquier página web puede hacer POST a localhost: se exige una cabecera que un formulario no puede poner,
// y se rechaza todo pedido de navegador (traen Origin).
const autorizado = (req) => req.headers['x-taller'] === '1' && req.headers.origin === undefined;

async function leerCuerpo(req) {
	const trozos = [];
	for await (const t of req) trozos.push(t);
	return Buffer.concat(trozos).toString('utf8');
}

const servidor = createServer(async (req, res) => {
	req.on('error', () => {});
	res.on('error', () => {});
	if (req.method === 'GET' && req.url === '/salud') return responder(res, 200, {ok: true});
	if (req.method !== 'POST' || (req.url !== '/render' && req.url !== '/apagar')) return responder(res, 404, {ok: false, error: 'ruta desconocida'});
	if (!autorizado(req)) return responder(res, 403, {ok: false, error: 'falta X-Taller: 1 o el pedido trae Origin'});
	// En Windows matar el proceso no corre los manejadores de señales y Chromium quedaría huérfano.
	if (req.url === '/apagar') {
		responder(res, 200, {ok: true});
		return cerrar(0);
	}
	if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return responder(res, 415, {ok: false, error: 'se espera application/json'});
	let trabajos;
	try {
		trabajos = validar(JSON.parse(await leerCuerpo(req)));
	} catch (e) {
		return responder(res, 400, {ok: false, error: String(e?.message ?? e)});
	}
	try {
		await encolar(trabajos);
		responder(res, 200, {ok: true});
	} catch (e) {
		responder(res, 500, {ok: false, error: String(e?.stack ?? e)});
	}
});
// Un render largo no debe cortar la conexión del cliente.
servidor.requestTimeout = 0;
servidor.headersTimeout = 0;
servidor.timeout = 0;

let cerrando = false;
async function cerrar(codigo) {
	if (cerrando) return;
	cerrando = true;
	servidor.close();
	try {
		if (navegador) await Promise.race([navegador.close({silent: true}), new Promise((r) => setTimeout(r, 15_000))]);
	} catch {}
	process.exit(codigo);
}
process.on('SIGINT', () => cerrar(0));
process.on('SIGTERM', () => cerrar(0));

// Primero el puerto: es el candado de instancia única. Un segundo servidor termina acá, antes de tocar el bundle
// o abrir un navegador.
await new Promise((resolver) => {
	servidor.once('error', (e) => {
		if (e.code === 'EADDRINUSE') console.error(`el puerto ${puerto} ya está en uso (¿otro servidor de render?); no se arranca`);
		else console.error(`no se pudo escuchar en ${puerto}: ${e.message}`);
		process.exit(1);
	});
	servidor.listen(puerto, '127.0.0.1', resolver);
});
log(`servidor de render en http://127.0.0.1:${puerto} (preparando)`);

try {
	serveUrl = await prepararBundle();
	navegador = await openBrowser('chrome', {chromiumOptions});
} catch (e) {
	console.error(`no se pudo preparar el render: ${e?.stack ?? e}`);
	await cerrar(1);
}
avisarListo();
log('listo');
