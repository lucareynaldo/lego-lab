// Plan de un manual de instrucciones a partir de un modelo LDraw.
//
// Cada submodelo es una sección (un sub-armado que se arma aparte); el modelo principal va último.
// Para cada sección se escribe un .ldr plano, en su propio sistema de coordenadas, con un "0 STEP"
// por paso del manual: el estudio lo renderiza fotograma a fotograma. También se escribe un .ldr con
// una pieza por paso, para las imágenes de la lista de piezas.
//
// El plan incluye además la verificación del modelo (para la última página), las flechas de
// inserción de las piezas que no entran desde arriba y qué pasos llevan un recuadro ampliado.
//
// Uso: node src/planificar.ts <modelo.mpd> <carpeta de salida>

import {createReadStream, mkdirSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {createGunzip} from 'node:zlib';
import {cajaEnMundo, mallaDe} from '../../verificador/src/geometria.ts';
import type {Referencia} from '../../verificador/src/ldraw.ts';
import {Biblioteca, esFlexible, esPieza, parsearReferencia, pasosDe} from '../../verificador/src/ldraw.ts';
import type {Caja, Transform, Vec3} from '../../verificador/src/matematica.ts';
import {cajaVacia, componer, expandirCaja, punto} from '../../verificador/src/matematica.ts';
import type {Reporte} from '../../verificador/src/verificar.ts';
import {verificar} from '../../verificador/src/verificar.ts';

export type PiezaLista = {archivo: string; color: number; cantidad: number};

export type PasoPlan = {
	numero: number; // 1-based dentro de la sección
	piezas: PiezaLista[]; // piezas sueltas nuevas del paso
	subarmados: {seccion: string; cantidad: number}[];
	rotacion: Vec3 | null; // ROTSTEP: cómo se ve el modelo en este paso
	// Flechas de inserción: piezas (índices en el .ldr plano de la sección) que no entran desde arriba,
	// y desde qué dirección llegan (en coordenadas LDraw de la sección).
	flechas: {indices: number[]; dir: Vec3}[];
	detalle: boolean; // lo nuevo es chico respecto de lo visible: el manual agrega un recuadro ampliado
};

export type Seccion = {
	id: string; // nombre del submodelo en LDraw
	titulo: string;
	numero: number; // 1-based, en orden de armado
	archivoPlano: string; // .ldr plano para renderizar
	pasos: PasoPlan[];
	usos: number; // cuántas veces se coloca en el modelo
};

export type ResumenVerificacion = {
	errores: number;
	avisos: number;
	conexiones: number;
	masaG: number;
	porRegla: Record<string, {severidad: string; cantidad: number; ejemplo: string}>;
};

export type Plan = {
	modelo: string;
	titulo: string;
	piezasTotales: number;
	pasosTotales: number;
	secciones: Seccion[];
	inventario: (PiezaLista & {titulo: string; colorNombre: string; rgb: string; elemento: string | null})[];
	archivoPiezas: string; // .ldr con una pieza por paso, en el orden del inventario
	verificacion: ResumenVerificacion;
};

// `origen` ("archivo:línea") identifica cada pieza igual que el verificador.
type Plana = {archivo: string; color: number; tr: Transform; origen: string};

// Lo nuevo de un paso se amplía en un recuadro si su tamaño es menor que esta fracción de lo visible.
const DETALLE_FRACCION = 0.25;
const DETALLE_MINIMO = 80; // LDU: en modelos chicos no hace falta
const ARRIBA: Vec3 = [0, -1, 0];

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const identidad: Transform = {r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0]};
const radio = (c: Caja) => Math.hypot(c.max[0] - c.min[0], c.max[1] - c.min[1], c.max[2] - c.min[2]) / 2;

// `previo`: biblioteca ya cargada con el modelo y su reporte, para no verificar dos veces (banco de pruebas).
export async function planificar(
	ruta: string,
	salida: string,
	previo?: {bib: Biblioteca; principal: string; reporte: Reporte},
): Promise<Plan> {
	const bib = previo?.bib ?? new Biblioteca(join(raiz, '.cache/ldraw'), join(raiz, '.cache/LDCadShadowLibrary-main'));
	const principal = previo?.principal ?? bib.cargarModelo(ruta, basename(ruta));
	mkdirSync(salida, {recursive: true});

	const esSubmodelo = (nombre: string) => {
		const a = bib.archivo(nombre);
		return !!a && !esPieza(a);
	};

	// Todas las piezas de un submodelo, en su sistema de coordenadas.
	function aplanar(nombre: string, tr: Transform, color: number): Plana[] {
		return pasosDe(bib.archivo(nombre)!).flatMap((p) => p.refs.flatMap((r) => ubicar(r, tr, color, nombre)));
	}
	function ubicar(ref: Referencia, tr: Transform, colorPadre: number, padre: string): Plana[] {
		const color = ref.color === 16 ? colorPadre : ref.color;
		const t = componer(tr, ref.transform);
		if (!esSubmodelo(ref.archivo)) return [{archivo: ref.archivo, color, tr: t, origen: `${padre}:${ref.linea}`}];
		return aplanar(ref.archivo, t, color);
	}

	// Un submodelo es sección si tiene pasos propios, salvo los flexibles (cordones: van como pieza)
	// y los envoltorios (un modelo cuyo único contenido es otro submodelo).
	const refsDe = (nombre: string) => pasosDe(bib.archivo(nombre)!).flatMap((p) => p.refs);
	const esEnvoltorio = (nombre: string) => {
		const refs = refsDe(nombre);
		return refs.length === 1 && esSubmodelo(refs[0].archivo);
	};
	const esSeccion = (nombre: string) => esSubmodelo(nombre) && !esFlexible(bib.archivo(nombre)!) && !esEnvoltorio(nombre);

	// Orden de armado: primero los sub-armados (en el orden en que aparecen), después quien los usa.
	const orden: string[] = [];
	const usos = new Map<string, number>();
	function visitar(nombre: string) {
		for (const r of refsDe(nombre)) {
			if (!esSubmodelo(r.archivo)) continue;
			usos.set(r.archivo, (usos.get(r.archivo) ?? 0) + 1);
			if (!orden.includes(r.archivo)) visitar(r.archivo);
		}
		if (!orden.includes(nombre)) orden.push(nombre);
	}
	visitar(principal);
	// Los envoltorios pasan su contenido: el principal efectivo es el primer modelo con pasos propios.
	let efectivo = principal;
	while (esEnvoltorio(efectivo)) efectivo = refsDe(efectivo)[0].archivo;
	const secciones = orden.filter((n) => esSeccion(n) || n === efectivo).filter((n, i, a) => a.indexOf(n) === i);
	secciones.splice(secciones.indexOf(efectivo), 1);
	secciones.push(efectivo);

	// Verificación: da el resumen de la última página y la dirección de entrada de cada pieza.
	const reporte = previo?.reporte ?? verificar(bib, principal);
	const direcciones = new Map<string, Vec3[]>();
	for (const ins of reporte.inserciones) {
		const k = `${ins.submodelo}|${ins.paso}|${ins.piezas.join(',')}`;
		direcciones.set(k, [...(direcciones.get(k) ?? []), ins.dir]);
	}
	const porRegla: ResumenVerificacion['porRegla'] = {};
	for (const h of reporte.hallazgos) {
		const x = (porRegla[h.regla] ??= {severidad: h.severidad, cantidad: 0, ejemplo: h.mensaje});
		x.cantidad++;
	}

	const plan: Plan = {
		modelo: basename(ruta),
		titulo: (await nombreDeSet(basename(ruta))) ?? bib.archivo(efectivo)!.titulo,
		piezasTotales: aplanar(principal, identidad, 16).length,
		pasosTotales: 0,
		secciones: [],
		inventario: [],
		archivoPiezas: 'piezas.ldr',
		verificacion: {
			errores: reporte.hallazgos.filter((h) => h.severidad === 'error').length,
			avisos: reporte.hallazgos.filter((h) => h.severidad === 'aviso').length,
			conexiones: reporte.conexiones,
			masaG: reporte.masaEstimadaG,
			porRegla,
		},
	};

	const lineaLDraw = (p: Plana) => `1 ${p.color} ${p.tr.t.join(' ')} ${p.tr.r.join(' ')} ${p.archivo}`;

	// Escribe un .ldr plano como .mpd, agregando las piezas personalizadas embebidas en el modelo
	// original (y sus sub-archivos embebidos), que no están en la biblioteca LDraw.
	const escribir = (archivo: string, lineas: string[]) => {
		const embebidos = new Set<string>();
		const pendientes = lineas.map((l) => parsearReferencia(l, 0)?.archivo).filter((n): n is string => !!n);
		while (pendientes.length > 0) {
			const n = pendientes.pop()!;
			const a = bib.archivo(n);
			if (!a?.embebido || embebidos.has(n)) continue;
			embebidos.add(n);
			for (const l of a.lineas) {
				const ref = parsearReferencia(l, 0);
				if (ref) pendientes.push(ref.archivo);
			}
		}
		const partes = [`0 FILE ${archivo}`, ...lineas];
		for (const n of embebidos) partes.push(`0 FILE ${n}`, ...bib.archivo(n)!.lineas);
		writeFileSync(join(salida, archivo), partes.join('\n') + '\n');
	};

	secciones.forEach((nombre, si) => {
		const archivo = bib.archivo(nombre)!;
		const lineas = [`0 ${archivo.titulo}`, `0 Name: ${nombre}`];
		const pasos: PasoPlan[] = [];
		let indice = 0; // índice de la próxima pieza en el .ldr plano
		const visible = cajaVacia();
		for (const [k, paso] of pasosDe(archivo).entries()) {
			const piezas = new Map<string, PiezaLista>();
			const subarmados = new Map<string, number>();
			const flechas: PasoPlan['flechas'] = [];
			const nueva = cajaVacia();
			for (const ref of paso.refs) {
				const color = ref.color === 16 ? 16 : ref.color;
				if (esSeccion(ref.archivo)) subarmados.set(ref.archivo, (subarmados.get(ref.archivo) ?? 0) + 1);
				else {
					// Una pieza suelta, un flexible o un envoltorio: sus piezas van a la lista del paso.
					const hojas =
						esSubmodelo(ref.archivo) && !esFlexible(bib.archivo(ref.archivo)!)
							? aplanar(ref.archivo, identidad, color)
							: [{archivo: ref.archivo, color}];
					for (const h of hojas) {
						const clave = `${h.archivo}|${h.color}`;
						const x = piezas.get(clave) ?? {archivo: h.archivo, color: h.color, cantidad: 0};
						x.cantidad++;
						piezas.set(clave, x);
					}
				}
				const planas = ubicar(ref, identidad, 16, nombre);
				const indices = planas.map((_, i) => indice + i);
				indice += planas.length;
				for (const p of planas) {
					lineas.push(lineaLDraw(p));
					const c = cajaEnMundo(mallaDe(bib, p.archivo), p.tr);
					for (const caja of [visible, nueva]) {
						expandirCaja(caja, c.min);
						expandirCaja(caja, c.max);
					}
				}
				// Flecha si el verificador encontró que entra desde otro lado que arriba.
				const dir = direcciones.get(`${nombre}|${k + 1}|${planas.map((p) => p.origen).join(',')}`)?.shift();
				if (dir && punto(dir, ARRIBA) < 0.9) flechas.push({indices, dir});
			}
			lineas.push('0 STEP');
			const rVisible = radio(visible);
			pasos.push({
				numero: pasos.length + 1,
				piezas: [...piezas.values()],
				subarmados: [...subarmados].map(([seccion, cantidad]) => ({seccion, cantidad})),
				rotacion: paso.rotacion,
				flechas,
				detalle: k > 0 && rVisible > DETALLE_MINIMO && radio(nueva) < DETALLE_FRACCION * rVisible,
			});
		}
		const archivoPlano = `seccion-${String(si + 1).padStart(2, '0')}.ldr`;
		escribir(archivoPlano, lineas);
		plan.secciones.push({id: nombre, titulo: archivo.titulo, numero: si + 1, archivoPlano, pasos, usos: usos.get(nombre) ?? 1});
		plan.pasosTotales += pasos.length;
	});

	// Inventario: todas las piezas del modelo, agrupadas por pieza y color.
	const cuenta = new Map<string, PiezaLista>();
	for (const p of aplanar(principal, identidad, 16)) {
		const k = `${p.archivo}|${p.color}`;
		const x = cuenta.get(k) ?? {archivo: p.archivo, color: p.color, cantidad: 0};
		x.cantidad++;
		cuenta.set(k, x);
	}
	const elementos = await elementosLEGO();
	plan.inventario = [...cuenta.values()]
		.map((x) => {
			const c = bib.colores.get(x.color);
			return {
				...x,
				titulo: bib.archivo(x.archivo)?.titulo ?? x.archivo,
				colorNombre: c?.nombre.replace(/_/g, ' ') ?? `color ${x.color}`,
				rgb: c?.rgb ?? '888888',
				elemento: elementos.get(`${x.archivo.replace(/\.dat$/, '')}|${x.color}`) ?? null,
			};
		})
		.sort((a, b) => a.colorNombre.localeCompare(b.colorNombre) || a.archivo.localeCompare(b.archivo, undefined, {numeric: true}));

	// Una pieza por paso, en el orden del inventario.
	const lineasPiezas = ['0 Piezas del manual', '0 Name: piezas.ldr'];
	for (const x of plan.inventario) lineasPiezas.push(`1 ${x.color} 0 0 0 1 0 0 0 1 0 0 0 1 ${x.archivo}`, '0 STEP');
	escribir(plan.archivoPiezas, lineasPiezas);

	writeFileSync(join(salida, 'plan.json'), JSON.stringify(plan, null, 2));
	return plan;
}

// Si el archivo se llama como un set ("40271-1.mpd"), su nombre según Rebrickable.
async function nombreDeSet(archivo: string): Promise<string | null> {
	const set = archivo.replace(/\.\w+$/, '');
	if (!/^\d+-\d+$/.test(set)) return null;
	try {
		const lineas = createInterface({input: createReadStream(join(raiz, '.cache/rebrickable/sets.csv.gz')).pipe(createGunzip())});
		for await (const l of lineas) if (l.startsWith(set + ',')) return l.split(',')[1].replace(/^"|"$/g, '');
	} catch {
		// sin datos de Rebrickable
	}
	return null;
}

// "pieza|color" → element ID de LEGO (el número que usa Pick a Brick), desde Rebrickable.
async function elementosLEGO(): Promise<Map<string, string>> {
	const mapa = new Map<string, string>();
	try {
		const lineas = createInterface({input: createReadStream(join(raiz, '.cache/rebrickable/elements.csv.gz')).pipe(createGunzip())});
		for await (const l of lineas) {
			const [elemento, pieza, color] = l.split(',');
			const k = `${pieza}|${color}`;
			if (!mapa.has(k)) mapa.set(k, elemento);
		}
	} catch {
		// Sin datos de Rebrickable el manual sale igual, sin element IDs.
	}
	return mapa;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [ruta, salida] = process.argv.slice(2);
	const plan = await planificar(ruta, salida);
	console.log(
		`${plan.titulo}: ${plan.piezasTotales} piezas, ${plan.pasosTotales} pasos en ${plan.secciones.length} secciones, ` +
			`${plan.inventario.length} tipos de pieza → ${salida}`,
	);
	for (const s of plan.secciones) console.log(`  ${s.numero}. ${s.titulo} (${s.pasos.length} pasos${s.usos > 1 ? `, ×${s.usos}` : ''})`);
}
