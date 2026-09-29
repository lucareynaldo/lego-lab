// Renderiza varias secuencias de imágenes con un solo bundle y un solo navegador.
// Invocar `remotion render` una vez por sección cuesta ~7 s de arranque cada vez; esto lo paga una vez.
//
// Uso: node scripts/render-secuencias.mjs <trabajos.json>
//   trabajos.json: [{ "composicion": "manual-pasos", "props": {...}, "salida": "carpeta", "fotogramas"?: [3, 7] }, ...]
//   (sin "fotogramas" se renderizan todos)
// Las imágenes quedan como <salida>/element-<n>.png (sin ceros a la izquierda).

import {bundle} from '@remotion/bundler';
import {openBrowser, renderFrames, selectComposition} from '@remotion/renderer';
import {mkdirSync, readFileSync, readdirSync, renameSync, rmSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const trabajos = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const chromiumOptions = {gl: 'angle'};
const timeoutInMilliseconds = 10 * 60 * 1000;

const serveUrl = await bundle({entryPoint: resolve(aqui, '../src/index.ts'), publicDir: resolve(aqui, '../public')});
const navegador = await openBrowser('chrome', {chromiumOptions});
try {
	for (const [i, t] of trabajos.entries()) {
		const inicio = Date.now();
		const composition = await selectComposition({serveUrl, id: t.composicion, inputProps: t.props, puppeteerInstance: navegador, chromiumOptions, timeoutInMilliseconds});
		rmSync(t.salida, {recursive: true, force: true});
		mkdirSync(t.salida, {recursive: true});
		// Un fotograma suelto por llamada si se pidieron algunos; si no, la secuencia entera.
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
		console.log(`[${i + 1}/${trabajos.length}] ${t.composicion} → ${t.salida}: ${t.fotogramas?.length ?? composition.durationInFrames} imágenes, ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
	}
} finally {
	await navegador.close({silent: true});
}
