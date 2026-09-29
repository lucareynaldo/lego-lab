import assert from 'node:assert/strict';
import {test} from 'node:test';
import {idsAnonimos, mezclar, mulberry32} from '../../src/experimento/azar.ts';
import {planCorridas} from '../../src/experimento/plan.ts';
import {resumirTranscript} from '../../src/experimento/transcript.ts';

test('mulberry32 es determinista', () => {
	const a = mulberry32(1);
	const b = mulberry32(1);
	assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('plan: 25 corridas, 5 por nivel, orden permutado y estable', () => {
	const p = planCorridas();
	assert.equal(p.length, 25);
	for (const n of ['low', 'medium', 'high', 'xhigh', 'max']) assert.equal(p.filter((c) => c.nivel === n).length, 5);
	assert.deepEqual([...p.map((c) => c.orden)].sort((x, y) => x - y), Array.from({length: 25}, (_, i) => i));
	assert.deepEqual(planCorridas(), p);
	assert.notDeepEqual(p.map((c) => c.nivel).slice(0, 5), ['low', 'low', 'low', 'low', 'low']);
});

test('ids anónimos únicos de 4 letras', () => {
	const ids = idsAnonimos(25, mulberry32(7));
	assert.equal(new Set(ids).size, 25);
	assert.ok(ids.every((x) => /^[A-Z]{4}$/.test(x)));
	assert.deepEqual(mezclar([1, 2, 3], mulberry32(1)).sort(), [1, 2, 3]);
});

test('resumirTranscript cuenta herramientas, comandos del taller y costo', () => {
	const lineas = [
		{type: 'assistant', message: {content: [{type: 'tool_use', name: 'Bash', input: {command: 'node --no-warnings C:/x/taller/src/cli.ts render modelo.mpd --salida r/'}}]}},
		{type: 'assistant', message: {content: [{type: 'tool_use', name: 'Bash', input: {command: 'node --no-warnings C:/x/taller/src/cli.ts validar modelo.mpd'}}]}},
		{type: 'assistant', message: {content: [{type: 'tool_use', name: 'Read', input: {file_path: 'C:/otra/cosa.ldr'}}]}},
		{type: 'result', total_cost_usd: 1.5, num_turns: 3, duration_ms: 1000, result: 'ENTREGADO', modelUsage: {'claude-opus-5-5': {outputTokens: 900, thinkingTokens: 400}}},
	];
	const r = resumirTranscript(lineas.map((l) => JSON.stringify(l)).join('\n'));
	assert.deepEqual(r.comandosTaller, {render: 1, validar: 1});
	assert.equal(r.herramientas.Bash, 2);
	assert.ok(r.rutasLeidas.includes('C:/otra/cosa.ldr'));
	assert.equal(r.costoUsd, 1.5);
	assert.equal(r.tokensPensamiento, 400);
	assert.equal(r.final, 'ENTREGADO');
});

test('resumirTranscript entiende rutas y cli.ts con barras invertidas', () => {
	const cmd = 'node --no-warnings C:\\Users\\x\\taller\\src\\cli.ts construir C:\\Users\\x\\otro\\cosa.ldr';
	const linea = {type: 'assistant', message: {content: [{type: 'tool_use', name: 'Bash', input: {command: cmd}}]}};
	const r = resumirTranscript(JSON.stringify(linea));
	assert.deepEqual(r.comandosTaller, {construir: 1});
	assert.ok(r.rutasLeidas.includes('C:\\Users\\x\\otro\\cosa.ldr'));
});
