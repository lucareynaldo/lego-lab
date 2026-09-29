// como juez-falso, pero registra el prompt en JUEZ_LOG y con JUEZ_FALLA=1 no devuelve veredicto
import {appendFileSync, existsSync} from 'node:fs';
let entrada = '';
process.stdin.on('data', (d) => (entrada += d));
process.stdin.on('end', () => {
	if (process.env.JUEZ_LOG) appendFileSync(process.env.JUEZ_LOG, JSON.stringify(entrada) + '\n');
	const falla = process.env.JUEZ_FALLA_ARCHIVO ? existsSync(process.env.JUEZ_FALLA_ARCHIVO) : false;
	const v = falla ? 'sin veredicto' : '{"reconoce":"A","creatividad":"B","tecnica":"empate","historia":"A","general":"A"}';
	console.log(JSON.stringify({type: 'result', result: `Razono.\n${v}`, total_cost_usd: 0.1}));
});
