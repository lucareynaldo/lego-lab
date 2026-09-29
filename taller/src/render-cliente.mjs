// Cliente del servidor de render (estudio/scripts/servidor-render.mjs), para llamarlo de forma síncrona
// con spawnSync desde render.ts.
//
// Uso: node render-cliente.mjs salud            → sale con 0 si el servidor responde (espera hasta 10 s:
//                                                 bajo carga un falso negativo dispararía un render directo pesado)
//      node render-cliente.mjs <trabajos.json>  → sale con 0 si el render terminó bien
// Códigos: 2 = el servidor informó un error de render, 3 = no se pudo hablar con el servidor.

import {readFileSync} from 'node:fs';
import {request} from 'node:http';

const puerto = Number(process.env.TALLER_RENDER_PUERTO ?? 7654);
const arg = process.argv[2];

// node:http y no fetch: fetch corta a los 300 s de espera y un pedido puede quedar en cola más que eso.
function pedir(metodo, ruta, cuerpo, espera) {
	return new Promise((resolver, rechazar) => {
		const req = request({host: '127.0.0.1', port: puerto, agent: false, method: metodo, path: ruta, headers: {'content-type': 'application/json', 'x-taller': '1'}}, (res) => {
			let texto = '';
			res.setEncoding('utf8');
			res.on('data', (t) => (texto += t));
			res.on('end', () => {
				try {
					resolver(JSON.parse(texto));
				} catch (e) {
					rechazar(e);
				}
			});
			res.on('error', rechazar);
		});
		req.on('error', rechazar);
		if (espera) req.setTimeout(espera, () => req.destroy(new Error('sin respuesta')));
		req.end(cuerpo);
	});
}

let r;
try {
	r = arg === 'salud' ? await pedir('GET', '/salud', undefined, 10_000) : await pedir('POST', '/render', readFileSync(arg, 'utf8'), 0);
} catch (e) {
	console.error(String(e?.message ?? e));
	process.exit(3);
}
if (!r.ok) {
	console.error(r.error);
	process.exit(2);
}
