// Verificador de modelos LDraw: ¿se puede armar con piezas reales, paso a paso, sin que nada flote,
// se caiga al girar el modelo o se atraviese?
//
// Modelo de armado: cada submodelo es un sub-armado que se construye aparte (en su propio sistema
// de coordenadas) y se coloca entero en el paso del modelo padre que lo referencia.

import type {Archivo, Biblioteca, Referencia} from './ldraw.ts';
import {esFlexible, esOficial, esPieza, pasosDe} from './ldraw.ts';
import type {Conector} from './conectores.ts';
import {conectoresDe, transformarConector} from './conectores.ts';
import type {Conexion, ConectorUbicado} from './conexiones.ts';
import {conexiones} from './conexiones.ts';
import type {Caja, Transform, Vec3} from './matematica.ts';
import {aplicar, cajaVacia, cajasSeTocan, componer, escalar, expandirCaja, invertirRigida, punto, sumar} from './matematica.ts';
import type {Malla, Tris} from './geometria.ts';
import {cajaEnMundo, mallaDe, trisEnMundo} from './geometria.ts';
import {paresCandidatos, penetracionPiezas, superposicion} from './colisiones.ts';
import {apoyo} from './estabilidad.ts';
import {alcanceRecorrido, recorrer} from './insercion.ts';

export type Severidad = 'error' | 'aviso';

export type Hallazgo = {
	severidad: Severidad;
	regla: string;
	mensaje: string;
	submodelo?: string;
	paso?: number; // 1-based dentro del submodelo
	piezas?: string[];
};

type PiezaUbicada = {
	archivo: string;
	color: number;
	tr: Transform;
	origen: string; // "submodelo:línea" para ubicarla en el archivo
	flexible?: string; // instancia del elemento flexible al que pertenece (todas sus piezas son una)
};

type Unidad = {paso: number; piezas: number[]; submodelo: string | null};

export type Opciones = {
	combinacionesConocidas?: Set<string>; // "pieza|color" vistos en inventarios de Rebrickable
};

const MASA_3001 = 2.32; // gramos, ladrillo 2×4: calibra la masa estimada por superficie
const TOL_MESA = 1; // LDU: tolerancia para considerar que algo apoya en la mesa
// Penetraciones menores que esto (1 mm) se consideran imprecisión del modelado, no un choque: los
// modelos del OMR ubican sub-armados rotados con errores de hasta ~2 LDU. En un diseño en grilla
// exacta, un choque real es de 4 LDU o más (media placa).
const ROCE_MAX = 2.5; // LDU
// Un conector macho se infiere encastrado si su punta cae dentro del volumen de otra pieza agrandado en
// esta cantidad: cubre piezas redondas 1×1 puestas en diagonal entre cuatro studs. Un stud común junto a
// una pared queda a 4 LDU o más, así que no se une por esto.
const HOLGURA_INFERENCIA = 3;
// Hasta cuántas piezas puede tener un grupo suelto para considerarlo carga (apoyado o guardado).
const CARGA_MAX = 3;
// Cuántas piezas con triángulos en el mundo se guardan a la vez por sub-armado.
const LRU_TRIS = 400;
// Penetración (LDU) que se tolera entre dos piezas unidas por una conexión inferida: un stud y algo más.
const INFERIDA_MAX = 5;
// Neumáticos y bandas de goma: se estiran para calzarlos, así que no se chequea su camino de inserción.
const GOMA = /\b(tyre|tire|rubber|band)\b/i;
// Engranajes, orugas y cadenas encastran diente contra eslabón: su geometría se solapa a propósito.
const MECANICA = /\b(gear|tread|chain)\b/i;
// Inclinación con la que queda apoyado un objeto terminado: hasta 5° está derecho; más de 25° se vuelca.
// Distancia máxima (LDU) entre un objeto suelto y lo que tiene debajo para considerarlo apoyado.
const HUECO_MAX = 4;
// Diferencia de altura (LDU) hasta la que un objeto aparte, sin nada debajo, se considera apoyado en la
// mesa pero mal nivelado en el archivo (medio ladrillo). Más que eso, flota.
const NIVEL_MAX = 12;
const INCLINACION_OK = 5;
const INCLINACION_MAX = 25;

export type Reporte = {
	modelo: string;
	piezas: number;
	pasos: number;
	submodelos: number;
	conexiones: number;
	piezasSinConectores: string[];
	masaEstimadaG: number;
	hallazgos: Hallazgo[];
	// Dirección libre de entrada de cada pieza o sub-armado nuevo (la primera que funcionó), en el sistema
	// de coordenadas de su sub-armado. La usa el manual para dibujar flechas.
	inserciones: Insercion[];
};

export type Insercion = {submodelo: string; paso: number; piezas: string[]; dir: Vec3};

export function verificar(bib: Biblioteca, principal: string, opciones: Opciones = {}): Reporte {
	const hallazgos: Hallazgo[] = [];
	const inserciones: Insercion[] = [];
	const agregar = (h: Hallazgo) => hallazgos.push(h);

	// --- Aplanado: todas las piezas de un archivo, en su sistema de coordenadas ---
	const aplanados = new Map<string, PiezaUbicada[]>();
	function aplanar(nombre: string, pila: string[] = []): PiezaUbicada[] {
		const guardado = aplanados.get(nombre);
		if (guardado) return guardado;
		const archivo = bib.archivo(nombre)!;
		const out: PiezaUbicada[] = [];
		for (const paso of pasosDe(archivo))
			for (const ref of paso.refs) out.push(...ubicar(nombre, ref, pila));
		aplanados.set(nombre, out);
		return out;
	}
	const lsynth = new Map<string, boolean>();
	const esLSynth = (nombre: string, a: Archivo) => {
		let s = lsynth.get(nombre);
		if (s === undefined) lsynth.set(nombre, (s = a.lineas.some((l) => l.startsWith('0 !KEYWORDS') && /\bLSynth\b/i.test(l))));
		return s;
	};
	function ubicar(padre: string, ref: Referencia, pila: string[]): PiezaUbicada[] {
		const a = bib.archivo(ref.archivo);
		if (!a) return [{archivo: ref.archivo, color: ref.color, tr: ref.transform, origen: `${padre}:${ref.linea}`}];
		// Segmentos de una manguera o banda generada por LSynth: se superponen a propósito y son un solo
		// elemento flexible (se agrupan por submodelo).
		if (esPieza(a)) return [{archivo: ref.archivo, color: ref.color, tr: ref.transform, origen: `${padre}:${ref.linea}`, flexible: esLSynth(ref.archivo, a) ? `lsynth:${padre}` : undefined}];
		if (pila.includes(ref.archivo)) return [];
		const instancia = `${padre}:${ref.linea}`;
		const flexible = esFlexible(a);
		return aplanar(ref.archivo, [...pila, padre]).map((p) => ({
			...p,
			color: p.color === 16 ? ref.color : p.color,
			tr: componer(ref.transform, p.tr),
			flexible: flexible ? instancia : p.flexible ? `${instancia}>${p.flexible}` : undefined,
		}));
	}

	const todas = aplanar(principal);

	// --- Regla 1: piezas reales y colores existentes ---
	const piezasSinConectores = new Set<string>();
	const vistas = new Set<string>();
	for (const p of todas) {
		const clave = `${p.archivo}|${p.color}`;
		if (vistas.has(clave)) continue;
		vistas.add(clave);
		const a = bib.archivo(p.archivo);
		if (!a) {
			agregar({severidad: 'error', regla: 'pieza-inexistente', mensaje: `No existe en la biblioteca LDraw: ${p.archivo}`, piezas: [p.origen]});
			continue;
		}
		if (!esOficial(a))
			agregar({severidad: 'aviso', regla: 'pieza-no-oficial', mensaje: `Pieza no oficial o embebida: ${p.archivo} (${a.titulo})`, piezas: [p.origen]});
		if (a.titulo.startsWith('~Moved to') || a.tipo.includes('Alias'))
			agregar({severidad: 'aviso', regla: 'pieza-renombrada', mensaje: `${p.archivo} es un alias o fue renombrada: "${a.titulo}"`, piezas: [p.origen]});
		if (!bib.colores.has(p.color))
			agregar({severidad: 'error', regla: 'color-inexistente', mensaje: `Color ${p.color} no definido en LDConfig (${p.archivo})`, piezas: [p.origen]});
		else if (opciones.combinacionesConocidas && !opciones.combinacionesConocidas.has(`${p.archivo.replace(/\.dat$/, '')}|${p.color}`))
			agregar({severidad: 'aviso', regla: 'combinacion-no-vista', mensaje: `${p.archivo} en ${bib.colores.get(p.color)!.nombre} no aparece en ningún inventario de Rebrickable`, piezas: [p.origen]});
		if (conectoresDe(bib, p.archivo).length === 0) piezasSinConectores.add(p.archivo);
	}

	// --- Geometría por pieza (cacheada por instancia) ---
	const mallas = new Map<string, Malla>();
	const malla = (archivo: string) => {
		let m = mallas.get(archivo);
		if (!m) mallas.set(archivo, (m = mallaDe(bib, archivo)));
		return m;
	};

	// --- Regla 2: colisiones en el modelo completo ---
	const cajas: Caja[] = todas.map((p) => cajaEnMundo(malla(p.archivo), p.tr));
	// Los pares salen de un barrido en X: las piezas vecinas se repiten seguido y un caché acotado alcanza.
	const tris = cacheAcotado((i) => trisEnMundo(malla(todas[i].archivo), todas[i].tr), LRU_TRIS);
	// Dos piezas conectadas se encastran: su geometría se solapa a propósito (ejes, pines, clips).
	const aristasTodas = aristasDe(todas);
	// Solo las conexiones declaradas eximen: una inferida o supuesta puede venir justamente de dos piezas
	// encimadas por error.
	const conectadas = new Set(aristasTodas.filter((e) => e.tipo !== 'inferida' && e.tipo !== 'supuesta').map((e) => `${e.a}:${e.b}`));
	const tipoPar = new Map(aristasTodas.map((e) => [`${e.a}:${e.b}`, e.tipo]));
	for (const [i, j] of paresCandidatos(cajas)) {
		// Lo flexible se deforma y pasa entre otras piezas: no se chequea.
		if (todas[i].flexible || todas[j].flexible) continue;
		const mecanica = [i, j].some((x) => MECANICA.test(tituloReal(bib, todas[x].archivo)));
		// Piezas que comparten volumen en la misma capa (duplicadas, encimadas): sus caras coinciden en vez
		// de cruzarse, así que la prueba de penetración no las ve. Vale también para piezas conectadas:
		// compartir volumen contradice cualquier encastre. Los engranajes quedan afuera (dientes intercalados).
		if (!mecanica) {
			const s = superposicion(tris(i), malla(todas[i].archivo).orientados, cajas[i], tris(j), malla(todas[j].archivo).orientados, cajas[j]);
			if (s.ancho >= ROCE_MAX) {
				agregar({
					severidad: 'error',
					regla: 'superpuestas',
					mensaje: `${todas[i].archivo} y ${todas[j].archivo} ocupan el mismo lugar: comparten ~${s.area.toFixed(0)} LDU² de caras en el mismo plano (ancho ~${s.ancho.toFixed(1)} LDU)`,
					piezas: [todas[i].origen, todas[j].origen],
				});
				continue;
			}
		}
		if (conectadas.has(`${i}:${j}`)) continue;
		const prof = penetracionPiezas(tris(i), cajas[i], tris(j), cajas[j]);
		if (prof === 0) continue;
		// Un encastre inferido (stud en un hueco no declarado) se solapa hasta la altura de un stud; más que
		// eso ya son piezas encimadas.
		if (tipoPar.get(`${i}:${j}`) === 'inferida' && prof <= INFERIDA_MAX) continue;
		const choque = prof >= ROCE_MAX && !mecanica;
		agregar({
			severidad: choque ? 'error' : 'aviso',
			regla: choque ? 'colision' : mecanica ? 'engranaje' : 'roce',
			mensaje: `${todas[i].archivo} y ${todas[j].archivo} se atraviesan ~${prof.toFixed(1)} LDU${tipoPar.has(`${i}:${j}`) ? ` (conexión ${tipoPar.get(`${i}:${j}`)})` : ''}`,
			piezas: [todas[i].origen, todas[j].origen],
		});
	}

	// --- Regla 3: armado paso a paso de cada sub-armado ---
	const verificados = new Map<string, boolean>(); // submodelo → queda en una sola pieza
	let totalConexiones = 0;
	function verificarEnsamble(nombre: string, pila: string[] = []) {
		if (verificados.has(nombre) || pila.includes(nombre)) return;
		const archivo = bib.archivo(nombre)!;
		if (esFlexible(archivo)) {
			verificados.set(nombre, true);
			return;
		}
		const pasos = pasosDe(archivo);
		// Primero los sub-armados que usa.
		for (const paso of pasos)
			for (const ref of paso.refs) {
				const a = bib.archivo(ref.archivo);
				if (a && !esPieza(a)) verificarEnsamble(ref.archivo, [...pila, nombre]);
			}

		const piezas: PiezaUbicada[] = [];
		const unidades: Unidad[] = [];
		pasos.forEach((paso, k) =>
			paso.refs.forEach((ref) => {
				const nuevas = ubicar(nombre, ref, []);
				const a = bib.archivo(ref.archivo);
				const inicio = piezas.length;
				piezas.push(...nuevas);
				unidades.push({paso: k, piezas: nuevas.map((_, i) => inicio + i), submodelo: a && !esPieza(a) ? ref.archivo : null});
			}),
		);

		const aristas = pila.length === 0 ? aristasTodas : aristasDe(piezas);
		totalConexiones = Math.max(totalConexiones, aristas.length);

		// Punto más bajo de cada pieza según la orientación de cada paso.
		// Triángulos en el mundo, con caché acotado (LRU): guardarlos todos en un modelo grande ocupa cientos
		// de MB, y en cada momento se usan los de unas pocas piezas vecinas.
		const trisDe = cacheAcotado((i) => trisEnMundo(malla(piezas[i].archivo), piezas[i].tr), LRU_TRIS);
		// Se consulta en cada paso para cada pieza colocada: se guarda por pieza y dirección.
		const bajos = new Map<string, number>();
		const masBajo = (i: number, abajo: Vec3) => {
			const k = `${i}|${abajo.join(',')}`;
			const guardado = bajos.get(k);
			if (guardado !== undefined) return guardado;
			const t = trisDe(i);
			let m = -Infinity;
			for (let o = 0; o < t.length; o += 3) {
				const v = t[o] * abajo[0] + t[o + 1] * abajo[1] + t[o + 2] * abajo[2];
				if (v > m) m = v;
			}
			bajos.set(k, m);
			return m;
		};
		const cajasP = piezas.map((p) => cajaEnMundo(malla(p.archivo), p.tr));
		// Distancia (LDU, según `abajo`) entre el punto más bajo `piso` del grupo y la cara de arriba de lo
		// más alto que tiene debajo, entre `otras`. Infinito si no hay nada debajo o si `abajo` no es un eje
		// (un ROTSTEP en ángulo: ahí no se mide).
		const huecoDebajo = (abajo: Vec3, piso: number, grupo: number[], otras: number[]) => {
			const a = [0, 1, 2].reduce((m, i) => (Math.abs(abajo[i]) > Math.abs(abajo[m]) ? i : m), 0);
			if (Math.abs(abajo[a]) < 0.99) return Infinity;
			const s = Math.sign(abajo[a]);
			const [b, c] = [0, 1, 2].filter((i) => i !== a);
			const arriba = (x: Caja) => (s > 0 ? x.min[a] : -x.max[a]); // cara de arriba, medida según `abajo`
			const fondo = (x: Caja) => (s > 0 ? x.max[a] : -x.min[a]); // cara de abajo
			const inferiores = grupo.filter((q) => fondo(cajasP[q]) >= piso - TOL_MESA);
			let hueco = Infinity;
			for (const p of otras) {
				const cp = cajasP[p];
				if (arriba(cp) < piso - TOL_MESA) continue; // no está debajo (o el grupo está metido en su caja)
				const tapa = inferiores.some((q) => {
					const cq = cajasP[q];
					return cq.min[b] < cp.max[b] && cp.min[b] < cq.max[b] && cq.min[c] < cp.max[c] && cp.min[c] < cq.max[c];
				});
				if (tapa) hueco = Math.min(hueco, Math.max(0, arriba(cp) - piso));
			}
			return hueco;
		};

		// Componentes conexas entre las piezas colocadas hasta el paso k; cada sub-armado ya verificado
		// cuenta como una pieza rígida. Las piezas se agregan en orden de paso: las colocadas hasta k
		// son un prefijo de la lista.
		const colocadasHasta = (k: number) => unidades.filter((u) => u.paso <= k).flatMap((u) => u.piezas);
		const componentes = (k: number) => {
			const n = colocadasHasta(k).length;
			const uf = new UnionFind(piezas.length);
			for (const e of aristas) if (e.b < n && e.a < n) uf.unir(e.a, e.b);
			for (const u of unidades)
				if (u.paso <= k && u.submodelo && verificados.get(u.submodelo)) u.piezas.forEach((p) => uf.unir(p, u.piezas[0]));
			return uf;
		};

		let abajoAnterior: Vec3 | null = null;
		let islasAnteriores = 0;
		for (let k = 0; k < pasos.length; k++) {
			const abajo = direccionAbajo(pasos[k].rotacion);
			const colocadas = colocadasHasta(k);
			const enPaso = new Set(unidades.filter((u) => u.paso === k).flatMap((u) => u.piezas));
			if (colocadas.length === 0) continue;
			const uf = componentes(k);
			const grupos = new Map<number, number[]>();
			for (const p of colocadas) {
				const r = uf.raiz(p);
				let g = grupos.get(r);
				if (!g) grupos.set(r, (g = []));
				g.push(p);
			}

			// Giro del modelo (ROTSTEP que cambia qué es "abajo"): si había islas sueltas, se caen.
			if (abajoAnterior && punto(abajoAnterior, abajo) < 0.5 && islasAnteriores > 1)
				agregar({
					severidad: 'error',
					regla: 'giro-con-piezas-sueltas',
					mensaje: `Se gira el modelo con ${islasAnteriores} grupos sin unir: los que no están conectados se caen`,
					submodelo: nombre,
					paso: k + 1,
				});

			// Flotantes: todo grupo tiene que estar unido al resto o apoyado en la mesa.
			if (grupos.size > 1) {
				const bajosGrupo = [...grupos.values()].map((g) => g.reduce((m, p) => Math.max(m, masBajo(p, abajo)), -Infinity));
				const mesa = Math.max(...bajosGrupo);
				[...grupos.values()].forEach((g, gi) => {
					if (!Number.isFinite(bajosGrupo[gi]) || bajosGrupo[gi] >= mesa - TOL_MESA) return;
					// Sin nada debajo y a poca altura de la mesa: es un objeto aparte mal nivelado en el archivo.
					const enGrupo = new Set(g);
					const algoDebajo = colocadas.some((p) => !enGrupo.has(p) && g.some((q) => estaDebajo(cajasP[p], cajasP[q])));
					if (!algoDebajo && mesa - bajosGrupo[gi] <= NIVEL_MAX) return;
					// Apoyado sobre otras piezas (a lo sumo HUECO_MAX por encima de lo que tiene debajo): no está en
					// el aire, lo sostiene su peso. Si nunca se encastra, lo reporta el estado final
					// (apoyado-sin-conexion, o flota si queda un hueco).
					const hueco = huecoDebajo(abajo, bajosGrupo[gi], g, colocadas.filter((p) => !enGrupo.has(p)));
					if (hueco <= HUECO_MAX) return;
					const nuevas = g.filter((p) => enPaso.has(p));
					// Solo se reporta cuando aparece o cambia el grupo flotante (en el paso donde se agrega algo suyo).
					if (nuevas.length === 0) return;
					const sinDatos = g.every((p) => piezasSinConectores.has(piezas[p].archivo));
					// ¿En qué paso se une al resto? Como las piezas solo se agregan, una vez unido queda unido: se
					// busca por bisección. Si es el siguiente, alcanza con sostenerlo con la mano un paso; si es
					// más adelante, el modelo está bien pero el orden no: hay que colocarlo cuando tenga dónde
					// encastrar. Si no se une nunca, es un error del modelo.
					const unido = (k2: number) => {
						const uf2 = componentes(k2);
						const r = uf2.raiz(g[0]);
						return colocadasHasta(k2).some((p) => !enGrupo.has(p) && uf2.raiz(p) === r);
					};
					let seUne = -1;
					if (k + 1 < pasos.length && unido(pasos.length - 1)) {
						let [lo, hi] = [k + 1, pasos.length - 1];
						while (lo < hi) {
							const mid = (lo + hi) >> 1;
							if (unido(mid)) hi = mid;
							else lo = mid + 1;
						}
						seUne = lo;
					}
					const unUnPaso = seUne === k + 1;
					const regla = sinDatos ? 'flotante-sin-datos' : unUnPaso ? 'sostener-un-paso' : seUne > 0 ? 'suelto-varios-pasos' : 'flotante';
					const nombres = resumen(g.map((p) => piezas[p].archivo));
					agregar({
						severidad: regla === 'flotante' ? 'error' : 'aviso',
						regla,
						mensaje: unUnPaso
							? `${g.length} pieza(s) quedan sueltas hasta el paso siguiente: hay que sostenerlas (${nombres})`
							: seUne > 0
								? `${g.length} pieza(s) quedan en el aire hasta el paso ${seUne + 1}, donde se unen al resto: conviene colocarlas en ese paso (${nombres})`
								: `${g.length} pieza(s) quedan en el aire, sin conexión con el resto (${nombres})`,
						submodelo: nombre,
						paso: k + 1,
						piezas: g.map((p) => piezas[p].origen),
					});
				});
			}
			abajoAnterior = abajo;
			islasAnteriores = grupos.size;
		}

		// Camino de inserción: cada pieza (o sub-armado) nueva tiene que poder llegar a su lugar en
		// línea recta, en alguna de las direcciones de sus encastres, sin atravesar lo ya colocado.
		const cajasA = piezas.map((p) => cajaEnMundo(malla(p.archivo), p.tr));
		const gomas = new Map<string, boolean>();
		const esGoma = (p: number) => {
			const a = piezas[p].archivo;
			let g = gomas.get(a);
			if (g === undefined) gomas.set(a, (g = GOMA.test(tituloReal(bib, a))));
			return g;
		};
		const unidadDePieza = new Int32Array(piezas.length);
		unidades.forEach((u, ui) => u.piezas.forEach((p) => (unidadDePieza[p] = ui)));
		const aristasDePieza = new Map<number, Conexion[]>();
		for (const e of aristas)
			for (const p of [e.a, e.b]) {
				let l = aristasDePieza.get(p);
				if (!l) aristasDePieza.set(p, (l = []));
				l.push(e);
			}

		// `depende`: piezas de las que depende el resultado (socios encastrados presentes y lo que bloqueó cada
		// dirección); si ninguna sale, la prueba da lo mismo.
		type Prueba = {libre: boolean; dir?: Vec3; intentos: string[]; bloqueador?: number; trabas: number[]; depende: number[]; sinEjes: boolean; sinEnlaces: boolean};
		// Resultados que no dependen de qué otras piezas están presentes, por clave de lo que se mueve:
		// el solape en su lugar con cada pieza (colisión o roce, reportados aparte) y el recorrido contra
		// cada obstáculo en cada dirección.
		const solapes = new Map<string, boolean>();
		const recorridos = new Map<string, Map<number, number>>();
		// ¿Pueden las piezas `movil` (una unidad o un grupo que se mueve junto; `clave` lo identifica)
		// moverse en línea recta hasta su lugar (o, desarmando, salir de él), dadas las piezas presentes?
		// Las direcciones salen de sus encastres con las piezas presentes.
		// `obstaculosPosibles` puede ser una función: se evalúa solo si alguna dirección pasa los encastres.
		const probar = (piezasMovil: number[], clave: string, presente: (p: number) => boolean, obstaculosPosibles: Iterable<number> | (() => Iterable<number>), suelta = false): Prueba => {
			let posibles: Iterable<number> | null = typeof obstaculosPosibles === 'function' ? null : obstaculosPosibles;
			const movil = new Set(piezasMovil);
			const enlaces: Conexion[] = [];
			for (const p of piezasMovil)
				for (const e of aristasDePieza.get(p) ?? []) {
					const otro = movil.has(e.a) ? e.b : e.a;
					if (!movil.has(otro) && presente(otro)) enlaces.push(e);
				}
			// Sin encastres con lo presente: al armar, lo cubren las reglas de flotantes; al desarmar, la
			// unidad está suelta pero puede estar encerrada, así que se prueba en las seis direcciones.
			if (enlaces.length === 0 && !suelta) return {libre: true, intentos: [], trabas: [], depende: [], sinEjes: false, sinEnlaces: true};
			// Direcciones desde las que llega: la hembra llega desde +eje, el macho desde -eje.
			const dirs: {dir: Vec3; socios: Set<number>; profundidad: number}[] = [];
			const agregarDir = (dir: Vec3, socio: number, profundidad: number) => {
				let d = dirs.find((x) => punto(x.dir, dir) > 0.99);
				if (!d) dirs.push((d = {dir, socios: new Set(), profundidad: 0}));
				d.socios.add(socio);
				d.profundidad = Math.max(d.profundidad, profundidad);
			};
			// Encastres sin eje (clips, bisagras, rótulas, supuestos): esas piezas están en contacto a
			// propósito y se sueltan con la pieza; no cuentan como obstáculo.
			const sinEje = new Set(enlaces.filter((e) => e.ejes.length === 0).map((e) => (movil.has(e.a) ? e.b : e.a)));
			for (const e of enlaces) {
				const socio = movil.has(e.a) ? e.b : e.a;
				for (const x of e.ejes) {
					const dir = movil.has(x.hembra) ? x.eje : escalar(x.eje, -1);
					agregarDir(dir, socio, x.profundidad);
					if (x.ambos) agregarDir(escalar(dir, -1), socio, x.profundidad);
				}
			}
			if (enlaces.length === 0)
				for (const d of [[0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] as Vec3[]) agregarDir(d, -1, 4);
			const sinEjes = dirs.length === 0;
			if (sinEjes) agregarDir([0, -1, 0], -1, 4); // clips, bisagras, rótulas: se prueba desde arriba
			// Los triángulos de lo que se mueve solo hacen falta para recorrer (muchas pruebas terminan antes,
			// trabadas por un encastre).
			let cuerpo: {tris: Tris; caja: Caja}[] | null = null;
			const cuerpoDe = () => (cuerpo ??= piezasMovil.map((p) => ({tris: trisDe(p), caja: cajasA[p]})));
			const intentos: string[] = [];
			const trabas: number[] = [];
			const depende = enlaces.map((e) => (movil.has(e.a) ? e.b : e.a));
			let bloqueador: number | undefined;
			// ¿Lo que se mueve ya se solapa con la pieza `p` en su lugar? Se guarda por par de piezas: sirve
			// para la unidad, para los grupos que la contienen y para sus piezas sueltas.
			const solapado = (p: number) => () =>
				piezasMovil.some((m) => {
					if (!cajasSeTocan(cajasA[m], cajasA[p])) return false;
					const k = m < p ? `${m}|${p}` : `${p}|${m}`;
					let x = solapes.get(k);
					if (x === undefined) {
						x = penetracionPiezas(trisDe(m), cajasA[m], trisDe(p), cajasA[p], ROCE_MAX) > 0;
						solapes.set(k, x);
					}
					return x;
				});
			for (const d of dirs) {
				// Un encastre cilíndrico (stud, pin, eje) solo deja mover a lo largo de su eje, y en el sentido
				// en que se suelta (o en los dos si es pasante). Cualquier otro movimiento lo traba, sin
				// importar la geometría: un pin que se mueve de costado dentro de su agujero, o un stud dentro
				// del ladrillo de arriba, solo se solapan en tiras curvas finas, por debajo de la tolerancia de
				// roce; y un pin con collar no sigue de largo por el agujero. No cuentan los encastres de
				// menos de 1 LDU. Las conexiones inferidas son una suposición (una punta dentro de la caja de
				// otra pieza, que también aparece cuando dos piezas están encimadas por error): dan direcciones
				// para probar, pero no traban; ahí decide la geometría.
				const traba = enlaces.find((e) => {
					if (e.tipo === 'inferida') return false;
					return e.ejes.some((x) => {
						if (x.profundidad <= 1) return false;
						const sale = movil.has(x.hembra) ? x.eje : escalar(x.eje, -1);
						const libre = punto(sale, d.dir) > 0.99 || (x.ambos && punto(sale, d.dir) < -0.99);
						return !libre;
					});
				});
				if (traba) {
					bloqueador = movil.has(traba.a) ? traba.b : traba.a;
					trabas.push(bloqueador);
					intentos.push(`desde ${nombreDir(d.dir)} lo traba su encastre con ${piezas[bloqueador].archivo}`);
					continue;
				}
				const obstaculos: number[] = [];
				posibles ??= (obstaculosPosibles as () => Iterable<number>)();
				for (const p of posibles)
					if (!movil.has(p) && presente(p) && !d.socios.has(p) && !sinEje.has(p) && !piezas[p].flexible && !esGoma(p)) obstaculos.push(p);
				// El recorrido contra cada obstáculo es independiente de los demás y no cambia entre pruebas.
				// Alcanza con un obstáculo que choque: primero se miran los que ya se sabe que chocan (si
				// siguen presentes), después se calculan los que faltan hasta encontrar uno.
				const kd = `${clave}|${d.dir.map((v) => v.toFixed(3)).join(',')}|${d.profundidad.toFixed(2)}`;
				let porPieza = recorridos.get(kd);
				if (!porPieza) recorridos.set(kd, (porPieza = new Map()));
				let choque: number | undefined;
				for (const p of obstaculos) {
					const dist = porPieza.get(p);
					if (dist !== undefined && dist < Infinity) {
						choque = dist;
						bloqueador = p;
						break;
					}
				}
				if (choque === undefined)
					for (const p of obstaculos) {
						if (porPieza.has(p)) continue;
						const r = recorrer(cuerpoDe(), [{caja: cajasA[p], tris: () => trisDe(p), solapado: solapado(p)}], d.dir, d.profundidad, ROCE_MAX);
						porPieza.set(p, r.libre ? Infinity : r.distancia);
						if (!r.libre) {
							choque = r.distancia;
							bloqueador = p;
							break;
						}
					}
				if (choque === undefined) return {libre: true, dir: d.dir, intentos, trabas, depende, sinEjes, sinEnlaces: false};
				depende.push(bloqueador!);
				intentos.push(`desde ${nombreDir(d.dir)} choca con ${piezas[bloqueador!].archivo} a ${choque} LDU`);
			}
			return {libre: false, intentos, bloqueador, trabas, depende, sinEjes, sinEnlaces: false};
		};
		const probarUnidad = (ui: number, presente: (p: number) => boolean, obstaculosPosibles: Iterable<number>, suelta = false) =>
			probar(unidades[ui].piezas, `u${ui}`, presente, obstaculosPosibles, suelta);
		const esBlanda = (ui: number) => unidades[ui].piezas.every((p) => piezas[p].flexible || esGoma(p));

		// 1) Orden del archivo.
		const trabadas: {u: Unidad; ui: number; k: number; prueba: Prueba}[] = [];
		for (let k = 1; k < pasos.length; k++) {
			const antes = colocadasHasta(k - 1).length; // piezas de pasos anteriores: índices < antes
			const previas = Array.from({length: antes}, (_, i) => i);
			unidades.forEach((u, ui) => {
				if (u.paso !== k || esBlanda(ui)) return;
				const prueba = probarUnidad(ui, (p) => p < antes, previas);
				if (prueba.sinEnlaces) return; // sin conexión con lo anterior: lo cubren otras reglas
				if (prueba.libre) inserciones.push({submodelo: nombre, paso: k + 1, piezas: u.piezas.map((p) => piezas[p].origen), dir: prueba.dir!});
				else trabadas.push({u, ui, k, prueba});
			});
		}

		// 2) Si algo se trabó, ¿existe otro orden? Desarmado desde el sub-armado terminado: se saca, en
		// línea recta, todo lo que pueda salir sin chocar con lo que queda; si se saca todo, el orden
		// inverso es un armado válido. Una unidad que falla en el orden del archivo pero sale al desarmar
		// es un problema de los pasos, no del modelo.
		// Se desarma por bloques: al principio, las unidades (piezas y sub-armados). Cuando ya no sale
		// ningún bloque solo:
		// - se prueban grupos chicos que se traban entre sí (una viga con sus pines, dos piezas unidas
		//   por un pin con collar): en el armado real eso es un sub-armado que se prepara aparte y se
		//   coloca entero. El grupo tiene que poder armarse aparte (desarmándolo solo, de a un bloque).
		// - si tampoco, se desarma en sus piezas un sub-armado declarado: puede que no entre entero (tiene
		//   piezas a los dos lados de algo ya colocado) pero sí colocando sus piezas por separado.
		const salida = new Map<number, 'sola' | 'grupo' | 'partido'>(); // cómo salió cada unidad
		const gruposDe = new Map<number, number[]>(); // unidad → piezas del grupo con que salió
		if (trabadas.some((t) => !t.prueba.sinEjes)) {
			const bloques: number[][] = unidades.map((u) => u.piezas);
			const partido = new Set<number>(); // unidades cuyo sub-armado se desarmó en piezas
			const bloqueDePieza = Int32Array.from(unidadDePieza);
			const restantes = new Set(bloques.map((_, i) => i));
			const piezaPresente = (p: number) => restantes.has(bloqueDePieza[p]);
			const cajas: Caja[] = [];
			const cajaBloque = (b: number) => {
				if (cajas[b]) return cajas[b];
				const c = cajaVacia();
				for (const p of bloques[b]) {
					expandirCaja(c, cajasA[p].min);
					expandirCaja(c, cajasA[p].max);
				}
				return (cajas[b] = c);
			};
			const blando = (b: number) => bloques[b].every((p) => piezas[p].flexible || esGoma(p));
			const probarBloque = (b: number, presente: (p: number) => boolean, obstaculosPosibles: Iterable<number> | (() => Iterable<number>)) =>
				probar(bloques[b], b < unidades.length ? `u${b}` : `b${b}`, presente, obstaculosPosibles, true);
			// Obstáculos posibles de cada bloque: los bloques a menos de lo que puede recorrer al salir (el
			// encastre más profundo que tiene, más el margen). Se calculan al probarlo por primera vez; la
			// relación inversa dice a quién hay que volver a probar cuando un bloque sale.
			const obstaculosDe = new Map<number, number[]>();
			const reprobar = new Map<number, number[]>();
			const obstaculosBloque = (b: number) => {
				let l = obstaculosDe.get(b);
				if (l) return l;
				let prof = 4; // sin ejes se prueba 4 LDU desde arriba
				for (const p of bloques[b]) for (const e of aristasDePieza.get(p) ?? []) for (const x of e.ejes) prof = Math.max(prof, x.profundidad);
				const alcance = alcanceRecorrido(prof);
				l = [];
				for (const j of restantes)
					if (j !== b && cajasSeTocan(cajaBloque(b), cajaBloque(j), alcance)) {
						l.push(j);
						let r = reprobar.get(j);
						if (!r) reprobar.set(j, (r = []));
						r.push(b);
					}
				obstaculosDe.set(b, l);
				return l;
			};
			const piezasDe = (bs: Iterable<number>) => [...bs].flatMap((j) => (restantes.has(j) ? bloques[j] : []));
			const pendientes = new Set<number>();
			const vecinosDe = (b: number) => {
				const v = new Set(reprobar.get(b) ?? []);
				for (const p of bloques[b])
					for (const e of aristasDePieza.get(p) ?? []) v.add(bloqueDePieza[e.a === p ? e.b : e.a]);
				return v;
			};
			const faltan = Int32Array.from(unidades, (u) => u.piezas.length);
			const sacar = (grupo: number[]) => {
				for (const b of grupo) restantes.delete(b);
				olvidarBusquedas(grupo);
				for (const b of grupo) for (const j of vecinosDe(b)) if (restantes.has(j)) pendientes.add(j);
				const piezasGrupo = grupo.flatMap((b) => bloques[b]);
				for (const p of piezasGrupo) {
					const ui = unidadDePieza[p];
					if (--faltan[ui] > 0) continue;
					salida.set(ui, partido.has(ui) ? 'partido' : grupo.length > 1 ? 'grupo' : 'sola');
					if (grupo.length > 1) gruposDe.set(ui, piezasGrupo);
				}
			};
			const alto = (b: number) => cajaBloque(b).min[1]; // en LDraw -Y es arriba
			const desarmarDeAUno = () => {
				let pruebas = 0;
				while (pendientes.size > 0 && pruebas < 20 * piezas.length) {
					const b = pendientes.values().next().value!;
					pendientes.delete(b);
					if (!restantes.has(b)) continue;
					pruebas++;
					// La lista de obstáculos se pide siempre (registra a quién volver a probar cuando uno sale); pasarla
					// a piezas, solo si hace falta.
					const obst = obstaculosBloque(b);
					if (blando(b) || probarBloque(b, piezaPresente, () => piezasDe(obst)).libre) sacar([b]);
				}
			};
			// ¿Se puede armar el grupo aparte? Se lo desarma solo, de a un bloque.
			const armableAparte = (grupo: number[]) => {
				const quedan = new Set(grupo);
				const presente = (p: number) => quedan.has(bloqueDePieza[p]);
				for (let avance = true; avance && quedan.size > 1; ) {
					avance = false;
					for (const b of [...quedan]) {
						const otros = [...quedan].filter((x) => x !== b).flatMap((x) => bloques[x]);
						if (blando(b) || probarBloque(b, presente, otros).libre) {
							quedan.delete(b);
							avance = true;
						}
					}
				}
				return quedan.size <= 1;
			};
			// Busca un grupo que contenga al bloque `b` y pueda salir entero: se agregan los que lo traban.
			// Si no encuentra, anota qué bloques miró (miembros, obstáculos y los que traban): el resultado
			// solo puede cambiar cuando sale alguno de ellos, así que hasta entonces no se repite la búsqueda.
			const GRUPO_MAX = 8;
			const PRUEBAS_GRUPO = 24;
			const sinGrupo = new Set<number>();
			const miradoPor = new Map<number, Set<number>>(); // bloque → búsquedas fallidas que lo miraron
			const grupoQueSale = (b: number): number[] | null => {
				const vistos = new Set<string>([String(b)]);
				const cola: number[][] = [[b]];
				const mirados = new Set<number>([b]);
				let pruebas = 0;
				while (cola.length > 0 && pruebas < PRUEBAS_GRUPO) {
					const grupo = cola.shift()!;
					const miembros = new Set(grupo);
					const listas = grupo.map(obstaculosBloque);
					const obst = () => {
						const o = new Set<number>();
						for (const l of listas) for (const j of l) if (!miembros.has(j)) o.add(j);
						return piezasDe(o);
					};
					pruebas++;
					const prueba =
						grupo.length === 1
							? probarBloque(b, piezaPresente, obst)
							: probar(grupo.flatMap((g) => bloques[g]), `g${grupo.join(',')}`, piezaPresente, obst, true);
					if (prueba.libre && grupo.length > 1 && armableAparte(grupo)) return grupo;
					if (grupo.length >= GRUPO_MAX) continue;
					for (const p of prueba.depende) mirados.add(bloqueDePieza[p]);
					for (const p of prueba.trabas) {
						const j = bloqueDePieza[p];
						mirados.add(j);
						if (miembros.has(j) || !restantes.has(j)) continue;
						const nuevo = [...grupo, j].sort((x, y) => x - y);
						const k = nuevo.join(',');
						if (vistos.has(k)) continue;
						vistos.add(k);
						cola.push(nuevo);
					}
				}
				sinGrupo.add(b);
				for (const j of mirados) {
					let s = miradoPor.get(j);
					if (!s) miradoPor.set(j, (s = new Set()));
					s.add(b);
				}
				return null;
			};
			const olvidarBusquedas = (salieron: number[]) => {
				for (const r of salieron) {
					for (const b of miradoPor.get(r) ?? []) sinGrupo.delete(b);
					miradoPor.delete(r);
				}
			};
			// Desarma en sus piezas un sub-armado declarado que queda trabado. Para los demás bloques no cambia
			// nada de lo presente: solo hay que poner sus piezas en lugar del bloque viejo en las listas de
			// obstáculos que lo tenían, y repetir las búsquedas de grupos que lo miraron.
			const partir = (b: number) => {
				restantes.delete(b);
				const nuevos: number[] = [];
				for (const p of bloques[b]) {
					partido.add(unidadDePieza[p]);
					const nuevo = bloques.push([p]) - 1;
					bloqueDePieza[p] = nuevo;
					restantes.add(nuevo);
					pendientes.add(nuevo);
					nuevos.push(nuevo);
				}
				const conB = reprobar.get(b) ?? [];
				for (const j of conB) obstaculosDe.get(j)?.push(...nuevos);
				for (const n of nuevos) reprobar.set(n, [...conB]);
				reprobar.delete(b);
				obstaculosDe.delete(b);
				olvidarBusquedas([b]);
			};

			for (const b of [...restantes].sort((x, y) => alto(x) - alto(y))) pendientes.add(b);
			desarmarDeAUno();
			for (let avance = true; avance && restantes.size > 0; ) {
				avance = false;
				const orden = [...restantes].sort((x, y) => alto(x) - alto(y));
				for (const b of orden) {
					if (sinGrupo.has(b)) continue;
					const grupo = grupoQueSale(b);
					if (!grupo) continue;
					sacar(grupo);
					desarmarDeAUno();
					avance = true;
					break;
				}
				if (avance) continue;
				// Ni solos ni en grupo: se parte el sub-armado trabado más alto.
				const sub = orden.find((b) => bloques[b].length > 1 && unidades[unidadDePieza[bloques[b][0]]].submodelo && bloques[b] === unidades[unidadDePieza[bloques[b][0]]].piezas);
				if (sub === undefined) break;
				partir(sub);
				desarmarDeAUno();
				avance = true;
			}
			if (process.env.DEPURAR_DESARMADO && restantes.size > 0) {
				console.error(`[desarmado] ${nombre}: quedan ${restantes.size} de ${bloques.length}`);
				for (const b of [...restantes].slice(0, 40)) {
					const pr = probarBloque(b, piezaPresente, piezasDe(obstaculosBloque(b)));
					console.error(`  ${bloques[b].map((p) => piezas[p].archivo).join('+').slice(0, 60)} @${piezas[bloques[b][0]].origen}: ${pr.intentos.join('; ').slice(0, 300)}`);
				}
			}
		}

		for (const {u, ui, k, prueba} of trabadas) {
			const quien = u.submodelo ? `el sub-armado ${u.submodelo}` : piezas[u.piezas[0]].archivo;
			const con = prueba.bloqueador !== undefined ? piezas[prueba.bloqueador] : null;
			const como = salida.get(ui);
			const regla = prueba.sinEjes
				? 'camino-dudoso'
				: !como
					? 'sin-camino-recto'
					: como === 'partido'
						? 'subarmado-no-entra'
						: como === 'grupo'
							? 'requiere-subarmado'
							: 'orden-sin-camino';
			const grupo = gruposDe.get(ui);
			const juntas = grupo ? resumen(grupo.map((p) => piezas[p].archivo)) : '';
			const motivo = prueba.intentos.join('; ');
			const mensaje = {
				'camino-dudoso': `${quien} no puede entrar en línea recta (${motivo})`,
				'sin-camino-recto': `${quien} no puede entrar en línea recta (${motivo})`,
				'subarmado-no-entra': `${quien} no puede colocarse entero; se arma colocando sus piezas por separado (${motivo})`,
				'requiere-subarmado': `${quien} no puede entrar en línea recta pieza por pieza; se arma si se prepara aparte un sub-armado con ${juntas} y se coloca entero (${motivo})`,
				'orden-sin-camino': `${quien} no puede entrar en línea recta en el orden del archivo, pero sí en otro orden (${motivo})`,
			}[regla];
			agregar({
				severidad: regla === 'sin-camino-recto' ? 'error' : 'aviso',
				regla,
				mensaje,
				submodelo: nombre,
				paso: k + 1,
				piezas: [...u.piezas.map((p) => piezas[p].origen), ...(con ? [con.origen] : [])],
			});
		}

		// Un sub-armado se levanta para colocarlo: tiene que quedar en una sola pieza.
		const uf = new UnionFind(piezas.length);
		for (const e of aristas) uf.unir(e.a, e.b);
		for (const u of unidades) if (u.submodelo && verificados.get(u.submodelo)) u.piezas.forEach((p) => uf.unir(p, u.piezas[0]));
		const porRaiz = new Map<number, number[]>();
		piezas.forEach((_, i) => {
			const r = uf.raiz(i);
			porRaiz.set(r, [...(porRaiz.get(r) ?? []), i]);
		});
		const esPrincipal = pila.length === 0;
		verificados.set(nombre, porRaiz.size === 1);
		if (porRaiz.size > 1) {
			// Si todas las partes apoyan a la misma altura, el submodelo solo agrupa objetos sueltos
			// (fardos, accesorios) que se dejan sobre la mesa: no es un sub-armado que se levante.
			const abajo: Vec3 = [0, 1, 0];
			const bajos = [...porRaiz.values()].map((g) => Math.max(...g.map((p) => masBajo(p, abajo))));
			const agrupa = Math.max(...bajos) - Math.min(...bajos) <= TOL_MESA;
			// Grupos sueltos que son carga: guardados dentro del volumen de otra pieza (regalos en un
			// contenedor) o apoyados sobre otras piezas (un plato sobre una mesa). No se desarman: se
			// ubican encima o adentro.
			const grupos = [...porRaiz.values()].sort((a, b) => b.length - a.length);
			const cajasS = piezas.map((p) => cajaEnMundo(malla(p.archivo), p.tr));
			const esCarga = (g: number[]) => {
				if (g.length > CARGA_MAX) return false; // un grupo grande apoyado sin encastrar sí se desarma
				const enG = new Set(g);
				const otras = piezas.map((_, i) => i).filter((i) => !enG.has(i));
				const adentro = g.every((p) => otras.some((o) => contiene(cajasS[o], cajasS[p], TOL_MESA)));
				const apoyado = g.some((p) => otras.some((o) => apoyaSobre(cajasS[p], cajasS[o])));
				return adentro || apoyado;
			};
			const carga = !esPrincipal && !agrupa && grupos.slice(1).every(esCarga);
			agregar({
				severidad: esPrincipal || agrupa || carga ? 'aviso' : 'error',
				regla: esPrincipal
					? 'modelo-en-varias-partes'
					: agrupa
						? 'submodelo-de-objetos-sueltos'
						: carga
							? 'subarmado-con-piezas-sueltas'
							: 'subarmado-en-varias-partes',
				mensaje: esPrincipal
					? `El modelo terminado son ${porRaiz.size} objetos separados (normal si el set trae accesorios o figuras aparte)`
					: agrupa
						? `El submodelo agrupa ${porRaiz.size} objetos sueltos apoyados en la mesa`
						: carga
							? `El sub-armado lleva piezas sueltas apoyadas o guardadas, sin encastrar (${grupos
									.slice(1, 4)
									.map((g) => `[${resumen(g.map((p) => piezas[p].archivo))}]`)
									.join(' ')})`
							: `El sub-armado termina en ${porRaiz.size} grupos sin unir: al levantarlo para colocarlo, se desarma ` +
							`(sueltos: ${[...porRaiz.values()]
								.sort((a, b) => b.length - a.length)
								.slice(1, 4)
								.map((g) => `[${resumen(g.map((p) => piezas[p].archivo))}]`)
								.join(' ')})`,
				submodelo: nombre,
				piezas: [...porRaiz.values()]
					.sort((a, b) => b.length - a.length)
					.slice(1)
					.flat()
					.map((p) => piezas[p].origen),
			});
		}
	}

	function aristasDe(piezas: PiezaUbicada[]): Conexion[] {
		const ubicados: ConectorUbicado[] = [];
		piezas.forEach((p, i) => {
			for (const c of conectoresDe(bib, p.archivo)) {
				const t = transformarConector(c, p.tr);
				if (t) ubicados.push({pieza: i, c: t as Conector});
			}
		});
		const aristas = conexiones(ubicados);
		// Las piezas de un mismo elemento flexible son una sola.
		const primeraFlexible = new Map<string, number>();
		piezas.forEach((p, i) => {
			if (!p.flexible) return;
			const f = primeraFlexible.get(p.flexible);
			if (f === undefined) primeraFlexible.set(p.flexible, i);
			else aristas.push({a: f, b: i, tipo: 'flexible', ejes: []});
		});
		const cajasP = piezas.map((p) => cajaEnMundo(malla(p.archivo), p.tr));

		// Huecos que la shadow library no declara (el anti-stud de una cúpula, el alojamiento de una
		// rótula): si la punta de un conector macho (o la bola de una rótula) queda dentro del volumen de
		// otra pieza, se infiere que está encastrado en ella.
		const unidas = new Set(aristas.map((e) => `${e.a}:${e.b}`));
		for (const u of ubicados) {
			const macho = (u.c.tipo === 'cil' || u.c.tipo === 'gen') && u.c.genero === 'M';
			if (!macho) continue;
			const medio = u.c.tipo === 'gen' ? u.c.base : sumar(u.c.base, escalar(u.c.eje, Math.min(u.c.largo, 4) / 2));
			cajasP.forEach((c, j) => {
				if (j === u.pieza || !dentroDeCaja(medio, c, -HOLGURA_INFERENCIA)) return;
				const [a, b] = u.pieza < j ? [u.pieza, j] : [j, u.pieza];
				if (unidas.has(`${a}:${b}`)) return;
				const local = aplicar(invertirRigida(piezas[j].tr), medio);
				if (!dentroDeCaja(local, malla(piezas[j].archivo).caja, -HOLGURA_INFERENCIA)) return;
				unidas.add(`${a}:${b}`);
				// Si las dos piezas se atraviesan más que la altura de un stud, la punta está adentro porque
				// están encimadas, no encastradas: no hay conexión (la regla de colisiones lo reporta).
				const tris = (i: number) => trisEnMundo(malla(piezas[i].archivo), piezas[i].tr);
				if (penetracionPiezas(tris(a), cajasP[a], tris(b), cajasP[b], INFERIDA_MAX + 0.01, undefined, INFERIDA_MAX) > INFERIDA_MAX) return;
				// Un macho entra moviéndose hacia su punta: equivale a una hembra con eje = eje del macho.
				// Un macho sin tapas (pin, eje) puede atravesar desde cualquiera de los dos lados: el sentido de su
				// eje en el archivo es arbitrario. Con tapas (stud), entra punta primero.
				const pasante = u.c.tipo === 'cil' && (u.c.caps === 'none' || u.c.caps === 'two');
				const ejes = u.c.tipo === 'cil' ? [{eje: u.c.eje, hembra: j, ambos: pasante, profundidad: Math.min(u.c.largo, 4)}] : [];
				aristas.push({a, b, tipo: 'inferida', ejes});
			});
		}

		// Piezas sin datos de conexión: se suponen unidas a lo que tocan.
		piezas.forEach((p, i) => {
			if (!piezasSinConectores.has(p.archivo)) return;
			cajasP.forEach((c, j) => {
				if (j !== i && cajasSeTocan(cajasP[i], c, 0.5)) aristas.push({a: Math.min(i, j), b: Math.max(i, j), tipo: 'supuesta', ejes: []});
			});
		});
		return aristas;
	}

	verificarEnsamble(principal);

	// --- Regla 4: cada objeto terminado se sostiene ---
	// Masa estimada proporcional a la superficie (las piezas son cáscaras de pared más o menos pareja),
	// calibrada con el ladrillo 2×4. El centro de masa de cada pieza se aproxima por el de su caja.
	const k = MASA_3001 / malla('3001.dat').area;
	const ufFinal = new UnionFind(todas.length);
	for (const e of aristasTodas) ufFinal.unir(e.a, e.b);
	const objetos = new Map<number, number[]>();
	todas.forEach((_, i) => {
		const r = ufFinal.raiz(i);
		objetos.set(r, [...(objetos.get(r) ?? []), i]);
	});
	let masa = 0;
	const datos = [...objetos.values()].map((objeto) => {
		let m = 0;
		const cm: Vec3 = [0, 0, 0];
		const vertices: Vec3[] = [];
		let piso = -Infinity; // punto más bajo (en LDraw +Y es abajo)
		for (const i of objeto) {
			const mp = malla(todas[i].archivo).area * k;
			const c = cajas[i];
			m += mp;
			for (let d = 0; d < 3; d++) cm[d] += (mp * (c.min[d] + c.max[d])) / 2;
			// Para la envolvente alcanzan las 8 esquinas de la caja de cada pieza (en su sistema, llevadas
			// al mundo): usar todos los vértices es muy lento y apenas cambia el resultado.
			const mc = malla(todas[i].archivo).caja;
			for (const x of [mc.min[0], mc.max[0]])
				for (const y of [mc.min[1], mc.max[1]])
					for (const z of [mc.min[2], mc.max[2]]) vertices.push(aplicar(todas[i].tr, [x, y, z]));
			// El punto más bajo sí se mide con los vértices reales (una pieza rotada tiene la caja más baja).
			const t = trisEnMundo(malla(todas[i].archivo), todas[i].tr);
			for (let o = 1; o < t.length; o += 3) if (t[o] > piso) piso = t[o];
		}
		masa += m;
		for (let d = 0; d < 3; d++) cm[d] /= m;
		return {objeto, cm, vertices, piso};
	});
	const mesa = Math.max(...datos.map((d) => d.piso));
	for (const {objeto, cm, vertices, piso} of datos) {
		if (!Number.isFinite(piso)) continue; // sin geometría: pieza inexistente, ya reportada
		const nombres = resumen(objeto.map((i) => todas[i].archivo));
		// Estado final: un objeto suelto (sin conexión con el resto) que no toca la mesa cae hasta lo
		// primero que tenga debajo. Si eso está a pocos LDU, es carga suelta apoyada o un objeto aparte
		// mal nivelado en el archivo; si está lejos, flota.
		if (piso < mesa - TOL_MESA) {
			const enObjeto = new Set(objeto);
			const inferiores = objeto.filter((i) => cajas[i].max[1] >= piso - TOL_MESA);
			let hueco = mesa - piso;
			let sobrePiezas = false;
			todas.forEach((_, j) => {
				if (enObjeto.has(j) || cajas[j].min[1] < piso - TOL_MESA) return;
				const debajo = inferiores.some(
					(i) =>
						cajas[i].min[0] < cajas[j].max[0] &&
						cajas[j].min[0] < cajas[i].max[0] &&
						cajas[i].min[2] < cajas[j].max[2] &&
						cajas[j].min[2] < cajas[i].max[2],
				);
				if (debajo && cajas[j].min[1] - piso < hueco) {
					hueco = Math.max(0, cajas[j].min[1] - piso);
					sobrePiezas = true;
				}
			});
			// Sin nada debajo es un objeto aparte ubicado a otra altura en el archivo (figuras, accesorios,
			// maquetas "en vuelo"): cae a la mesa y queda parado, no es un error del armado.
			const flota = sobrePiezas && hueco > HUECO_MAX;
			agregar({
				severidad: flota ? 'error' : 'aviso',
				regla: flota ? 'flota' : sobrePiezas ? 'apoyado-sin-conexion' : 'mal-nivelado',
				mensaje: flota
					? `${objeto.length} pieza(s) sin conexión flotan ${hueco.toFixed(0)} LDU por encima de lo que tienen debajo (${nombres})`
					: sobrePiezas
						? `${objeto.length} pieza(s) descansan sobre otras sin estar encastradas (${nombres})`
						: `Un objeto aparte (${objeto.length} piezas: ${nombres}) está ${hueco.toFixed(1)} LDU por encima de la mesa`,
				piezas: objeto.map((i) => todas[i].origen),
			});
			if (flota) continue;
		}
		const a = apoyo(vertices, cm);
		if (!a || a.inclinacionGrados <= INCLINACION_OK) continue;
		// Un accesorio suelto (hasta CARGA_MAX piezas) que "se vuelca" solo queda acostado en la mesa.
		const vuelca = a.inclinacionGrados > INCLINACION_MAX && objeto.length > CARGA_MAX;
		agregar({
			severidad: vuelca ? 'error' : 'aviso',
			regla: vuelca ? 'se-vuelca' : 'queda-inclinado',
			mensaje: `Un objeto (${objeto.length} piezas: ${nombres}) ${vuelca ? 'se vuelca' : 'queda inclinado'}: se apoya a ${a.inclinacionGrados.toFixed(0)}°`,
			piezas: objeto.map((i) => todas[i].origen),
		});
	}

	return {
		modelo: principal,
		piezas: todas.length,
		pasos: [...aplanados.keys()].reduce((s, n) => s + pasosDe(bib.archivo(n)!).length, 0),
		submodelos: aplanados.size - 1,
		conexiones: totalConexiones,
		piezasSinConectores: [...piezasSinConectores],
		masaEstimadaG: Math.round(masa),
		hallazgos,
		inserciones,
	};
}

function resumen(nombres: string[]) {
	const cuenta = new Map<string, number>();
	for (const n of nombres) cuenta.set(n, (cuenta.get(n) ?? 0) + 1);
	const partes = [...cuenta].map(([n, c]) => (c > 1 ? `${c}× ${n}` : n));
	return partes.length > 4 ? `${partes.slice(0, 4).join(', ')}, …` : partes.join(', ');
}

// Dirección "abajo" del modelo cuando el paso se ve con ROTSTEP x y z (grados).
function direccionAbajo(rot: Vec3 | null): Vec3 {
	if (!rot) return [0, 1, 0];
	const [ax, ay, az] = rot.map((g) => (g * Math.PI) / 180);
	// Rotación de la vista R = Rz·Ry·Rx; el "abajo" de la pantalla expresado en el modelo es Rᵀ·(0,1,0).
	const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
	const r = [
		cy * cz, cz * sx * sy - cx * sz, cx * cz * sy + sx * sz,
		cy * sz, cx * cz + sx * sy * sz, cx * sy * sz - cz * sx,
		-sy, cy * sx, cx * cy,
	];
	return [r[3], r[4], r[5]];
}

class UnionFind {
	private p: Int32Array;
	constructor(n: number) {
		this.p = new Int32Array(n).map((_, i) => i);
	}
	raiz(x: number): number {
		while (this.p[x] !== x) x = this.p[x] = this.p[this.p[x]];
		return x;
	}
	unir(a: number, b: number) {
		this.p[this.raiz(a)] = this.raiz(b);
	}
}


const dentroDeCaja = (p: Vec3, c: Caja, margen: number) =>
	p[0] > c.min[0] + margen &&
	p[0] < c.max[0] - margen &&
	p[1] > c.min[1] + margen &&
	p[1] < c.max[1] - margen &&
	p[2] > c.min[2] + margen &&
	p[2] < c.max[2] - margen;

// Título de la pieza siguiendo los alias "~Moved to X" hasta la pieza real.
function tituloReal(bib: Biblioteca, archivo: string): string {
	let a = bib.archivo(archivo);
	for (let n = 0; a && n < 5; n++) {
		const m = a.titulo.match(/^~Moved to (\S+)/);
		if (!m) break;
		a = bib.archivo(m[1].toLowerCase() + '.dat');
	}
	return a?.titulo ?? '';
}

// ¿La caja `abajo` está debajo de `arriba` (se superponen en planta y `abajo` no está más arriba)?
// En LDraw +Y es abajo: el techo de una caja es su min[1].
const estaDebajo = (abajo: Caja, arriba: Caja) =>
	abajo.min[1] >= arriba.max[1] - TOL_MESA &&
	abajo.min[0] < arriba.max[0] &&
	arriba.min[0] < abajo.max[0] &&
	abajo.min[2] < arriba.max[2] &&
	arriba.min[2] < abajo.max[2];

// "arriba", "abajo", "+x"… para mensajes (en LDraw -Y es arriba).
function nombreDir(d: Vec3): string {
	const i = [0, 1, 2].reduce((m, k) => (Math.abs(d[k]) > Math.abs(d[m]) ? k : m), 0);
	if (Math.abs(d[i]) < 0.9) return `(${d.map((x) => x.toFixed(2)).join(', ')})`;
	if (i === 1) return d[1] < 0 ? 'arriba' : 'abajo';
	return `${d[i] > 0 ? '+' : '-'}${'xyz'[i]}`;
}

// ¿La caja `a` contiene a la caja `b` (con tolerancia)?
const contiene = (a: Caja, b: Caja, tol: number) =>
	[0, 1, 2].every((i) => b.min[i] >= a.min[i] - tol && b.max[i] <= a.max[i] + tol);

// ¿`arriba` apoya sobre `abajo`? Su base toca el techo de `abajo` y se superponen en planta.
// En LDraw +Y es abajo: la base de una caja es su max[1] y el techo, su min[1].
const apoyaSobre = (arriba: Caja, abajo: Caja) =>
	Math.abs(arriba.max[1] - abajo.min[1]) <= TOL_MESA + 1 &&
	arriba.min[0] < abajo.max[0] &&
	abajo.min[0] < arriba.max[0] &&
	arriba.min[2] < abajo.max[2] &&
	abajo.min[2] < arriba.max[2];

// Caché con límite de entradas: descarta la usada hace más tiempo (LRU).
function cacheAcotado<T>(calcular: (i: number) => T, limite: number): (i: number) => T {
	const m = new Map<number, T>();
	return (i) => {
		let v = m.get(i);
		if (v !== undefined) {
			m.delete(i);
			m.set(i, v);
			return v;
		}
		v = calcular(i);
		m.set(i, v);
		if (m.size > limite) m.delete(m.keys().next().value!);
		return v;
	};
}
