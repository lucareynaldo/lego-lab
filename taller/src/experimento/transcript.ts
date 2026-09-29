export type Resumen = {
	costoUsd: number;
	turnos: number;
	duracionMs: number;
	tokensSalida: number;
	tokensPensamiento: number;
	// true si no hubo línea `result` (corte por tiempo o caída) y costo, tokens y turnos se reconstruyeron
	costoEstimado: boolean;
	// subtype de la línea result ('success', 'error_max_budget_usd', …); '' si no la hubo
	subtipo: string;
	herramientas: Record<string, number>;
	comandosTaller: Record<string, number>;
	rutasLeidas: string[];
	// rutas del código del experimento que aparecieron en la salida de un grep/rg/find, o marcas de la rúbrica
	lecturasExperimento: string[];
	final: string;
};

export type Tiempos = {inicio?: string; fin?: string};

const SUBCOMANDOS = ['piezas', 'construir', 'validar', 'render', 'metricas'];

// Precios de lista de claude-opus-5-5 en USD por token (reproducen el total_cost_usd de r02 al centavo)
const PRECIO = {entrada: 4e-6, escritura1h: 8e-6, escritura5m: 5e-6, lectura: 0.2e-6, salida: 20e-6};
// El usage de los mensajes assistant en stream-json trae output_tokens parciales: la salida visible se estima
// por caracteres (1,7 caracteres por token, calibrado con r02) y el pensamiento con los eventos thinking_tokens.
const CARACTERES_POR_TOKEN = 1.7;

const EXTENSIONES = /\.(?:[cm]?[jt]s|json|md|mpd|ldr|dat|png|txt|csv|sh|output|jsonl|html)$/i;
const CANDIDATO = /(?<=^|[\s"'=(<>|;&`])[^\s"'`;|&<>()]+/g;

// Solo tokens con forma de ruta real; las relativas se conservan relativas para que auditar las resuelva
export function extraerRutas(cmd: string): string[] {
	const rutas: string[] = [];
	for (const m of cmd.match(CANDIDATO) ?? []) {
		let t = m.replace(/^file:\/\/\/?/i, '');
		if (t !== '.' && t !== '..') t = t.replace(/[,.:]+$/, '');
		if (!t) continue;
		if (/^[A-Za-z]:[\\/]/.test(t)) rutas.push(t);
		else if (t.startsWith('/')) {
			// al menos dos segmentos, sin ':' ni caracteres de regex o expansión
			if (/^\/[^/\\:$*{}[\],]+\/[^\\:${}[\],]*$/.test(t) && !t.startsWith('//')) rutas.push(t);
		} else if (/^~\//.test(t) || /^\.\.?\//.test(t)) {
			if (!/[${}[\]\\]/.test(t) && t.length > 3) rutas.push(t);
		} else if (t.includes('/') && EXTENSIONES.test(t) && !t.includes(':') && !/[${}[\]\\]/.test(t)) rutas.push(t);
	}
	return rutas;
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CLI = /src[\\/]cli\.ts["']?/g;
const subDe = (resto: string) => resto.trim().split(/\s+/)[0] ?? '';

// Cuenta todas las invocaciones del CLI en un comando, incluidas las hechas por alias de shell definidos en él
// (T="node …/cli.ts"; $T validar …). Un bucle cuenta una vez por aparición textual.
export function contarComandosTaller(cmd: string, cuenta: Record<string, number> = {}): Record<string, number> {
	const sumar = (sub: string) => {
		if (SUBCOMANDOS.includes(sub)) cuenta[sub] = (cuenta[sub] ?? 0) + 1;
	};
	type Alias = {nombre: string; sub: string; conDolar: boolean};
	const alias: Alias[] = [];
	let limpio = cmd;
	const DEF = /(?:^|(?<=[\s;&|(]))(alias\s+|export\s+|local\s+)?([A-Za-z_]\w*)=("([^"]*)"|'([^']*)'|([^\s;&|]+))/g;
	for (const d of cmd.matchAll(DEF)) {
		const valor = d[4] ?? d[5] ?? d[6] ?? '';
		CLI.lastIndex = 0;
		const m = CLI.exec(valor);
		if (!m) continue;
		const sub = subDe(valor.slice(m.index + m[0].length));
		alias.push({nombre: d[2]!, sub: SUBCOMANDOS.includes(sub) ? sub : '', conDolar: !d[1]?.startsWith('alias')});
		limpio = limpio.replace(d[0], ' '.repeat(d[0].length));
	}
	for (const m of limpio.matchAll(CLI)) sumar(subDe(limpio.slice(m.index + m[0].length)));
	for (const m of limpio.matchAll(/npm\s+(?:run\s+)?taller\s+(?:--\s+)?(\S+)/g)) sumar(m[1]!);
	for (const a of alias) {
		const n = escapar(a.nombre);
		const uso = a.conDolar
			? new RegExp(String.raw`\$(?:\{${n}\}|${n}(?![A-Za-z0-9_]))["']?`, 'g')
			: new RegExp(String.raw`(?:^|[;&|(\n]|\bdo\b|\bthen\b)\s*${n}(?=\s|$)`, 'g');
		for (const m of limpio.matchAll(uso)) sumar(a.sub || subDe(limpio.slice(m.index + m[0].length)));
	}
	return cuenta;
}

const BUSQUEDA = /\bgrep\b[^|;&]*\s-[A-Za-z]*[rR]|\brg\b|\bfind\b|\bgrep\s+--recursive/;
const RUTA_EXPERIMENTO = /(?:src|pruebas)[\\/]experimento[\\/][^\s:"'`]+/g;
const MARCAS_RUBRICA = ['Sos juez de modelos', 'PROMPT_JUEZ'];

function textoResultado(b: any): string {
	if (typeof b?.content === 'string') return b.content;
	if (Array.isArray(b?.content)) return b.content.map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join('\n');
	return '';
}

export function resumirTranscript(jsonl: string, tiempos: Tiempos = {}): Resumen {
	const r: Resumen = {
		costoUsd: 0, turnos: 0, duracionMs: 0, tokensSalida: 0, tokensPensamiento: 0, costoEstimado: false, subtipo: '',
		herramientas: {}, comandosTaller: {}, rutasLeidas: [], lecturasExperimento: [], final: '',
	};
	const rutas = new Set<string>();
	const lecturas = new Set<string>();
	const busquedas = new Set<string>();
	const usos = new Map<string, any>();
	const bloquesVistos = new Set<string>();
	let caracteres = 0;
	let pensamiento = 0;
	let resultado: any;
	for (const linea of jsonl.split('\n')) {
		if (!linea.trim()) continue;
		let o: any;
		try {
			o = JSON.parse(linea);
		} catch {
			continue;
		}
		if (o?.type === 'result') resultado = o;
		if (o?.type === 'system' && o.subtype === 'thinking_tokens') pensamiento += Number(o.estimated_tokens_delta) || 0;
		if (o?.type === 'user' && Array.isArray(o.message?.content)) {
			for (const b of o.message.content) {
				if (b?.type !== 'tool_result') continue;
				const texto = textoResultado(b);
				for (const marca of MARCAS_RUBRICA) if (texto.includes(marca)) lecturas.add(`salida con "${marca}"`);
				if (busquedas.has(b.tool_use_id)) for (const m of texto.match(RUTA_EXPERIMENTO) ?? []) lecturas.add(m);
			}
		}
		if (o?.type !== 'assistant' || !Array.isArray(o.message?.content)) continue;
		const id = o.message.id ?? `sin-id-${usos.size}`;
		if (o.message.usage) usos.set(id, o.message.usage);
		for (const b of o.message.content) {
			// stream-json repite bloques del mismo mensaje: se cuentan una vez
			const clave = id + '|' + (b?.id ?? JSON.stringify(b));
			if (bloquesVistos.has(clave)) continue;
			bloquesVistos.add(clave);
			if (b?.type === 'text' && typeof b.text === 'string') caracteres += b.text.length;
			if (b?.type !== 'tool_use') continue;
			caracteres += JSON.stringify(b.input ?? {}).length;
			r.herramientas[b.name] = (r.herramientas[b.name] ?? 0) + 1;
			const entrada = b.input ?? {};
			if (['Read', 'Write', 'Edit'].includes(b.name) && typeof entrada.file_path === 'string') rutas.add(entrada.file_path);
			if (b.name === 'Bash' && typeof entrada.command === 'string') {
				const cmd: string = entrada.command;
				for (const m of extraerRutas(cmd)) rutas.add(m);
				contarComandosTaller(cmd, r.comandosTaller);
				if (BUSQUEDA.test(cmd) && typeof b.id === 'string') busquedas.add(b.id);
			}
		}
	}
	r.rutasLeidas = [...rutas];
	r.lecturasExperimento = [...lecturas];
	if (resultado) {
		r.costoUsd = resultado.total_cost_usd ?? 0;
		r.turnos = resultado.num_turns ?? 0;
		r.duracionMs = resultado.duration_ms ?? 0;
		r.subtipo = typeof resultado.subtype === 'string' ? resultado.subtype : '';
		r.final = typeof resultado.result === 'string' ? resultado.result : '';
		for (const m of Object.values<any>(resultado.modelUsage ?? {})) {
			r.tokensSalida += m?.outputTokens ?? 0;
			r.tokensPensamiento += m?.thinkingTokens ?? 0;
		}
	} else if (usos.size > 0) {
		r.costoEstimado = true;
		r.turnos = usos.size;
		let costo = 0;
		for (const u of usos.values()) {
			const escritura = Number(u.cache_creation_input_tokens) || 0;
			const e5m = Number(u.cache_creation?.ephemeral_5m_input_tokens) || 0;
			costo += (Number(u.input_tokens) || 0) * PRECIO.entrada + (Number(u.cache_read_input_tokens) || 0) * PRECIO.lectura;
			costo += e5m * PRECIO.escritura5m + (escritura - e5m) * PRECIO.escritura1h;
		}
		r.tokensPensamiento = pensamiento;
		r.tokensSalida = Math.round(pensamiento + caracteres / CARACTERES_POR_TOKEN);
		r.costoUsd = costo + r.tokensSalida * PRECIO.salida;
	}
	if (!resultado && tiempos.inicio && tiempos.fin) {
		const ms = Date.parse(tiempos.fin) - Date.parse(tiempos.inicio);
		if (Number.isFinite(ms) && ms > 0) {
			r.duracionMs = ms;
			r.costoEstimado = true;
		}
	}
	return r;
}

// El agente termina bien solo si su último mensaje es ENTREGADO o SIN ENTREGA: <motivo>
export function terminoBien(final: string): boolean {
	const f = final.trim().replace(/^`+|`+$/g, '').trim();
	return f === 'ENTREGADO' || f.startsWith('SIN ENTREGA');
}
