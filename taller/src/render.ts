// Render de vistas con estudio/ (Remotion): empaqueta cada modelo en estudio/public/taller/ y ejecuta
// render-secuencias.mjs una sola vez para todos los pedidos (un bundle, un navegador), o se los pasa al
// servidor de render persistente si está levantado.

import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizarNombre} from '../../verificador/src/ldraw.ts';
import {DIR_CACHE, DIR_ESTUDIO} from './entorno.ts';
import {nombreSub} from './validar.ts';

export const VISTAS = ['34', '34atras', 'frente', 'lado', 'arriba'];

export type PedidoRender = {modelo: string; sub?: string; vistas: string[]; lado: number; modo: 'color' | 'silueta'; paso?: number; salida: string};

export function extraerSub(mpd: string, sub: string): string {
	const bloques = mpd
		.replace(/\r\n?/g, '\n')
		.split(/^(?=0 FILE )/m)
		.filter((b) => b.startsWith('0 FILE '))
		// El último bloque puede no terminar en salto de línea y, al reordenar, se pegaría al siguiente.
		.map((b) => (b.endsWith('\n') ? b : b + '\n'));
	const buscado = nombreSub(sub);
	const i = bloques.findIndex((b) => normalizarNombre(b.slice(7, b.indexOf('\n'))) === buscado);
	if (i < 0) throw new Error(`no existe el submodelo ${sub}`);
	return [bloques[i], ...bloques.filter((_, k) => k !== i)].join('');
}

function ejecutar(script: string, args: string[]) {
	const r = spawnSync(process.execPath, [join(DIR_ESTUDIO, 'scripts', script), ...args], {cwd: DIR_ESTUDIO, encoding: 'utf8'});
	if (r.status !== 0) throw new Error(`${script} falló:\n${r.stdout}\n${r.stderr}`);
}

// Con el servidor de render levantado (npm run servidor-render) no se paga bundle + navegador por llamada.
// El cliente es un proceso aparte para que renderizar siga siendo síncrona. Devuelve false solo si /salud no responde.
const CLIENTE = join(dirname(fileURLToPath(import.meta.url)), 'render-cliente.mjs');
function renderizarEnServidor(rutaTrabajos: string): boolean {
	const cliente = (arg: string) => spawnSync(process.execPath, [CLIENTE, arg], {encoding: 'utf8'});
	if (cliente('salud').status !== 0) return false;
	const r = cliente(rutaTrabajos);
	// Con el servidor arriba nunca se cae al render directo: sumaría otro bundle + Chromium a una máquina ya cargada.
	if (r.status !== 0) throw new Error(`servidor de render falló (código ${r.status}):\n${r.stderr}`);
	return true;
}

// Empaqueta (con caché por contenido) y devuelve la ruta relativa a estudio/public.
function empaquetar(modelo: string, sub?: string): string {
	let texto = readFileSync(modelo, 'latin1');
	if (sub) texto = extraerSub(texto, sub);
	const hash = createHash('sha1').update(texto).digest('hex').slice(0, 12);
	const relativa = `taller/${hash}.packed.mpd`;
	const destino = join(DIR_ESTUDIO, 'public', relativa);
	if (!existsSync(destino)) {
		mkdirSync(join(DIR_CACHE, 'render'), {recursive: true});
		const entrada = join(DIR_CACHE, 'render', `${hash}.mpd`);
		writeFileSync(entrada, texto, 'latin1');
		mkdirSync(dirname(destino), {recursive: true});
		ejecutar('empaquetar.mjs', [entrada, destino]);
	}
	return relativa;
}

export function renderizar(pedidos: PedidoRender[]): void {
	if (pedidos.length === 0) return;
	const lote = join(DIR_CACHE, 'render', `lote-${process.pid}-${Date.now()}`);
	mkdirSync(lote, {recursive: true});
	const trabajos = pedidos.map((p, k) => {
		for (const v of p.vistas) if (!VISTAS.includes(v)) throw new Error(`vista desconocida: ${v} (vistas: ${VISTAS.join(', ')})`);
		return {
			composicion: 'taller-vistas',
			props: {modelo: empaquetar(p.modelo, p.sub), vistas: p.vistas, lado: p.lado, modo: p.modo, ...(p.paso ? {paso: p.paso - 1} : {})},
			salida: join(lote, String(k)),
			fotogramas: [0],
		};
	});
	const rutaTrabajos = join(lote, 'trabajos.json');
	writeFileSync(rutaTrabajos, JSON.stringify(trabajos));
	if (!renderizarEnServidor(rutaTrabajos)) ejecutar('render-secuencias.mjs', [rutaTrabajos]);
	pedidos.forEach((p, k) => {
		mkdirSync(dirname(p.salida), {recursive: true});
		copyFileSync(join(lote, String(k), 'element-0.png'), p.salida);
	});
}
