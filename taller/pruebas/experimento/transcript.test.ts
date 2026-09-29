import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {auditar, contaminacion, hashRender} from '../../src/experimento/auditar.ts';
import {contarComandosTaller, extraerRutas, resumirTranscript, terminoBien} from '../../src/experimento/transcript.ts';

const RAIZ = 'C:/Users/User/Documents/github/lego-lab';
const TALLER = `${RAIZ}/taller`;
const EXTRACTO = readFileSync(join(import.meta.dirname, 'fixtures/r02-extracto.jsonl'), 'utf8');

const asistente = (id: string, bloques: object[], usage?: object) => JSON.stringify({type: 'assistant', message: {id, content: bloques, ...(usage ? {usage} : {})}});
const bash = (id: string, command: string) => ({type: 'tool_use', id, name: 'Bash', input: {command}});
const salida = (id: string, texto: string) => JSON.stringify({type: 'user', message: {content: [{type: 'tool_result', tool_use_id: id, content: texto}]}});

test('comandosTaller: el extracto real de r02 (alias T="…cli.ts") ya no da cero', () => {
	const r = resumirTranscript(EXTRACTO);
	assert.deepEqual(r.comandosTaller, {piezas: 6, construir: 9, validar: 10, render: 9});
});

test('comandosTaller: todas las apariciones, ${VAR}, alias de shell y npm run taller', () => {
	const c = (cmd: string) => contarComandosTaller(cmd);
	assert.deepEqual(c(`node ${TALLER}/src/cli.ts construir d.ts && node "${TALLER}/src/cli.ts" validar m.mpd && node ${TALLER}/src/cli.ts render m.mpd`), {construir: 1, validar: 1, render: 1});
	assert.deepEqual(c(`export CLI="node ${TALLER}/src/cli.ts"; \${CLI} validar m.mpd; $CLI validar m.mpd`), {validar: 2});
	// $TALLER no es el alias $T
	assert.deepEqual(c(`T="node ${TALLER}/src/cli.ts"; node $TALLER/src/cli.ts piezas ver 3001; $T construir d.ts`), {piezas: 1, construir: 1});
	assert.deepEqual(c(`V='node ${TALLER}/src/cli.ts validar'; $V a.mpd; $V b.mpd`), {validar: 2});
	assert.deepEqual(c(`alias v='node ${TALLER}/src/cli.ts validar'; v a.mpd; for x in 1 2; do v b.mpd; done`), {validar: 2});
	assert.deepEqual(c('npm run taller -- metricas modelo.mpd'), {metricas: 1});
	assert.deepEqual(c(`T="node ${TALLER}/src/cli.ts"; echo listo`), {});
});

test('extraerRutas: descarta el ruido de r02, quita file:/// y conserva las relativas', () => {
	const rutas = extraerRutas(`cat ${RAIZ}/taller/src/dsl.ts; grep -n "/Brown" x; echo /stud: /for // /\\.dat$/, /[cruz, tronco/arbol; node -e "import('file:///C:/a/b/dsl.ts')"; cat ../../taller/src/experimento/juez.ts renders/a.png /dev/null /c/Users/x/y.txt ~/.claude/projects/p/t.txt`);
	assert.deepEqual(rutas, [`${RAIZ}/taller/src/dsl.ts`, 'C:/a/b/dsl.ts', '../../taller/src/experimento/juez.ts', 'renders/a.png', '/dev/null', '/c/Users/x/y.txt', '~/.claude/projects/p/t.txt']);
	const r02 = resumirTranscript(EXTRACTO).rutasLeidas;
	for (const basura of ['/Brown', '/stud:', '/for', '//', '/\\.dat$/,']) assert.ok(!r02.includes(basura), basura);
});

test('de punta a punta: una lectura relativa del código del experimento marca la corrida', () => {
	const dir = `${RAIZ}/tmp-prueba/r03`;
	const rutas = resumirTranscript(asistente('m1', [bash('t1', 'cd ' + dir + '; cat ../../taller/src/experimento/juez.ts')])).rutasLeidas;
	const c = contaminacion(rutas, [dir], 'r03');
	assert.equal(c.motivos.length, 1);
	assert.match(c.motivos[0]!, /leyó código del experimento/);
	// un fragmento de heredoc como tronco/arbol ya no dispara "árbol ajeno"
	const heredoc = resumirTranscript(asistente('m2', [bash('t2', "cat > diseno.ts <<'EOF'\n// copa/arbol y tronco/tree\nEOF")])).rutasLeidas;
	assert.deepEqual(contaminacion(heredoc, [dir], 'r03'), {motivos: [], fuera: []});
});

test('sin línea result: costo, tokens y turnos se reconstruyen y la duración sale de inicio/fin', () => {
	const u1 = {input_tokens: 10, cache_creation_input_tokens: 1000, cache_read_input_tokens: 2000, cache_creation: {ephemeral_5m_input_tokens: 0}, output_tokens: 5};
	const u2 = {input_tokens: 2, cache_creation_input_tokens: 500, cache_read_input_tokens: 3000, cache_creation: {ephemeral_5m_input_tokens: 500}, output_tokens: 1};
	const jsonl = [
		JSON.stringify({type: 'system', subtype: 'thinking_tokens', estimated_tokens_delta: 100}),
		asistente('m1', [{type: 'text', text: 'hola'}], u1),
		asistente('m1', [{type: 'text', text: 'hola'}], u1),
		JSON.stringify({type: 'system', subtype: 'thinking_tokens', estimated_tokens_delta: 50}),
		asistente('m2', [bash('t1', 'ls')], u2),
	].join('\n');
	const r = resumirTranscript(jsonl, {inicio: '2026-09-29T10:00:00.000Z', fin: '2026-09-29T13:00:00.000Z'});
	assert.equal(r.costoEstimado, true);
	assert.equal(r.turnos, 2);
	assert.equal(r.tokensPensamiento, 150);
	// 150 de pensamiento + (4 + 16 caracteres) / 1,7
	assert.equal(r.tokensSalida, 162);
	const esperado = 12 * 4e-6 + 5000 * 0.2e-6 + 1000 * 8e-6 + 500 * 5e-6 + 162 * 20e-6;
	assert.ok(Math.abs(r.costoUsd - esperado) < 1e-9, `${r.costoUsd} ≠ ${esperado}`);
	assert.equal(r.duracionMs, 3 * 3600_000);
	// con línea result manda el CLI
	const conResultado = resumirTranscript(jsonl + '\n' + JSON.stringify({type: 'result', subtype: 'success', total_cost_usd: 1.5, num_turns: 3, duration_ms: 99, result: 'ENTREGADO'}));
	assert.equal(conResultado.costoEstimado, false);
	assert.equal(conResultado.costoUsd, 1.5);
	assert.equal(conResultado.subtipo, 'success');
});

test('salida de grep/rg/find con rutas del experimento o marcas de la rúbrica cuenta como lectura', () => {
	const jsonl = [
		asistente('m1', [bash('t1', `grep -rn juez ${TALLER}`)]),
		salida('t1', `${TALLER}/src/experimento/juez.ts:12: export const PROMPT = ...\n${TALLER}/src/dsl.ts:3: x`),
		asistente('m2', [bash('t2', 'cat notas.txt')]),
		salida('t2', 'menciona src/experimento/juez.ts pero no es una búsqueda'),
		asistente('m3', [bash('t3', 'node -e "1"')]),
		salida('t3', 'Sos juez de modelos originales…'),
	].join('\n');
	const r = resumirTranscript(jsonl);
	assert.deepEqual(r.lecturasExperimento, ['src/experimento/juez.ts', 'salida con "Sos juez de modelos"']);
});

test('contaminación en las cachés de render: solo el hash propio es limpio', () => {
	const dir = 'C:/Temp/lego-lab-exp01/r03';
	const render = `${RAIZ}/.cache/taller/render`;
	const c = (rutas: string[], propios: string[]) => contaminacion(rutas, [dir], 'r03', propios);
	assert.deepEqual(c([`${render}/abc123def456.mpd`, `${RAIZ}/estudio/public/taller/abc123def456.packed.mpd`], ['abc123def456']), {motivos: [], fuera: []});
	assert.match(c([`${render}/0123456789ab.mpd`], ['abc123def456']).motivos[0]!, /modelos ajenos del render/);
	assert.match(c([`${render}/*.mpd`], ['abc123def456']).motivos[0]!, /modelos ajenos del render/);
	// sin modelo propio no se puede decidir: revisión manual
	assert.deepEqual(c([`${render}/0123456789ab.mpd`], []), {motivos: [], fuera: [`${render}/0123456789ab.mpd`]});
	assert.deepEqual(c([`${render}/lote-1-2/0/element-0.png`], ['x']).fuera.length, 1);
	// el resto de la caché del taller sigue permitido
	assert.deepEqual(c([`${RAIZ}/.cache/taller/catalogo.json`], ['x']), {motivos: [], fuera: []});
});

test('terminoBien', () => {
	assert.ok(terminoBien('ENTREGADO'));
	assert.ok(terminoBien(' `ENTREGADO` \n'));
	assert.ok(terminoBien('SIN ENTREGA: no encastra'));
	assert.ok(!terminoBien('Espero a que termine la búsqueda de combinaciones para las hojas diagonales.'));
	assert.ok(!terminoBien(''));
});

test('auditar recalcula el resumen desde transcript.jsonl y marca terminoMal', async () => {
	const base = mkdtempSync(join(tmpdir(), 'aud-tr-'));
	const op = {conMetricas: false, corridas: join(base, 'corridas'), base: join(base, 't')};
	const armar = (id: string, final: string | null, mpd?: string) => {
		const dir = join(base, 'corridas', id);
		mkdirSync(dir, {recursive: true});
		// resumen congelado viejo: comandosTaller vacío
		writeFileSync(join(dir, 'resultado.json'), JSON.stringify({id, nivel: 'low', inicio: '2026-09-29T10:00:00Z', fin: '2026-09-29T10:30:00Z', resumen: {...resumirTranscript(''), comandosTaller: {}}}));
		const res = final === null ? '' : '\n' + JSON.stringify({type: 'result', subtype: 'success', total_cost_usd: 0.8, num_turns: 23, duration_ms: 647399, result: final});
		writeFileSync(join(dir, 'transcript.jsonl'), EXTRACTO + res);
		if (mpd) writeFileSync(join(dir, 'modelo.mpd'), mpd);
		return dir;
	};
	armar('r02', 'Espero a que termine la búsqueda de combinaciones para las hojas diagonales.');
	const a = await auditar('r02', op);
	assert.ok(a.resumen.comandosTaller.validar! > 0 && a.resumen.comandosTaller.construir! > 0);
	assert.equal(a.terminoMal, true);
	armar('r04', 'ENTREGADO');
	assert.equal((await auditar('r04', op)).terminoMal, false);
	armar('r06', null);
	const cortada = await auditar('r06', op);
	assert.equal(cortada.terminoMal, true);
	assert.equal(cortada.resumen.duracionMs, 30 * 60_000);
	assert.equal(cortada.resumen.costoEstimado, true);
	// el render del modelo propio no contamina; el de otro modelo sí
	const mpd = '0 FILE modelo.mpd\n0 Name: modelo.mpd\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat\n';
	const dir = armar('r08', 'ENTREGADO', mpd);
	const propio = hashRender(join(dir, 'modelo.mpd'));
	const lecturas = [asistente('x1', [bash('y1', `cat ${RAIZ}/.cache/taller/render/${propio}.mpd`)])];
	writeFileSync(join(dir, 'transcript.jsonl'), lecturas.join('\n'));
	assert.equal((await auditar('r08', op)).contaminada, false);
	writeFileSync(join(dir, 'transcript.jsonl'), asistente('x2', [bash('y2', `cat ${RAIZ}/.cache/taller/render/ffffffffffff.mpd`)]));
	assert.equal((await auditar('r08', op)).contaminada, true);
});
