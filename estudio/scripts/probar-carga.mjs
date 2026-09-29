// Carga un modelo empaquetado con LDrawLoader en Node (sin navegador) y reporta piezas y pasos.
// Sirve para detectar rápido archivos faltantes o nombres mal empaquetados.
//
// Uso: node scripts/probar-carga.mjs public/modelos/<set>.packed.mpd

import {readFileSync} from 'node:fs';
import {LDrawLoader} from 'three/examples/jsm/loaders/LDrawLoader.js';
import {LDrawConditionalLineMaterial} from 'three/examples/jsm/materials/LDrawConditionalLineMaterial.js';

const loader = new LDrawLoader();
loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
// En un paquete completo nunca debería hacer falta ir a buscar un archivo afuera.
loader.partsCache.parseCache.fetchData = async (nombre) => {
	throw new Error(`falta en el paquete: ${nombre}`);
};

const inicio = Date.now();
loader.parse(
	readFileSync(process.argv[2], 'latin1'),
	(modelo) => {
		let piezas = 0;
		modelo.traverse((o) => {
			if (o.userData.type === 'Part' || o.userData.type === 'Unofficial_Part') piezas++;
		});
		const s = ((Date.now() - inicio) / 1000).toFixed(1);
		console.log(`ok · piezas: ${piezas} · pasos: ${modelo.userData.numBuildingSteps} · ${s} s`);
	},
	(error) => {
		console.error(`ERROR: ${error.message}`);
		process.exitCode = 1;
	},
);
