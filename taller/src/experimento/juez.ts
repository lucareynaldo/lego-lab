import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {matarArbol, resolverClaude} from './correr.ts';
import type {Imagenes} from './imagenes.ts';

export const CRITERIOS = ['reconoce', 'creatividad', 'tecnica', 'historia', 'general'] as const;
export type Criterio = (typeof CRITERIOS)[number];
export type Veredicto = Record<Criterio, 'A' | 'B' | 'empate'>;

export const PROMPT_JUEZ = `Sos juez de modelos originales hechos con ladrillos LEGO para videos cortos de armado (formato vertical, se ven en el celular).
Vas a comparar dos modelos, A y B. De cada uno hay dos imágenes: una grilla con 4 vistas (3/4, frente, lado, 3/4 desde atrás) y su silueta de frente a 64 px, que es como se vería de lejos en un teléfono.
Abrí las cuatro imágenes con Read:
- A grilla: {{A_GRILLA}}
- A silueta: {{A_SILUETA}}
- B grilla: {{B_GRILLA}}
- B silueta: {{B_SILUETA}}
{{TEMA}}
Criterios, cada uno por separado:
1. reconoce: ¿se reconoce al instante qué es, también en la silueta de 64 px?
2. creatividad: ¿tiene una idea, una técnica no obvia o un uso ingenioso de una pieza?
3. tecnica: proporción, paleta de colores, terminación de todos los lados.
4. historia: ¿evoca o cuenta algo?
5. general: ¿cuál es mejor modelo para un video de armado? Un modelo técnicamente prolijo pero aburrido no es mejor.
Primero escribí tu razonamiento, breve y concreto, mirando las imágenes. Después, en la ÚLTIMA línea y sin nada más, un JSON así:
{"reconoce":"A|B|empate","creatividad":"A|B|empate","tecnica":"A|B|empate","historia":"A|B|empate","general":"A|B|empate"}`;

export const TEMA_ARBOL = 'Los dos modelos representan un árbol.';
export const TEMA_SELECCION = 'Los dos modelos representan lo mismo.';

const VALORES = ['A', 'B', 'empate'];

export function parsearVeredicto(texto: string): Veredicto | null {
	const lineas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	const ultima = lineas.at(-1);
	if (!ultima) return null;
	try {
		const o = JSON.parse(ultima);
		if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
		const v = {} as Veredicto;
		for (const c of CRITERIOS) {
			if (!VALORES.includes(o[c])) return null;
			v[c] = o[c];
		}
		return v;
	} catch {
		return null;
	}
}

const invertir = (x: 'A' | 'B' | 'empate') => (x === 'A' ? 'B' : x === 'B' ? 'A' : x);

// ba se juzgó con las posiciones cambiadas: se da vuelta antes de comparar
export function combinarOrdenes(ab: Veredicto, ba: Veredicto): Veredicto {
	const r = {} as Veredicto;
	for (const c of CRITERIOS) r[c] = ab[c] === invertir(ba[c]) ? ab[c] : 'empate';
	return r;
}

const barras = (ruta: string) => ruta.split(String.fromCharCode(92)).join('/');

export function armarPrompt(a: Imagenes, b: Imagenes, tema: string): string {
	return PROMPT_JUEZ
		.replace('{{A_GRILLA}}', () => barras(a.grilla))
		.replace('{{A_SILUETA}}', () => barras(a.silueta))
		.replace('{{B_GRILLA}}', () => barras(b.grilla))
		.replace('{{B_SILUETA}}', () => barras(b.silueta))
		.replace('{{TEMA}}', () => tema);
}

export function argsJuez(juez: string): string[] {
	return [
		'-p', '--model', juez, '--effort', 'high',
		'--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence',
		'--tools', 'Read', '--permission-mode', 'bypassPermissions', '--output-format', 'json',
	];
}

// un claude colgado bloquearía su cupo para siempre: pasado el tope se mata el árbol y cuenta como sin veredicto
export const TOPE_JUEZ_MS = 5 * 60_000;

function llamar(juez: string, prompt: string, dir: string, topeMs: number): Promise<{texto: string; costoUsd: number; crudo: string}> {
	const claude = resolverClaude();
	return new Promise((listo) => {
		let out = '';
		let err = '';
		let hecho = false;
		let reloj: NodeJS.Timeout | undefined;
		const fin = (extra = '') => {
			if (hecho) return;
			hecho = true;
			clearTimeout(reloj);
			let texto = '';
			let costoUsd = 0;
			try {
				const j = JSON.parse(out);
				texto = typeof j.result === 'string' ? j.result : '';
				costoUsd = Number(j.total_cost_usd) || 0;
			} catch {}
			listo({texto, costoUsd, crudo: out || err || extra});
		};
		const hijo = spawn(claude.exe, [...claude.previos, ...argsJuez(juez)], {cwd: dir, shell: false, stdio: ['pipe', 'pipe', 'pipe']});
		reloj = setTimeout(() => {
			matarArbol(hijo.pid, hijo);
			out = '';
			fin(`tope de ${topeMs} ms: se mató el proceso`);
		}, topeMs);
		hijo.stdout.on('data', (d) => (out += d));
		hijo.stderr.on('data', (d) => (err += d));
		hijo.on('error', (e) => fin(`error al lanzar: ${e.message}`));
		hijo.on('close', () => fin());
		hijo.stdin.on('error', () => {});
		hijo.stdin.end(prompt);
	});
}

export async function juzgarPar(juez: string, a: Imagenes, b: Imagenes, tema: string, dirTrabajo: string, topeMs = TOPE_JUEZ_MS): Promise<{veredicto: Veredicto | null; costoUsd: number; crudo: string}> {
	mkdirSync(dirTrabajo, {recursive: true});
	const prompt = armarPrompt(a, b, tema);
	let costoUsd = 0;
	let crudo = '';
	for (let intento = 0; intento < 2; intento++) {
		// dos intentos: un veredicto ilegible o un tope vencido se reintentan una vez
		const r = await llamar(juez, prompt, dirTrabajo, topeMs);
		costoUsd += r.costoUsd;
		crudo = r.crudo;
		const veredicto = parsearVeredicto(r.texto);
		if (veredicto) return {veredicto, costoUsd, crudo};
	}
	return {veredicto: null, costoUsd, crudo};
}
