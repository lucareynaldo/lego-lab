import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {mezclar, mulberry32} from './azar.ts';
import {planCorridas} from './plan.ts';

const RAIZ = resolve(import.meta.dirname, '../../..');
const SALIDA = join(RAIZ, '.cache/experimentos/01');

export type ModeloNivel = {anon: string; nivel: string};
export type Par = {a: string; b: string; izq: string; der: string; repetido: boolean};

export const PARES = 75;
export const REPETIDOS = 10;

// Reparte los pares en partes parejas entre pares de niveles y, dentro de cada uno, prefiere los modelos
// menos usados hasta ahora (y pares no repetidos) para que ningún modelo quede rezagado.
export function seleccionarPares(modelos: ModeloNivel[], semilla: number, total = PARES): [string, string][] {
	const azar = mulberry32(semilla);
	const niveles = [...new Set(modelos.map((m) => m.nivel))].sort();
	const porNivel = new Map(niveles.map((n) => [n, modelos.filter((m) => m.nivel === n).map((m) => m.anon)]));
	const combos: [string, string][] = [];
	for (let i = 0; i < niveles.length; i++) for (let j = i + 1; j < niveles.length; j++) combos.push([niveles[i]!, niveles[j]!]);
	if (combos.length === 0) return [];
	const orden = mezclar(combos, azar);
	const base = Math.floor(total / orden.length);
	const extra = total - base * orden.length;
	const cupo = orden.map((_, i) => base + (i < extra ? 1 : 0));
	const usos = new Map(modelos.map((m) => [m.anon, 0]));
	const usados = new Set<string>();
	const pares: [string, string][] = [];
	for (let ronda = 0; ronda < Math.max(...cupo); ronda++) {
		for (const i of mezclar(orden.map((_, x) => x), azar)) {
			if (ronda >= cupo[i]!) continue;
			const [na, nb] = orden[i]!;
			let mejor: {par: [string, string]; costo: number} | null = null;
			for (const a of porNivel.get(na)!) {
				for (const b of porNivel.get(nb)!) {
					if (usados.has(a + b)) continue;
					const costo = usos.get(a)! + usos.get(b)! + azar() * 0.5;
					if (!mejor || costo < mejor.costo) mejor = {par: [a, b], costo};
				}
			}
			if (!mejor) continue;
			const [a, b] = mejor.par;
			usados.add(a + b);
			usos.set(a, usos.get(a)! + 1);
			usos.set(b, usos.get(b)! + 1);
			pares.push(mejor.par);
		}
	}
	return pares;
}

// pares en orden aleatorio con lados al azar y, al final, los repetidos mezclados con los lados invertidos
export function armarSecuencia(pares: [string, string][], semilla: number, repetidos = REPETIDOS): Par[] {
	const azar = mulberry32(semilla);
	const base: Par[] = mezclar(pares, azar).map(([a, b]) => (azar() < 0.5 ? {a, b, izq: a, der: b, repetido: false} : {a, b, izq: b, der: a, repetido: false}));
	const otros = mezclar(base, azar).slice(0, Math.min(repetidos, base.length)).map((p) => ({...p, izq: p.der, der: p.izq, repetido: true}));
	return [...base, ...mezclar(otros, azar)];
}

const png64 = (ruta: string) => 'data:image/png;base64,' + readFileSync(ruta).toString('base64');

export type OpcionesPagina = {salida?: string; ids?: string[]};

// La clave solo sirve para balancear por par de niveles: el HTML guarda únicamente ids anónimos.
export function generarPaginaHumano(op: OpcionesPagina = {}): string {
	const salida = op.salida ?? SALIDA;
	const clave: Record<string, string> = JSON.parse(readFileSync(join(salida, 'clave.json'), 'utf8'));
	const auditoria: {id: string; nivel: string}[] = JSON.parse(readFileSync(join(salida, 'auditoria.json'), 'utf8'));
	const nivelDe = new Map(auditoria.map((a) => [a.id, a.nivel]));
	// solo corridas del plan: la calibración o un intento cortado descompensarían el reparto por niveles
	const plan = new Set(op.ids ?? planCorridas().map((c) => c.id));
	const modelos = Object.entries(clave).filter(([, id]) => plan.has(id)).map(([anon, id]) => ({anon, nivel: nivelDe.get(id) ?? '?'}));
	const secuencia = armarSecuencia(seleccionarPares(modelos, 20260929 + 2), 20260929 + 3);
	const usados = new Set(secuencia.flatMap((p) => [p.a, p.b]));
	const imagenes: Record<string, {g: string; s: string}> = {};
	for (const anon of [...usados].sort()) {
		const dir = join(salida, 'ciego', anon);
		imagenes[anon] = {g: png64(join(dir, `${anon}-grilla.png`)), s: png64(join(dir, `${anon}-silueta.png`))};
	}
	// la clave de localStorage depende de la secuencia: una página regenerada no hereda respuestas por posición
	const huella = createHash('sha1').update(JSON.stringify(secuencia)).digest('hex').slice(0, 12);
	const html = PLANTILLA.replace('__HUELLA__', huella).replace('__DATOS__', () => JSON.stringify({secuencia, imagenes}).replace(/</g, '\\u003c'));
	mkdirSync(salida, {recursive: true});
	const ruta = join(salida, 'humano.html');
	writeFileSync(ruta, html);
	return ruta;
}

const PLANTILLA = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Juicio de modelos</title>
<style>
	* { box-sizing: border-box; }
	body { margin: 0; font-family: system-ui, sans-serif; background: #1b1b1f; color: #f2f2f2; }
	header { padding: 12px 16px; position: sticky; top: 0; background: #1b1b1f; z-index: 1; }
	h1 { font-size: 1.1rem; margin: 0 0 8px; }
	.barra { height: 8px; background: #3a3a44; border-radius: 4px; overflow: hidden; }
	.barra div { height: 100%; width: 0; background: #4ea1ff; transition: width .2s; }
	#estado { font-size: .85rem; margin-top: 4px; color: #b8b8c4; }
	.par { display: flex; gap: 8px; padding: 8px; }
	.lado { flex: 1 1 0; min-width: 0; background: #26262c; border-radius: 8px; padding: 6px; text-align: center; }
	.lado img.grilla { width: 100%; height: auto; display: block; border-radius: 4px; background: #fff; }
	.lado img.silueta { width: 64px; height: 64px; image-rendering: pixelated; margin-top: 6px; background: #fff; }
	.lado .et { font-size: .8rem; color: #b8b8c4; margin-bottom: 4px; }
	@media (width <= 640px) { .par { flex-direction: column; } }
	.botones { display: flex; gap: 8px; padding: 8px; }
	button { flex: 1; font-size: 1.05rem; padding: 14px 8px; border: 0; border-radius: 8px; background: #4ea1ff; color: #06121f; font-weight: 600; cursor: pointer; }
	button.empate { background: #d0d0d8; }
	button.sec { background: #3a3a44; color: #f2f2f2; flex: 0 1 auto; padding: 10px 14px; font-size: .9rem; }
	.pie { padding: 8px 16px 24px; font-size: .85rem; color: #b8b8c4; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
	#fin { padding: 24px 16px; display: none; }
</style>
</head>
<body>
<header>
	<h1>¿Cuál es mejor modelo para un video de armado?</h1>
	<div class="barra"><div id="prog"></div></div>
	<div id="estado"></div>
</header>
<main id="juego">
	<div class="par">
		<div class="lado"><div class="et">Izquierda</div><img class="grilla" id="gi" alt="Modelo de la izquierda"><img class="silueta" id="si" alt="Silueta izquierda"></div>
		<div class="lado"><div class="et">Derecha</div><img class="grilla" id="gd" alt="Modelo de la derecha"><img class="silueta" id="sd" alt="Silueta derecha"></div>
	</div>
	<div class="botones">
		<button id="bi">Izquierda</button>
		<button id="be" class="empate">Empate</button>
		<button id="bd">Derecha</button>
	</div>
	<div class="pie">
		<button class="sec" id="atras">Volver</button>
		<span>Atajos: ← izquierda, ↓ o espacio empate, → derecha, retroceso vuelve.</span>
	</div>
</main>
<div id="fin">
	<p>Listo, respondiste todos los pares. Descargá el archivo y pasáselo a quien corre el análisis.</p>
</div>
<div class="pie"><button class="sec" id="descargar">Descargar respuestas</button></div>
<script id="datos" type="application/json">__DATOS__</script>
<script>
(function () {
	var D = JSON.parse(document.getElementById('datos').textContent);
	var S = D.secuencia, IMG = D.imagenes;
	var CLAVE = 'corredor-humano-01-__HUELLA__';
	var resp = [];
	var pos = 0;
	try {
		var g = JSON.parse(localStorage.getItem(CLAVE) || 'null');
		if (g && Array.isArray(g.resp) && g.resp.length <= S.length) { resp = g.resp; pos = resp.length; }
	} catch (e) {}
	function guardar() { try { localStorage.setItem(CLAVE, JSON.stringify({resp: resp})); } catch (e) {} }
	function $(id) { return document.getElementById(id); }
	function mostrar() {
		var n = S.length;
		$('prog').style.width = (100 * resp.length / n) + '%';
		$('estado').textContent = 'Par ' + Math.min(pos + 1, n) + ' de ' + n + ' (respondidos: ' + resp.length + ')';
		var fin = pos >= n;
		$('juego').style.display = fin ? 'none' : '';
		$('fin').style.display = fin ? 'block' : 'none';
		if (fin) return;
		var p = S[pos];
		$('gi').src = IMG[p.izq].g; $('si').src = IMG[p.izq].s;
		$('gd').src = IMG[p.der].g; $('sd').src = IMG[p.der].s;
	}
	var ultimo = 0;
	function elegir(e) {
		if (pos >= S.length) return;
		var t = Date.now();
		if (t - ultimo < 250) return;
		ultimo = t;
		resp[pos] = e; resp.length = pos + 1;
		pos++;
		guardar(); mostrar();
	}
	function volver() {
		if (pos === 0) return;
		pos--; resp.length = pos; guardar(); mostrar();
	}
	$('bi').onclick = function () { elegir('izq'); };
	$('bd').onclick = function () { elegir('der'); };
	$('be').onclick = function () { elegir('empate'); };
	$('atras').onclick = volver;
	document.querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { b.blur(); }); });
	document.addEventListener('keydown', function (ev) {
		if (ev.repeat || ev.altKey || ev.ctrlKey || ev.metaKey) return;
		var e = null;
		if (ev.key === 'ArrowLeft') e = 'izq';
		else if (ev.key === 'ArrowRight') e = 'der';
		else if (ev.key === 'ArrowDown' || ev.key === ' ') e = 'empate';
		else if (ev.key !== 'Backspace') return;
		// sin esto, Espacio sobre un botón enfocado responde dos veces (tecla + clic)
		ev.preventDefault();
		if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
		if (e) elegir(e); else volver();
	});
	$('descargar').onclick = function () {
		var salida = [];
		for (var i = 0; i < resp.length; i++) {
			var p = S[i], e = resp[i];
			var el = e === 'empate' ? 'empate' : ((e === 'izq' ? p.izq : p.der) === p.a ? 'A' : 'B');
			salida.push({a: p.a, b: p.b, izq: p.izq, der: p.der, eleccion: el, repetido: p.repetido});
		}
		var blob = new Blob([JSON.stringify(salida, null, 2)], {type: 'application/json'});
		var a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = 'respuestas-humano.json';
		document.body.appendChild(a); a.click(); a.remove();
	};
	mostrar();
})();
</script>
</body>
</html>
`;

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
	if (!existsSync(join(SALIDA, 'clave.json'))) throw new Error('falta clave.json: correr anonimizar antes');
	console.log(generarPaginaHumano());
}
