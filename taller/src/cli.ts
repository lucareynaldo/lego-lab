// Uso: node --no-warnings taller/src/cli.ts <comando> …
//   piezas buscar <texto…> [--categoria <c>] [--max <n>] [--todas]
//   piezas ver <id>
//   piezas reindexar
//   construir <diseno.ts> [--salida <modelo.mpd>]
//   validar <modelo.mpd> [--sub <nombre>]
//   render <modelo.mpd> --salida <carpeta> [--vistas 34,frente,lado,arriba] [--lado <px>] [--modo color|silueta] [--paso <n>] [--sub <nombre>]
//   metricas <modelo.mpd>
// Salida en JSON por stdout. Código de salida: 0 bien, 1 el modelo tiene errores, 2 uso incorrecto.

import {spawnSync} from 'node:child_process';
import {join, resolve} from 'node:path';
import {buscar, catalogo, construirCatalogo} from './catalogo.ts';
import {colorDe} from './colores.ts';
import {biblioteca} from './entorno.ts';
import {ficha} from './ficha.ts';
import {metricas} from './metricas.ts';
import {renderizar} from './render.ts';
import {validarModelo} from './validar.ts';

const USO = `Uso: node --no-warnings taller/src/cli.ts <comando> …
  piezas buscar <texto…> [--categoria <c>] [--max <n>] [--todas]
  piezas ver <id>
  piezas reindexar
  construir <diseno.ts> [--salida <modelo.mpd>]
  validar <modelo.mpd> [--sub <nombre>]
  render <modelo.mpd> --salida <carpeta> [--vistas 34,frente,lado,arriba] [--lado <px>] [--modo color|silueta] [--paso <n>] [--sub <nombre>]
  metricas <modelo.mpd>`;

const CON_VALOR = new Set(['--categoria', '--max', '--salida', '--sub', '--vistas', '--lado', '--modo', '--paso']);
const args = process.argv.slice(2);
const opcion = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const posicionales = args.filter((a, i) => !a.startsWith('--') && !CON_VALOR.has(args[i - 1] ?? ''));
const salir = (codigo: number, mensaje?: string): never => {
	if (mensaje) console.error(mensaje);
	process.exit(codigo);
};
const imprimir = (x: unknown) => console.log(JSON.stringify(x, null, 2));

const [comando, ...resto] = posicionales;
try {
	switch (comando) {
		case 'piezas': {
			const [sub, ...texto] = resto;
			if (sub === 'buscar') {
				imprimir(buscar(await catalogo(), texto.join(' '), {categoria: opcion('--categoria'), max: opcion('--max') ? Number(opcion('--max')) : undefined, todas: args.includes('--todas')}));
			} else if (sub === 'ver' && texto[0]) {
				const bib = biblioteca();
				const f = ficha(bib, texto[0]);
				const entrada = (await catalogo()).find((e) => e.id === f.id);
				const grilla = (g: typeof f.studs) => ({
					cantidad: g.puntos.length,
					columnas: g.columnas,
					filas: g.filas,
					// Solo se listan si la grilla tiene huecos.
					...(g.puntos.length < g.columnas * g.filas ? {puntos: g.puntos.map((p) => [p.i, p.j])} : {}),
				});
				imprimir({
					id: f.id,
					titulo: f.titulo,
					tamano: f.tamano,
					studs: grilla(f.studs),
					antistuds: grilla(f.antistuds),
					otros: f.otros,
					colores: (entrada?.colores ?? []).map((c) => ({codigo: c, nombre: colorDe(bib, c).nombre})),
					frecuencia: entrada?.frecuencia ?? 0,
				});
			} else if (sub === 'reindexar') {
				imprimir({piezas: (await construirCatalogo()).length});
			} else salir(2, USO);
			break;
		}
		case 'construir': {
			if (!resto[0]) salir(2, USO);
			const salida = resolve(opcion('--salida') ?? 'modelo.mpd');
			const r = spawnSync(process.execPath, ['--no-warnings', resolve(resto[0])], {stdio: 'inherit', env: {...process.env, TALLER_SALIDA: salida}});
			// exitCode y no exit: con stdout en un pipe, exit truncaría un JSON grande.
			if (r.status !== 0) process.exitCode = 1;
			else imprimir({modelo: salida});
			break;
		}
		case 'validar': {
			if (!resto[0]) salir(2, USO);
			const r = await validarModelo(resolve(resto[0]), opcion('--sub'));
			imprimir(r);
			if (!r.ok) process.exitCode = 1;
			break;
		}
		case 'render': {
			const salidaDir = opcion('--salida');
			if (!resto[0] || !salidaDir) salir(2, USO);
			const vistas = (opcion('--vistas') ?? '34,frente,lado,arriba').split(',').map((v) => v.trim()).filter(Boolean);
			const lado = Number(opcion('--lado') ?? 512);
			const modo = opcion('--modo') === 'silueta' ? 'silueta' : 'color';
			const paso = opcion('--paso') ? Number(opcion('--paso')) : undefined;
			const sub = opcion('--sub');
			const nombre = ['vistas', vistas.join('-'), lado, modo, ...(paso ? [`paso${paso}`] : []), ...(sub ? [sub] : [])].join('_') + '.png';
			const png = join(resolve(salidaDir!), nombre);
			renderizar([{modelo: resolve(resto[0]), sub, vistas, lado, modo, paso, salida: png}]);
			imprimir({imagen: png});
			break;
		}
		case 'metricas': {
			if (!resto[0]) salir(2, USO);
			imprimir(await metricas(resolve(resto[0])));
			break;
		}
		default:
			salir(2, USO);
	}
} catch (e) {
	console.error(`error: ${(e as Error).message}`);
	process.exitCode = 1;
}
