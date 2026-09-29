// Procesa modelos para el banco de pruebas: características del modelo, tiempos, hallazgos por regla
// y, si algo se rompe, el error.
//
// Dos modos:
// - Proceso persistente (lo lanza lote.ts con fork): recibe { ruta, conManual } por mensaje y responde
//   con el resultado. Entre modelos conserva los cachés de geometría y conectores de la biblioteca,
//   que es lo más caro de calcular.
// - Suelto: node --no-warnings src/trabajador.ts <modelo.mpd> [--con-manual]  → JSON en stdout.

import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Biblioteca, esFlexible, esPieza, pasosDe} from './ldraw.ts';
import {liberarModelo} from './memoria.ts';
import {verificar} from './verificar.ts';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export async function procesar(ruta: string, conManual: boolean): Promise<Record<string, unknown>> {
	const resultado: Record<string, unknown> = {modelo: basename(ruta).replace(/\.\w+$/, '')};
	const t0 = performance.now();
	let bib: Biblioteca | null = null;
	try {
		bib = new Biblioteca(join(raiz, '.cache/ldraw'), join(raiz, '.cache/LDCadShadowLibrary-main'));
		const principal = bib.cargarModelo(ruta, basename(ruta));

		// Características que sirven para buscar modelos que rompan cosas.
		const archivos = new Set<string>();
		const pendientes = [principal];
		let rotsteps = 0;
		let rotacionesRaras = 0; // piezas con rotaciones que no son múltiplos de 90°
		let minifiguras = 0;
		let flexibles = 0;
		let embebidas = 0;
		while (pendientes.length > 0) {
			const n = pendientes.pop()!;
			if (archivos.has(n)) continue;
			archivos.add(n);
			const a = bib.archivo(n);
			if (!a || esPieza(a)) continue;
			if (esFlexible(a)) flexibles++;
			for (const p of pasosDe(a)) {
				if (p.rotacion) rotsteps++;
				for (const r of p.refs) {
					const hijo = bib.archivo(r.archivo);
					if (hijo?.embebido && esPieza(hijo)) embebidas++;
					if (/^(973|3626)/.test(r.archivo)) minifiguras++; // torsos y cabezas
					if (r.transform.r.some((x) => Math.abs(x) > 0.01 && Math.abs(Math.abs(x) - 1) > 0.01)) rotacionesRaras++;
					if (hijo && !esPieza(hijo)) pendientes.push(r.archivo);
				}
			}
		}
		Object.assign(resultado, {submodelos: archivos.size - 1, rotsteps, rotacionesRaras, minifiguras, flexibles, embebidas});

		const reporte = verificar(bib, principal);
		const porRegla: Record<string, number> = {};
		for (const h of reporte.hallazgos) {
			const k = `${h.severidad === 'error' ? '✗' : '·'}${h.regla}`;
			porRegla[k] = (porRegla[k] ?? 0) + 1;
		}
		Object.assign(resultado, {
			piezas: reporte.piezas,
			pasos: reporte.pasos,
			conexiones: reporte.conexiones,
			sinConectores: reporte.piezasSinConectores.length,
			errores: reporte.hallazgos.filter((h) => h.severidad === 'error').length,
			avisos: reporte.hallazgos.filter((h) => h.severidad === 'aviso').length,
			porRegla,
			segVerificar: +((performance.now() - t0) / 1000).toFixed(2),
		});

		if (conManual) {
			const {planificar} = await import('../../manual/src/planificar.ts');
			const temporal = mkdtempSync(join(tmpdir(), 'lego-lab-'));
			const t1 = performance.now();
			try {
				// Reutiliza la biblioteca y el reporte: no se verifica dos veces.
				const plan = await planificar(ruta, temporal, {bib, principal, reporte});
				Object.assign(resultado, {
					secciones: plan.secciones.length,
					flechas: plan.secciones.reduce((s, x) => s + x.pasos.reduce((t, p) => t + p.flechas.length, 0), 0),
					detalles: plan.secciones.reduce((s, x) => s + x.pasos.filter((p) => p.detalle).length, 0),
					pasosVacios: plan.secciones.reduce((s, x) => s + x.pasos.filter((p) => p.piezas.length === 0 && p.subarmados.length === 0).length, 0),
					segManual: +((performance.now() - t1) / 1000).toFixed(2),
				});
			} finally {
				rmSync(temporal, {recursive: true, force: true});
			}
		}
		resultado.estado = 'ok';
	} catch (e) {
		resultado.estado = 'excepcion';
		resultado.error = e instanceof Error ? `${e.message}\n${e.stack?.split('\n').slice(1, 4).join('\n')}` : String(e);
	}
	if (bib) liberarModelo(bib);
	resultado.segTotal = +((performance.now() - t0) / 1000).toFixed(2);
	return resultado;
}

if (process.send) {
	// Proceso persistente: un modelo por mensaje; informa la memoria para que lote.ts decida reciclarlo.
	process.on('message', async (m: {ruta: string; conManual: boolean}) => {
		const r = await procesar(m.ruta, m.conManual);
		process.send!({resultado: r, memoriaMB: Math.round(process.memoryUsage().heapUsed / 1e6)});
	});
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [ruta] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
	process.stdout.write(JSON.stringify(await procesar(ruta, process.argv.includes('--con-manual'))));
}
