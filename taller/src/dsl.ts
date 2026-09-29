// API para escribir un modelo como script sin coordenadas a mano.
//
//   const m = new Modelo('arbol');
//   const tronco = m.sub('tronco');                                   // un submodelo = un sub-armado
//   const base = tronco.poner('3005', 'Reddish_Brown');               // en el origen del submodelo
//   tronco.poner('3005', 'Reddish_Brown', {sobre: base, stud: [0, 0], giro: 90});  // anti-stud (0,0) sobre stud (0,0)
//   tronco.poner('3024', 'Green', {debajo: base, antistud: [0, 0]});  // stud (0,0) dentro del anti-stud (0,0)
//   tronco.poner('4274', 'Light_Bluish_Grey', {conector: {de: base, n: 7}, propio: 3});   // índices de `piezas ver`
//   tronco.poner('2417', 'Green', {en: grilla(0, 9, 1), rot: 'X90 Y45'});                  // libre
//   tronco.paso();
//   m.raiz.colocar(tronco);  m.raiz.paso();
//   m.guardar();                                                      // modelo.mpd + modelo.mapa.json
//
// Grilla: stud (i, j) con i en +X y j en +Z, desde la esquina de menor X y Z (`con` elige el anti-stud o
// stud propio, por defecto (0,0)). `giro`: 0/90/180/270 alrededor del eje del conector. Unidades: 1 stud =
// 20 LDU, 1 placa = 8, −Y es arriba. `rot`: giros por eje en grados, de izquierda a derecha.

import {writeFileSync} from 'node:fs';
import {basename, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Transform, Vec3} from '../../verificador/src/matematica.ts';
import {IDENTIDAD} from '../../verificador/src/matematica.ts';
import {esPieza} from '../../verificador/src/ldraw.ts';
import type {Color} from './colores.ts';
import {colorDe} from './colores.ts';
import {encastrar, limpiar, parsearRot} from './encastre.ts';
import {biblioteca} from './entorno.ts';
import {archivoDe, conectoresPieza, ficha, puntoGrilla} from './ficha.ts';

export const grilla = (x: number, capas: number, z: number): Vec3 => [20 * x, -8 * capas, 20 * z];

const ESTE_ARCHIVO = fileURLToPath(import.meta.url);

// "archivo.ts:línea" de quien llamó a la API (el script de diseño).
function llamador(): string {
	for (const l of (new Error().stack ?? '').split('\n').slice(1)) {
		const m = l.match(/\(?(?:file:\/\/\/?)?([^()\s]+?):(\d+):\d+\)?$/);
		if (!m) continue;
		const ruta = decodeURIComponent(m[1]);
		if (ruta.startsWith('node:') || resolve(ruta) === ESTE_ARCHIVO) continue;
		return `${basename(ruta)}:${m[2]}`;
	}
	return '?';
}

const sanear = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'sub';

export type Opciones = {
	nombre?: string;
	en?: Vec3;
	rot?: string;
	sobre?: PiezaColocada;
	stud?: [number, number];
	debajo?: PiezaColocada;
	antistud?: [number, number];
	con?: [number, number];
	giro?: number;
	conector?: {de: PiezaColocada; n: number};
	propio?: number;
};

// Sin parameter properties: erasableSyntaxOnly (y el type stripping de Node) no los admiten.
export class PiezaColocada {
	readonly archivo: string;
	readonly color: Color;
	readonly tr: Transform;
	readonly origen: string;
	readonly sub: Submodelo;
	readonly nombre?: string;
	constructor(archivo: string, color: Color, tr: Transform, origen: string, sub: Submodelo, nombre?: string) {
		this.archivo = archivo;
		this.color = color;
		this.tr = tr;
		this.origen = origen;
		this.sub = sub;
		this.nombre = nombre;
	}
}

type Item = {tipo: 'pieza'; p: PiezaColocada} | {tipo: 'sub'; sub: Submodelo; tr: Transform; origen: string};

const fmt = (n: number) => {
	const r = Number(n.toFixed(6));
	return Object.is(r, -0) ? '0' : String(r);
};
const lineaRef = (color: number, tr: Transform, archivo: string) => `1 ${color} ${[...tr.t, ...tr.r].map(fmt).join(' ')} ${archivo}`;

export class Submodelo {
	readonly nombre: string;
	readonly archivo: string;
	private pasos: Item[][] = [];
	private actual: Item[] = [];
	colocado = false;

	constructor(nombre: string) {
		this.nombre = nombre;
		this.archivo = `${nombre}.ldr`;
	}

	poner(id: string, color: string | number, op: Opciones = {}): PiezaColocada {
		const origen = llamador();
		try {
			const bib = biblioteca();
			const archivo = archivoDe(id);
			const a = bib.archivo(archivo);
			if (!a || !esPieza(a)) throw new Error(`pieza inexistente: ${id}`);
			const p = new PiezaColocada(archivo, colorDe(bib, color), this.ubicar(archivo, op), origen, this, op.nombre);
			this.actual.push({tipo: 'pieza', p});
			return p;
		} catch (e) {
			throw new Error(`${origen}: ${(e as Error).message}`);
		}
	}

	private ubicar(archivo: string, op: Opciones): Transform {
		const bib = biblioteca();
		const formas = [op.en, op.sobre, op.debajo, op.conector].filter((x) => x !== undefined).length;
		if (formas > 1) throw new Error('usá una sola forma de ubicar: en, sobre, debajo o conector');
		if (op.sobre && !op.stud) throw new Error('con "sobre" hay que indicar stud: [i, j]');
		if (op.debajo && !op.antistud) throw new Error('con "debajo" hay que indicar antistud: [i, j]');
		if (op.conector && op.propio === undefined) throw new Error('con "conector" hay que indicar propio: <n>');
		if (op.stud && !op.sobre) throw new Error('stud sin "sobre"');
		if (op.antistud && !op.debajo) throw new Error('antistud sin "debajo"');
		if (op.propio !== undefined && !op.conector) throw new Error('propio sin "conector"');
		if (op.con && !op.sobre && !op.debajo) throw new Error('con sin "sobre" ni "debajo"');
		if (op.rot !== undefined && !op.en) throw new Error('rot sin "en"');
		if (op.giro !== undefined && !op.sobre && !op.debajo && !op.conector) throw new Error('giro sin "sobre", "debajo" ni "conector"');
		if (op.giro !== undefined && (op.sobre || op.debajo) && ![0, 90, 180, 270].includes(op.giro)) throw new Error('giro debe ser 0, 90, 180 o 270');
		const mismoSub = (p: PiezaColocada) => {
			if (p.sub !== this) throw new Error(`la pieza base está en otro submodelo (${p.sub.nombre}); encastrá dentro del mismo sub-armado`);
		};
		if (op.sobre && op.stud) {
			mismoSub(op.sobre);
			const base = puntoGrilla(ficha(bib, op.sobre.archivo).studs, op.stud, 'stud');
			const propio = puntoGrilla(ficha(bib, archivo).antistuds, op.con ?? [0, 0], 'anti-stud');
			return encastrar(op.sobre.tr, conectoresPieza(bib, op.sobre.archivo)[base.n], conectoresPieza(bib, archivo)[propio.n], op.giro ?? 0);
		}
		if (op.debajo && op.antistud) {
			mismoSub(op.debajo);
			const base = puntoGrilla(ficha(bib, op.debajo.archivo).antistuds, op.antistud, 'anti-stud');
			const propio = puntoGrilla(ficha(bib, archivo).studs, op.con ?? [0, 0], 'stud');
			return encastrar(op.debajo.tr, conectoresPieza(bib, op.debajo.archivo)[base.n], conectoresPieza(bib, archivo)[propio.n], op.giro ?? 0);
		}
		if (op.conector && op.propio !== undefined) {
			mismoSub(op.conector.de);
			const cb = conectoresPieza(bib, op.conector.de.archivo)[op.conector.n];
			const cn = conectoresPieza(bib, archivo)[op.propio];
			if (!cb) throw new Error(`conector ${op.conector.n} inexistente en ${op.conector.de.archivo}`);
			if (!cn) throw new Error(`conector ${op.propio} inexistente en ${archivo}`);
			return encastrar(op.conector.de.tr, cb, cn, op.giro ?? 0);
		}
		if (op.en) return limpiar({r: parsearRot(op.rot ?? ''), t: op.en});
		return IDENTIDAD;
	}

	contiene(otro: Submodelo): boolean {
		return [...this.pasos, this.actual].some((paso) => paso.some((it) => it.tipo === 'sub' && (it.sub === otro || it.sub.contiene(otro))));
	}

	colocar(sub: Submodelo, op: {en?: Vec3; rot?: string} = {}): void {
		const origen = llamador();
		if (sub === this || sub.contiene(this)) throw new Error(`${origen}: ciclo: ${sub.nombre} no puede ir dentro de ${this.nombre}`);
		let tr: Transform;
		try {
			tr = limpiar({r: parsearRot(op.rot ?? ''), t: op.en ?? [0, 0, 0]});
		} catch (e) {
			throw new Error(`${origen}: ${(e as Error).message}`);
		}
		sub.colocado = true;
		this.actual.push({tipo: 'sub', sub, tr, origen});
	}

	paso(): void {
		if (this.actual.length > 0) this.pasos.push(this.actual);
		this.actual = [];
	}

	// Líneas del bloque (sin "0 FILE") y mapa línea → origen, con la numeración de pasosDe (1 = primera).
	lineas(): {lineas: string[]; mapa: [number, string][]} {
		const lineas = [`0 ${this.nombre}`, `0 Name: ${this.archivo}`, '0 Author: taller'];
		const mapa: [number, string][] = [];
		const pasos = this.actual.length > 0 ? [...this.pasos, this.actual] : this.pasos;
		for (const paso of pasos) {
			for (const it of paso) {
				if (it.tipo === 'pieza') {
					lineas.push(lineaRef(it.p.color.codigo, it.p.tr, it.p.archivo));
					mapa.push([lineas.length, it.p.nombre ? `${it.p.origen} (${it.p.nombre})` : it.p.origen]);
				} else {
					lineas.push(lineaRef(16, it.tr, it.sub.archivo));
					mapa.push([lineas.length, `${it.origen} (${it.sub.nombre})`]);
				}
			}
			lineas.push('0 STEP');
		}
		return {lineas, mapa};
	}
}

export class Modelo {
	readonly nombre: string;
	readonly raiz: Submodelo;
	private subs = new Map<string, Submodelo>();

	constructor(nombre: string) {
		this.nombre = sanear(nombre);
		this.raiz = new Submodelo(this.nombre);
	}

	sub(nombre: string): Submodelo {
		const n = sanear(nombre);
		if (this.subs.has(n) || n === this.nombre) throw new Error(`${llamador()}: el submodelo "${n}" ya existe`);
		const s = new Submodelo(n);
		this.subs.set(n, s);
		return s;
	}

	texto(): {mpd: string; mapa: Record<string, string>} {
		const out: string[] = [];
		const mapa: Record<string, string> = {};
		for (const s of [this.raiz, ...this.subs.values()]) {
			if (s !== this.raiz && !s.colocado) console.error(`aviso: el submodelo "${s.nombre}" no se colocó en ningún lado`);
			const {lineas, mapa: m} = s.lineas();
			out.push(`0 FILE ${s.archivo}`, ...lineas, '0 NOFILE');
			for (const [n, origen] of m) mapa[`${s.archivo}:${n}`] = origen;
		}
		return {mpd: out.join('\n') + '\n', mapa};
	}

	guardar(ruta?: string): string {
		const destino = process.env.TALLER_SALIDA ?? ruta ?? 'modelo.mpd';
		const {mpd, mapa} = this.texto();
		writeFileSync(destino, mpd);
		writeFileSync(destino.replace(/\.mpd$/i, '') + '.mapa.json', JSON.stringify(mapa, null, 1));
		return destino;
	}
}
