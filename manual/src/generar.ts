// Genera el manual completo de un modelo: plan → modelos empaquetados → imágenes → HTML → PDF.
//
// Uso: node --no-warnings src/generar.ts <modelo.mpd> [--uso-interno]
// Salida: estudio/salida/manual/<modelo>/manual.pdf (y manual.html, imágenes, plan.json)

import {spawnSync} from 'node:child_process';
import {copyFileSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {imprimirPdf, maquetar} from './maquetar.ts';
import {planificar} from './planificar.ts';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const estudio = join(raiz, 'estudio');

function correr(comando: string, args: string[], cwd: string) {
	const r = spawnSync(comando, args, {cwd, shell: true, encoding: 'utf8'});
	if (r.status !== 0) throw new Error(`Falló: ${comando} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
}

export async function generar(ruta: string, usoInterno: boolean) {
	const nombre = basename(ruta).replace(/\.\w+$/, '');
	const trabajo = join(raiz, '.cache/manual', nombre); // plan y .ldr planos
	const publico = join(estudio, 'public/manual', nombre); // modelos empaquetados para el estudio
	// La salida no puede tener puntos en la ruta: Remotion los toma como extensión de archivo.
	const salida = join(estudio, 'salida/manual', nombre);
	for (const d of [publico, salida]) {
		rmSync(d, {recursive: true, force: true});
		mkdirSync(d, {recursive: true});
	}
	const t0 = Date.now();
	const plan = await planificar(ruta, trabajo);
	console.log(`${plan.titulo}: ${plan.piezasTotales} piezas, ${plan.pasosTotales} pasos, ${plan.secciones.length} secciones`);

	// Todas las secuencias se renderizan con un solo bundle y un solo navegador.
	const trabajos: {composicion: string; props: object; salida: string; fotogramas?: number[]}[] = [];
	const empaquetados = new Set<string>();
	const encolar = (composicion: string, ldr: string, destino: string, extra: object = {}, fotogramas?: number[]) => {
		const empaquetado = join(publico, ldr.replace(/\.ldr$/, '.packed.mpd'));
		if (!empaquetados.has(empaquetado)) correr('node', ['scripts/empaquetar.mjs', join(trabajo, ldr), empaquetado], estudio);
		empaquetados.add(empaquetado);
		trabajos.push({composicion, props: {modelo: `manual/${nombre}/${basename(empaquetado)}`, ...extra}, salida: join(salida, destino), fotogramas});
	};
	for (const s of plan.secciones) {
		const nn = String(s.numero).padStart(2, '0');
		const props = {rotaciones: s.pasos.map((p) => p.rotacion), flechas: s.pasos.map((p) => p.flechas)};
		encolar('manual-pasos', s.archivoPlano, `s${nn}`, props);
		const conDetalle = s.pasos.filter((p) => p.detalle).map((p) => p.numero - 1);
		if (conDetalle.length > 0) encolar('manual-detalles', s.archivoPlano, `d${nn}`, {...props, detalle: true}, conDetalle);
	}
	encolar('manual-piezas', plan.archivoPiezas, 'piezas');
	const rutaTrabajos = join(trabajo, 'trabajos.json');
	writeFileSync(rutaTrabajos, JSON.stringify(trabajos, null, 2));
	correr('node', ['scripts/render-secuencias.mjs', rutaTrabajos], estudio);
	console.log(`  ${trabajos.length} secuencias renderizadas (${((Date.now() - t0) / 1000).toFixed(0)} s)`);

	copyFileSync(join(trabajo, 'plan.json'), join(salida, 'plan.json'));
	const html = maquetar(salida, {usoInterno});
	const pdf = join(salida, 'manual.pdf');
	imprimirPdf(html, pdf);
	console.log(`→ ${pdf} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
	return pdf;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const modelo = args.find((a) => !a.startsWith('--'));
	if (!modelo) {
		console.error('Uso: node --no-warnings src/generar.ts <modelo.mpd> [--uso-interno]');
		process.exit(2);
	}
	await generar(modelo, args.includes('--uso-interno'));
}
