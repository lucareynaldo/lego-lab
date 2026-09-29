// Banco de pruebas: corre el trabajador sobre muchos modelos en paralelo, con tiempo límite, y resume.
//
// Uso: node --no-warnings src/lote.ts <carpeta con .mpd> [--grupo calibracion|test|todos] [--lista sets.txt]
//        [--max N] [--paralelo 3] [--timeout 180] [--memoria 1024] [--ahorro] [--con-manual] [--salida ../.cache/lote/<nombre>]
//        [--reanudar]  (saltea los modelos que ya están en <salida>/resultados.jsonl)
//
// Partición: cada set cae en "test" o "calibracion" según un hash de su número (≈20 % test). Es fija:
// el mismo set siempre queda del mismo lado. Los de test no se miran para ajustar el código.

import type {ChildProcess} from 'node:child_process';
import {fork} from 'node:child_process';
import {appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opcion = (n: string, d?: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const carpeta = args[0];
const grupo = opcion('grupo', 'todos')!;
const maximo = Number(opcion('max', 'Infinity'));
const paralelo = Number(opcion('paralelo', '3'));
const timeout = Number(opcion('timeout', '180')) * 1000;
const conManual = args.includes('--con-manual');
const ahorro = args.includes('--ahorro');
// Límite de heap por proceso (MB). Medido (28-09): con la generación joven de 4 MB, el par de modelos más
// grandes (Titanic y 42131) deja el proceso en ~350 MB de pico, así que 3 procesos entran holgados.
const memoria = Number(opcion('memoria', '1024'));
const salida = resolve(opcion('salida', join(aqui, '../../.cache/lote', `${grupo}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}`))!);

// FNV-1a de 32 bits: estable entre corridas y máquinas.
export function particion(set: string): 'test' | 'calibracion' {
	let h = 0x811c9dc5;
	for (const c of set) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
	return h % 5 === 0 ? 'test' : 'calibracion';
}

let modelos = readdirSync(carpeta)
	.filter((f) => f.endsWith('.mpd') || f.endsWith('.ldr'))
	.map((f) => join(carpeta, f));
const lista = opcion('lista');
if (lista) {
	const sets = new Set(readFileSync(lista, 'utf8').split(/\r?\n/).map((l) => l.split(',')[0].trim()).filter(Boolean));
	modelos = modelos.filter((m) => sets.has(basename(m).replace(/\.\w+$/, '')));
}
if (grupo !== 'todos') modelos = modelos.filter((m) => particion(basename(m).replace(/\.\w+$/, '')) === grupo);
modelos = modelos.slice(0, maximo);
mkdirSync(salida, {recursive: true});
console.log(`${modelos.length} modelos (${grupo}), ${paralelo} en paralelo, límite ${timeout / 1000} s → ${salida}`);

type Resultado = Record<string, unknown> & {modelo: string; estado: string};

// Trabajador persistente: procesa muchos modelos y conserva entre ellos los cachés de la biblioteca.
// Se recicla si su memoria pasa el límite o si un modelo excede el tiempo (se lo mata y se levanta otro).
const RECICLAR_MB = memoria * 0.7;

class Trabajador {
	private hijo: ChildProcess | null = null;
	private arrancar() {
		this.hijo = fork(join(aqui, 'trabajador.ts'), [], {
			// La generación joven chica (4 MB) baja la memoria reservada del proceso de ~500 a ~350 MB sin costo
			// de tiempo; --optimize-for-size la baja a ~250 MB pero es ~15 % más lento (opción --ahorro).
			execArgv: ['--no-warnings', `--max-old-space-size=${memoria}`, '--max-semi-space-size=4', ...(ahorro ? ['--optimize-for-size', '--max-semi-space-size=2'] : [])],
			stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
		});
	}
	procesar(ruta: string): Promise<Resultado> {
		if (!this.hijo) this.arrancar();
		const hijo = this.hijo!;
		const modelo = basename(ruta).replace(/\.\w+$/, '');
		return new Promise((listo) => {
			let err = '';
			const alErr = (d: Buffer) => (err = (err + d).slice(-600));
			hijo.stderr?.on('data', alErr);
			const terminar = (r: Resultado, matar: boolean) => {
				clearTimeout(corte);
				hijo.off('message', alMensaje);
				hijo.off('exit', alSalir);
				hijo.stderr?.off('data', alErr);
				if (matar) {
					hijo.kill();
					this.hijo = null;
				}
				listo(r);
			};
			const alMensaje = (m: {resultado: Resultado; memoriaMB: number}) => terminar(m.resultado, m.memoriaMB > RECICLAR_MB);
			const alSalir = () => {
				this.hijo = null;
				terminar({modelo, estado: 'caida', error: err}, false);
			};
			const corte = setTimeout(() => terminar({modelo, estado: 'timeout'}, true), timeout);
			hijo.on('message', alMensaje);
			hijo.once('exit', alSalir);
			hijo.send({ruta, conManual});
		});
	}
	cerrar() {
		this.hijo?.kill();
	}
}

const archivoPrevio = join(salida, 'resultados.jsonl');
const resultados: Resultado[] =
	args.includes('--reanudar') && existsSync(archivoPrevio)
		? readFileSync(archivoPrevio, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
		: [];
const yaHechos = new Set(resultados.map((r) => r.modelo));
modelos = modelos.filter((m) => !yaHechos.has(basename(m).replace(/\.\w+$/, '')));
if (resultados.length > 0) console.log(`Reanudando: ${resultados.length} ya procesados, faltan ${modelos.length}`);
const archivoLineas = join(salida, 'resultados.jsonl');
let siguiente = 0;
const inicio = Date.now();
if (resultados.length === 0) writeFileSync(archivoLineas, '');
// Los modelos más grandes primero: con varios trabajadores, el reparto queda más parejo al final.
modelos.sort((a, b) => statSync(b).size - statSync(a).size);
async function obrero() {
	const t = new Trabajador();
	while (siguiente < modelos.length) {
		const ruta = modelos[siguiente++];
		const r = await t.procesar(ruta);
		resultados.push(r);
		appendFileSync(archivoLineas, JSON.stringify(r) + '\n');
		const hechos = resultados.length;
		if (hechos % 10 === 0 || r.estado !== 'ok')
			console.log(`[${hechos}/${modelos.length}] ${r.modelo}: ${r.estado}${r.estado === 'ok' ? ` (${r.errores} errores, ${r.segTotal} s)` : ''}`);
	}
	t.cerrar();
}
await Promise.all(Array.from({length: paralelo}, obrero));

// Resumen
const ok = resultados.filter((r) => r.estado === 'ok');
const reglas = new Map<string, {modelos: number; casos: number}>();
for (const r of ok)
	for (const [regla, n] of Object.entries(r.porRegla as Record<string, number>)) {
		const x = reglas.get(regla) ?? {modelos: 0, casos: 0};
		x.modelos++;
		x.casos += n;
		reglas.set(regla, x);
	}
const pct = (n: number) => `${((100 * n) / Math.max(1, resultados.length)).toFixed(1)} %`;
const tiempos = ok.map((r) => r.segTotal as number).sort((a, b) => a - b);
const lineas = [
	`# Banco de pruebas: ${grupo}`,
	'',
	`- Fecha: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${Math.round((Date.now() - inicio) / 1000)} s en total`,
	`- Modelos: ${resultados.length} · ok ${ok.length} (${pct(ok.length)}) · excepción ${resultados.filter((r) => r.estado === 'excepcion').length} · caída ${resultados.filter((r) => r.estado === 'caida').length} · timeout ${resultados.filter((r) => r.estado === 'timeout').length}`,
	`- Sin errores: ${ok.filter((r) => r.errores === 0).length} (${pct(ok.filter((r) => r.errores === 0).length)})`,
	`- Tiempo por modelo: mediana ${tiempos[Math.floor(tiempos.length / 2)] ?? '-'} s · p90 ${tiempos[Math.floor(tiempos.length * 0.9)] ?? '-'} s · máx ${tiempos.at(-1) ?? '-'} s`,
	'',
	'## Reglas que dispararon',
	'',
	'| Regla | Modelos | % de modelos | Casos |',
	'|---|---|---|---|',
	...[...reglas]
		.sort(([a, x], [b, y]) => (a[0] === b[0] ? y.modelos - x.modelos : a[0] === '✗' ? -1 : 1))
		.map(([regla, x]) => `| ${regla} | ${x.modelos} | ${pct(x.modelos)} | ${x.casos} |`),
	'',
	'## Fallas del programa (excepción, caída o timeout)',
	'',
	...resultados.filter((r) => r.estado !== 'ok').map((r) => `- **${r.modelo}** (${r.estado}): ${String(r.error ?? '').split('\n')[0].slice(0, 200)}`),
];
writeFileSync(join(salida, 'resumen.md'), lineas.join('\n') + '\n');
console.log('\n' + lineas.join('\n'));
if (existsSync(archivoLineas)) console.log(`\nDetalle por modelo: ${archivoLineas}`);
