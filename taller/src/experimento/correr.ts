import {spawn, spawnSync} from 'node:child_process';
import {cpSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {planCorridas, type Corrida} from './plan.ts';
import {resumirTranscript} from './transcript.ts';

const TALLER = resolve(import.meta.dirname, '../..');
const RAIZ = resolve(TALLER, '..');
const EXPERIMENTO = join(RAIZ, 'diseno/experimentos/01-arbol-esfuerzo');
const SALIDA = join(RAIZ, '.cache/experimentos/01/corridas');
const CLAUDE_EXE = 'C:\\Users\\User\\.local\\bin\\claude.exe';

export const CALIBRACION: Corrida = {id: 'calibracion', nivel: 'max', orden: -1};
const barras = (ruta: string) => ruta.split(String.fromCharCode(92)).join('/');

export function prepararCarpeta(c: Corrida, base: string): string {
	const dir = join(base, c.id);
	// restos de una corrida anterior contaminarían la reanudada
	rmSync(dir, {recursive: true, force: true});
	mkdirSync(dir, {recursive: true});
	// el comentario HTML del principio es para humanos, no para el agente
	const plantilla = readFileSync(join(EXPERIMENTO, 'consigna.md'), 'utf8').replace(/^\s*<!--[\s\S]*?-->\s*/, '');
	const consigna = plantilla
		.replaceAll('{{DIR}}', barras(dir))
		.replaceAll('{{TALLER}}', barras(TALLER))
		.replaceAll('{{DSL_URL}}', pathToFileURL(join(TALLER, 'src/dsl.ts')).href);
	writeFileSync(join(dir, 'consigna.md'), consigna);
	cpSync(join(EXPERIMENTO, 'hechos-arbol.md'), join(dir, 'hechos-arbol.md'));
	return dir;
}

export function argsCorrida(nivel: string, tope: number): string[] {
	return [
		'-p', '--model', 'claude-opus-5-5', '--effort', nivel,
		'--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence',
		'--tools', 'Bash,Read,Write,Edit', '--disallowedTools', 'WebSearch,WebFetch,Agent',
		'--permission-mode', 'bypassPermissions', '--max-budget-usd', String(tope),
		'--output-format', 'stream-json', '--verbose',
	];
}

// ejecutable y argumentos previos; CLAUDE_BIN permite probar con un guion de node
export function resolverClaude(): {exe: string; previos: string[]} {
	const forzado = process.env.CLAUDE_BIN;
	if (forzado) return /\.(?:[cm]?js|ts)$/.test(forzado) ? {exe: process.execPath, previos: ['--no-warnings', forzado]} : {exe: forzado, previos: []};
	if (process.platform !== 'win32') return {exe: 'claude', previos: []};
	const r = spawnSync('where', ['claude'], {encoding: 'utf8'});
	const exe = r.stdout?.split(/\r?\n/).find((l) => l.toLowerCase().endsWith('.exe'));
	return {exe: exe?.trim() || CLAUDE_EXE, previos: []};
}

type Opciones = {
	concurrencia: number;
	tope: number;
	limiteMin: number;
	soloIds?: string[];
	// para pruebas: lista propia de corridas y carpetas propias
	corridas?: Corrida[];
	base?: string;
	salida?: string;
	prompt?: string;
};

const vivos = new Set<number>();

export function matarArbol(pid: number | undefined, hijo?: {kill: (s: NodeJS.Signals) => boolean}) {
	// taskkill /T porque el hijo lanza procesos propios (Bash, node)
	if (process.platform === 'win32' && pid) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F']);
	else hijo?.kill('SIGKILL');
}

function tuvoResultado(jsonl: string): boolean {
	return jsonl.split('\n').some((l) => l.includes('"type":"result"') && (() => {
		try {
			return JSON.parse(l)?.type === 'result';
		} catch {
			return false;
		}
	})());
}

function correrUna(c: Corrida, dir: string, prompt: string, op: Opciones, claude: {exe: string; previos: string[]}): Promise<void> {
	const destino = join(op.salida ?? SALIDA, c.id);
	const inicio = new Date();
	return new Promise((listo) => {
		let cortada = false;
		let cerrado = false;
		let falloLanzar: string | undefined;
		let reloj: NodeJS.Timeout | undefined;
		let pid: number | undefined;

		const cierre = (codigo: number | null) => {
			if (cerrado) return;
			cerrado = true;
			clearTimeout(reloj);
			if (pid) vivos.delete(pid);
			let terminados = 0;
			const fin = () => {
				if (++terminados < 2) return;
				try {
					let jsonl = '';
					try {
						jsonl = readFileSync(join(dir, 'transcript.jsonl'), 'utf8');
					} catch {}
					const resumen = resumirTranscript(jsonl);
					const infraestructura = !cortada && (falloLanzar !== undefined || (codigo !== 0 && !tuvoResultado(jsonl)));
					registrar({infraestructura, ...(falloLanzar ? {errorLanzador: falloLanzar} : {})}, resumen, codigo);
				} catch (e) {
					// el lanzador nunca cae por una corrida: se anota el error y se libera el cupo
					try {
						registrar({infraestructura: true, errorLanzador: String((e as Error)?.stack ?? e)}, resumirTranscript(''), codigo);
					} catch (e2) {
						console.error(`[${c.id}] no se pudo registrar el resultado: ${e2}`);
					}
				}
				listo();
			};
			salida.end(fin);
			errores.end(fin);
		};

		const registrar = (extra: object, resumen: ReturnType<typeof resumirTranscript>, codigo: number | null) => {
			const resultado = {id: c.id, nivel: c.nivel, inicio: inicio.toISOString(), fin: new Date().toISOString(), codigo, cortadaPorTiempo: cortada, ...extra, resumen};
			writeFileSync(join(dir, 'resultado.json'), JSON.stringify(resultado, null, '\t'));
			// restos de un intento anterior (falla de infraestructura) contarían como entrega de este
			rmSync(destino, {recursive: true, force: true});
			mkdirSync(destino, {recursive: true});
			for (const f of ['diseno.ts', 'modelo.mpd', 'modelo.mapa.json', 'ficha.md', 'renders', 'transcript.jsonl', 'stderr.txt', 'consigna.md'])
				if (existsSync(join(dir, f))) cpSync(join(dir, f), join(destino, f), {recursive: true});
			// resultado.json al final: su presencia marca la corrida como completa
			cpSync(join(dir, 'resultado.json'), join(destino, 'resultado.json'));
			console.log(`[${c.id}] ${c.nivel} código=${codigo} costo=${resumen.costoUsd} cortada=${cortada}${(extra as any).infraestructura ? ' INFRAESTRUCTURA (se repetirá)' : ''}`);
		};

		const salida = createWriteStream(join(dir, 'transcript.jsonl'));
		const errores = createWriteStream(join(dir, 'stderr.txt'));
		const hijo = spawn(claude.exe, [...claude.previos, ...argsCorrida(c.nivel, op.tope)], {cwd: dir, shell: false, stdio: ['pipe', 'pipe', 'pipe']});
		pid = hijo.pid;
		if (pid) vivos.add(pid);
		reloj = setTimeout(() => {
			cortada = true;
			matarArbol(hijo.pid, hijo);
		}, op.limiteMin * 60_000);
		hijo.stdout.pipe(salida);
		hijo.stderr.pipe(errores);
		hijo.on('error', (e) => {
			falloLanzar = `error al lanzar: ${e.message}`;
			errores.write(falloLanzar + '\n');
			cierre(null);
		});
		hijo.on('close', cierre);
		hijo.stdin.on('error', () => {});
		hijo.stdin.end(prompt);
		console.log(`[${c.id}] lanzada (${c.nivel})`);
	});
}

async function pool(corridas: Corrida[], concurrencia: number, tarea: (c: Corrida) => Promise<void>) {
	const cola = [...corridas];
	const obreros = Array.from({length: Math.max(1, concurrencia)}, async () => {
		for (let c = cola.shift(); c; c = cola.shift()) {
			try {
				await tarea(c);
			} catch (e) {
				console.error(`[${c.id}] falló el lanzamiento: ${e}`);
			}
		}
	});
	await Promise.all(obreros);
}

// hecha = hay resultado.json y no fue una falla de infraestructura
function motivoSalto(id: string, salida: string): string | undefined {
	const ruta = join(salida, id, 'resultado.json');
	if (!existsSync(ruta)) return undefined;
	try {
		const r = JSON.parse(readFileSync(ruta, 'utf8'));
		if (r.infraestructura === true) return undefined;
		return r.cortadaPorTiempo ? 'cortada por tiempo (cuenta como hecha)' : 'ya tiene resultado';
	} catch {
		return undefined;
	}
}

export async function correrTodas(op: Opciones): Promise<void> {
	const salida = op.salida ?? SALIDA;
	const todas = op.corridas ?? [...planCorridas(), CALIBRACION];
	if (op.soloIds) for (const id of op.soloIds) if (!todas.some((c) => c.id === id)) console.warn(`aviso: --solo ${id} no existe`);
	const solicitadas = op.soloIds ? todas.filter((c) => op.soloIds!.includes(c.id)) : op.corridas ?? planCorridas();
	const faltan: Corrida[] = [];
	for (const c of solicitadas) {
		const motivo = motivoSalto(c.id, salida);
		if (motivo) console.log(`[${c.id}] se salta: ${motivo}`);
		else faltan.push(c);
	}
	faltan.sort((a, b) => a.orden - b.orden);
	const claude = resolverClaude();
	const base = op.base ?? join(tmpdir(), 'lego-lab-exp01');
	await pool(faltan, op.concurrencia, (c) => {
		const dir = prepararCarpeta(c, base);
		return correrUna(c, dir, op.prompt ?? readFileSync(join(dir, 'consigna.md'), 'utf8'), op, claude);
	});
}

// todo en el temporal: la prueba nunca escribe en la carpeta real de corridas
export async function prueba(): Promise<string> {
	const c: Corrida = {id: 'prueba', nivel: 'low', orden: 0};
	const raiz = mkdtempSync(join(tmpdir(), 'lego-lab-exp01-prueba-'));
	const dir = join(raiz, 'trabajo', c.id);
	mkdirSync(dir, {recursive: true});
	const salida = join(raiz, 'salida');
	await correrUna(c, dir, 'Respondé solo: ENTREGADO', {concurrencia: 1, tope: 1, limiteMin: 5, salida}, resolverClaude());
	console.log(`prueba escrita en ${salida}`);
	return salida;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
	const salir = () => {
		for (const pid of vivos) matarArbol(pid);
		process.exit(130);
	};
	process.on('SIGINT', salir);
	process.on('SIGTERM', salir);
	const args = process.argv.slice(2);
	const num = (n: string, def: number) => {
		if (!args.includes(n)) return def;
		const v = Number(args[args.indexOf(n) + 1]);
		if (!Number.isFinite(v) || v < 0) {
			console.error(`${n} necesita un número válido`);
			process.exit(2);
		}
		return v;
	};
	if (args.includes('--prueba')) await prueba();
	else {
		const solo = args.includes('--solo') ? args[args.indexOf('--solo') + 1] : undefined;
		await correrTodas({
			concurrencia: num('--concurrencia', 3),
			tope: num('--tope', 30),
			limiteMin: num('--limite-min', 180),
			soloIds: solo?.split(','),
		});
	}
}
