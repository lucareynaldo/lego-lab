import {appendFileSync} from 'node:fs';
import {basename} from 'node:path';

// simula claude: lee stdin, duerme, deja marcas de inicio y fin y emite un resultado stream-json
const registro = process.env.REGISTRO_FALSO;
let entrada = '';
process.stdin.on('data', (d) => (entrada += d));
process.stdin.on('end', async () => {
	const id = basename(process.cwd());
	appendFileSync(registro, `${id} inicio ${Date.now()}\n`);
	if (process.env.FALSO_CAE === id) {
		appendFileSync(registro, `${id} fin ${Date.now()}\n`);
		process.exit(1);
	}
	await new Promise((r) => setTimeout(r, 300));
	appendFileSync(registro, `${id} fin ${Date.now()}\n`);
	console.log(JSON.stringify({type: 'result', result: 'ENTREGADO', total_cost_usd: 0.5, num_turns: 1, duration_ms: 300, modelUsage: {}}));
});
