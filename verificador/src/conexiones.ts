// Detecta qué pares de piezas están conectados, comparando sus conectores en coordenadas del ensamble.

import type {Conector, Seccion} from './conectores.ts';
import type {Vec3} from './matematica.ts';
import {cruz, escalar, largo, punto, restar} from './matematica.ts';

export type ConectorUbicado = {pieza: number; c: Conector};

// Eje de un encastre a lo largo del cual se desliza para entrar: la hembra se extiende desde su
// abertura en la dirección `eje`, así que el macho entra moviéndose en +eje (relativo a la hembra).
// `ambos`: agujero pasante, se puede entrar por los dos lados.
// `profundidad`: cuánto se meten una en otra (LDU); es lo que hay que recorrer para desencastrar.
export type EjeEncastre = {eje: Vec3; hembra: number; ambos: boolean; profundidad: number};

export type Conexion = {a: number; b: number; tipo: string; ejes: EjeEncastre[]};

type Encastre = {tipo: string; eje?: Vec3; hembraEsX?: boolean; ambos?: boolean; profundidad?: number};

const TOL_EJE = 0.05; // |sen| del ángulo entre ejes (~3°)
// Distancia entre ejes (LDU). Holgada porque algunos modelos ubican piezas (brazos de minifigura)
// con matrices aproximadas; los studs están a 20 LDU entre sí, así que no genera falsos positivos.
const TOL_LINEA = 1.2;
const TOL_RADIO = 0.6;
const SOLAPE_MIN = 1; // LDU
const PARCIAL = [1, -1, 2, -2, 3, -3]; // LDU que se prueba correr el macho si no encastra justo
const PARCIAL_MAX = 3;

// Sección del cilindro a distancia `s` de su base, o null si s cae fuera.
function seccionEn(secs: Seccion[], s: number): Seccion | null {
	let acum = 0;
	const total = secs.reduce((a, x) => a + x.largo, 0);
	if (s >= total - 1e-6 && s <= total + 1e-6 && secs.length > 0) return secs[secs.length - 1];
	for (const x of secs) {
		// Intervalo semiabierto: un punto justo en el borde pertenece a la sección siguiente.
		if (s >= acum - 1e-6 && s < acum + x.largo - 1e-6) return x;
		acum += x.largo;
	}
	return null;
}

const esFlexible = (f: string) => f === '_L' || f === 'L_';

// Resultado de comparar una sección macho con una hembra en un punto del eje.
function ajuste(m: Seccion, f: Seccion): 'justo' | 'flojo' | 'choca' {
	if (esFlexible(m.forma) || esFlexible(f.forma)) return 'flojo';
	if (m.r > f.r + TOL_RADIO) return 'choca';
	if (Math.abs(m.r - f.r) > TOL_RADIO) return 'flojo';
	// Radios iguales: el eje entra en agujero de eje o redondo; lo redondo no entra en agujero de eje.
	if (f.forma === 'A' && m.forma !== 'A') return 'choca';
	return 'justo';
}

type Tramo = {t0: number; t1: number};

// Proyección de dos segmentos colineales sobre el eje de `a`. Null si no son colineales.
function solape(aBase: Vec3, aEje: Vec3, aLargo: number, bBase: Vec3, bEje: Vec3, bLargo: number): Tramo | null {
	if (largo(cruz(aEje, bEje)) > TOL_EJE) return null;
	const d = restar(bBase, aBase);
	const perp = restar(d, [aEje[0] * punto(d, aEje), aEje[1] * punto(d, aEje), aEje[2] * punto(d, aEje)]);
	if (largo(perp) > TOL_LINEA) return null;
	const b0 = punto(d, aEje);
	const b1 = b0 + punto(bEje, aEje) * bLargo;
	const t0 = Math.max(0, Math.min(b0, b1));
	const t1 = Math.min(aLargo, Math.max(b0, b1));
	return t1 - t0 >= SOLAPE_MIN ? {t0, t1} : null;
}

function conectan(x: Conector, y: Conector): Encastre | null {
	if (x.tipo === 'cil' && y.tipo === 'cil') {
		if (x.genero === y.genero) return null;
		if (x.grupo !== y.grupo) return null;
		const [m, f] = x.genero === 'M' ? [x, y] : [y, x];
		// Con la misma tolerancia del encastre parcial: un macho que queda hasta 3 LDU antes de la hembra
		// (un pin que llega justo al borde del agujero) se evalúa como si pudiera empujarse.
		const margen = PARCIAL_MAX;
		const tramo =
			solape(m.base, m.eje, m.largo, f.base, f.eje, f.largo) ??
			solape(restar(m.base, escalar(m.eje, margen)), m.eje, m.largo + 2 * margen, f.base, f.eje, f.largo);
		if (!tramo) return null;
		// Muestreo a lo largo del macho: tiene que haber un ajuste justo y ningún choque.
		const dirF = punto(m.eje, f.eje) >= 0 ? 1 : -1;
		const d0 = punto(restar(m.base, f.base), f.eje);
		// Evalúa el encastre con el macho corrido `delta` LDU a lo largo del eje de la hembra.
		const evaluar = (delta: number): 'justo' | 'flojo' | 'choca' => {
			let justo = false;
			const n = 12;
			for (let k = 0; k <= n; k++) {
				// Desfasado de los bordes enteros, donde suelen cambiar las secciones.
				const t = (m.largo * (k + 0.37)) / (n + 1);
				const sm = seccionEn(m.secs, t);
				const sf = seccionEn(f.secs, d0 + delta + dirF * t);
				if (!sm || !sf) continue;
				const a = ajuste(sm, sf);
				if (a === 'choca') return 'choca';
				if (a === 'justo') justo = true;
			}
			return justo ? 'justo' : 'flojo';
		};
		// Un macho con base (caps=one: un stud nace en la superficie de su pieza) no puede tener la base
		// metida dentro de la hembra más que la tolerancia del encastre parcial: si la tiene, el cuerpo de
		// su pieza también está adentro, y lo que hay son dos piezas encimadas, no encastradas (un anti-stud
		// de ladrillo mide 20 LDU de alto, pero un stud solo entra 4).
		if (m.caps === 'one') {
			const baseEnHembra = dirF > 0 ? d0 : f.largo - d0; // profundidad de la base desde la abertura
			if (baseEnHembra > PARCIAL_MAX) return null;
		}
		const actual = evaluar(0);
		if (actual === 'choca') return null;
		// Encastre parcial: algunos modelos dejan la pieza 1-3 LDU afuera (un stud que solo llega al
		// avellanado de un agujero Technic). Si empujándola un poco queda justa, cuenta como conectada.
		if (actual !== 'justo' && !PARCIAL.some((d) => evaluar(d) === 'justo')) return null;
		// La abertura de la hembra está en su base, salvo con caps=A (la base es el extremo cerrado): el
		// macho entra moviéndose en +eje y sale en -eje.
		let eje = f.caps === 'A' ? escalar(f.eje, -1) : f.eje;
		let ambos = false;
		// Hembra abierta en los dos extremos (agujero pasante): el macho puede salir por cualquiera de los
		// dos, siempre que su perfil pase por el agujero. Un pin con collar no atraviesa el agujero: el
		// collar choca con la parte angosta. Se corre el macho paso a paso hasta que sale del todo.
		// Si ninguna sección del macho choca con ninguna de la hembra (un stud, un pin sin collar), pasa
		// en cualquier posición: no hace falta recorrerlo.
		const puedeChocar = m.secs.some((sm) => f.secs.some((sf) => ajuste(sm, sf) === 'choca'));
		if ((f.caps === 'none' || f.caps === 'two') && !puedeChocar) ambos = true;
		else if (f.caps === 'none' || f.caps === 'two') {
			const pasa = (signo: number) => {
				for (let s = 1; s <= f.largo + m.largo; s++) if (evaluar(signo * s) === 'choca') return false;
				return true;
			};
			const haciaBase = pasa(-1); // sale por la base de la hembra (en -f.eje)
			const haciaFin = pasa(1); // sale por el otro extremo (en +f.eje)
			ambos = haciaBase && haciaFin;
			// Si solo sale por el otro extremo, entró por ahí: se mueve en -f.eje para entrar.
			if (!haciaBase && haciaFin) eje = escalar(f.eje, -1);
		}
		return {
			tipo: `${m.secs.map((s) => s.forma + s.r).join('+')}→${f.secs.map((s) => s.forma + s.r).join('+')}`,
			eje,
			hembraEsX: f === x,
			profundidad: tramo.t1 - tramo.t0,
			ambos,
		};
	}
	if ((x.tipo === 'clip' && y.tipo === 'cil') || (y.tipo === 'clip' && x.tipo === 'cil')) {
		const [clip, cil] = x.tipo === 'clip' ? [x, y as Conector & {tipo: 'cil'}] : [y as Conector & {tipo: 'clip'}, x];
		if (cil.genero !== 'M') return null;
		const tramo = solape(cil.base, cil.eje, cil.largo, clip.base, clip.eje, clip.largo);
		if (!tramo) return null;
		const s = seccionEn(cil.secs, (tramo.t0 + tramo.t1) / 2);
		return s && Math.abs(s.r - clip.radio) <= TOL_RADIO ? {tipo: 'clip'} : null;
	}
	if (x.tipo === 'dedo' && y.tipo === 'dedo') {
		if (x.grupo !== y.grupo || Math.abs(x.radio - y.radio) > TOL_RADIO) return null;
		return solape(x.base, x.eje, x.largo, y.base, y.eje, y.largo) ? {tipo: 'bisagra'} : null;
	}
	if (x.tipo === 'gen' && y.tipo === 'gen') {
		if (x.grupo !== y.grupo || x.genero === y.genero) return null;
		// La zona de encastre la declara en general solo uno de los dos (el otro es un punto).
		const alcance = Math.max(TOL_LINEA, x.alcance, y.alcance);
		return largo(restar(x.base, y.base)) <= alcance && largo(cruz(x.eje, y.eje)) <= TOL_EJE ? {tipo: `gen:${x.grupo}`} : null;
	}
	return null;
}

// Todas las conexiones entre piezas distintas. Usa una grilla espacial sobre los extremos de cada conector.
export function conexiones(conectores: ConectorUbicado[]): Conexion[] {
	const CELDA = 40;
	const celdas = new Map<string, number[]>();
	const clave = (x: number, y: number, z: number) => `${x},${y},${z}`;
	const rango = (c: Conector) => {
		const fin = [c.base[0] + c.eje[0] * c.largo, c.base[1] + c.eje[1] * c.largo, c.base[2] + c.eje[2] * c.largo];
		return [0, 1, 2].map((i) => [
			Math.floor((Math.min(c.base[i], fin[i]) - 1) / CELDA),
			Math.floor((Math.max(c.base[i], fin[i]) + 1) / CELDA),
		]);
	};
	conectores.forEach((u, i) => {
		const [rx, ry, rz] = rango(u.c);
		for (let x = rx[0]; x <= rx[1]; x++)
			for (let y = ry[0]; y <= ry[1]; y++)
				for (let z = rz[0]; z <= rz[1]; z++) {
					const k = clave(x, y, z);
					let l = celdas.get(k);
					if (!l) celdas.set(k, (l = []));
					l.push(i);
				}
	});

	const vistos = new Set<string>();
	const pares = new Map<string, Conexion>();
	for (const lista of celdas.values()) {
		for (let i = 0; i < lista.length; i++)
			for (let j = i + 1; j < lista.length; j++) {
				const a = conectores[lista[i]];
				const b = conectores[lista[j]];
				if (a.pieza === b.pieza) continue;
				const kc = lista[i] < lista[j] ? `${lista[i]}:${lista[j]}` : `${lista[j]}:${lista[i]}`;
				if (vistos.has(kc)) continue;
				vistos.add(kc);
				const enc = conectan(a.c, b.c);
				if (!enc) continue;
				const [p, q] = a.pieza < b.pieza ? [a.pieza, b.pieza] : [b.pieza, a.pieza];
				let con = pares.get(`${p}:${q}`);
				if (!con) pares.set(`${p}:${q}`, (con = {a: p, b: q, tipo: enc.tipo, ejes: []}));
				if (enc.eje) agregarEje(con.ejes, {eje: enc.eje, hembra: enc.hembraEsX ? a.pieza : b.pieza, ambos: !!enc.ambos, profundidad: enc.profundidad ?? 0});
			}
	}
	return [...pares.values()];
}

// Agrega un eje de encastre si no hay ya uno equivalente (misma dirección y misma hembra).
export function agregarEje(ejes: EjeEncastre[], e: EjeEncastre) {
	const igual = ejes.find((x) => x.hembra === e.hembra && Math.abs(punto(x.eje, e.eje)) > 0.99);
	if (!igual) return void ejes.push(e);
	if (punto(igual.eje, e.eje) < 0 || e.ambos) igual.ambos = true;
	igual.profundidad = Math.max(igual.profundidad, e.profundidad);
}
