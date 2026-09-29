// simula claude como juez: consume stdin y responde el veredicto de FALSO_VEREDICTO (o uno válido)
let entrada = '';
process.stdin.on('data', (d) => (entrada += d));
process.stdin.on('end', () => {
	const v = process.env.FALSO_VEREDICTO ?? '{"reconoce":"A","creatividad":"B","tecnica":"empate","historia":"A","general":"A"}';
	console.log(JSON.stringify({type: 'result', result: `Razonamiento breve.\n${v}`, total_cost_usd: 0.25}));
});
