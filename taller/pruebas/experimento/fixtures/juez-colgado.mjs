// juez que se cuelga: siempre con JUEZ_COLGAR_SIEMPRE=1, o una sola vez si existe JUEZ_COLGAR_ARCHIVO (lo borra)
import {existsSync, rmSync} from 'node:fs';
let entrada = '';
process.stdin.on('data', (d) => (entrada += d));
process.stdin.on('end', () => {
	const archivo = process.env.JUEZ_COLGAR_ARCHIVO;
	let colgar = process.env.JUEZ_COLGAR_SIEMPRE === '1';
	if (archivo && existsSync(archivo)) {
		rmSync(archivo);
		colgar = true;
	}
	if (colgar) {
		setInterval(() => {}, 60_000);
		return;
	}
	console.log(JSON.stringify({type: 'result', result: 'Razono.\n{"reconoce":"A","creatividad":"B","tecnica":"empate","historia":"A","general":"B"}', total_cost_usd: 0.1}));
});
