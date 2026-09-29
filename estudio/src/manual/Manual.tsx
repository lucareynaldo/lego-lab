// Imágenes para el manual de instrucciones. Cada fotograma es una imagen:
// - ManualPasos: fotograma k = el paso k de una sección (lo anterior más pálido, lo nuevo en color pleno).
//   Un fotograma extra al final muestra la sección terminada sin resaltar (portada, íconos de sub-armado).
//   Con `detalle`, el encuadre se acerca a lo nuevo del paso (recuadro ampliado del manual).
// - ManualPiezas: fotograma k = la pieza k sola, para las listas de piezas y el inventario.
// Se renderizan como secuencia de PNG (remotion render … --sequence).

import {ThreeCanvas} from '@remotion/three';
import {useThree} from '@react-three/fiber';
import {useEffect, useState} from 'react';
import {AbsoluteFill, CalculateMetadataFunction, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import type {LineSegments, Material, Mesh, OrthographicCamera} from 'three';
import {Box3, Color, ConeGeometry, CylinderGeometry, Euler, Group, Mesh as Malla, MeshBasicMaterial, Quaternion, Sphere, Vector3} from 'three';
import {cargarModelo, Modelo} from '../armado/cargarModelo';

type V3 = [number, number, number];

export type PropsManual = {
	modelo: string; // ruta dentro de public/
	rotaciones?: (V3 | null)[]; // ROTSTEP por paso (grados), si hay
	// Flechas por paso: piezas (índice en el modelo plano) y dirección desde la que llegan (coordenadas LDraw).
	flechas?: {indices: number[]; dir: V3}[][];
	detalle?: boolean; // encuadrar lo nuevo del paso en vez de lo visible
};

export const metadatosManual: CalculateMetadataFunction<PropsManual> = async ({props}) => {
	const m = await cargarModelo(staticFile(props.modelo));
	return {durationInFrames: Math.max(1, m.pasos) + 1};
};

export const metadatosPiezas: CalculateMetadataFunction<PropsManual> = async ({props}) => {
	const m = await cargarModelo(staticFile(props.modelo));
	return {durationInFrames: Math.max(1, m.pasos)};
};

// Un paso con pocas piezas se acerca, pero no más que esto respecto del encuadre del modelo terminado.
const ZOOM_MAX = 2.2;

// Vista isométrica al estilo de las instrucciones: desde adelante-izquierda y arriba.
const DIRECCION_VISTA = new Vector3(-1, 0.9, 1.1).normalize();
// Las cuatro vistas isométricas (desde cada esquina, siempre desde arriba), para el recuadro ampliado.
const VISTAS = [
	DIRECCION_VISTA,
	new Vector3(1, 0.9, 1.1).normalize(),
	new Vector3(1, 0.9, -1.1).normalize(),
	new Vector3(-1, 0.9, -1.1).normalize(),
];
const PALIDEZ = 0.15; // cuánto se acerca al blanco (en sRGB) el color de lo colocado en pasos anteriores
const BORDE_NUEVO = new Color('#ff9f1a'); // bordes de las piezas nuevas del paso

function useModelo(ruta: string) {
	const [modelo, setModelo] = useState<Modelo | null>(null);
	const [handle] = useState(() => delayRender('Cargando modelo', {timeoutInMilliseconds: 10 * 60 * 1000}));
	useEffect(() => {
		cargarModelo(staticFile(ruta)).then((m) => {
			setModelo(m);
			continueRender(handle);
		});
	}, [ruta, handle]);
	return modelo;
}

// Materiales pálidos: se clonan una vez por material original.
const palidos = new WeakMap<Material, Material>();
function palido(m: Material): Material {
	let p = palidos.get(m);
	if (!p) {
		p = m.clone();
		const c = (p as Material & {color?: Color}).color;
		// En sRGB, para que un color oscuro se aclare apenas (en espacio lineal el negro se vuelve gris).
		if (c) c.convertLinearToSRGB().lerp(new Color(1, 1, 1), PALIDEZ).convertSRGBToLinear();
		palidos.set(m, p);
	}
	return p;
}
const originales = new WeakMap<Mesh | LineSegments, Material | Material[]>();
const resaltados = new WeakMap<Material, Material>();
function resaltado(m: Material): Material {
	let r = resaltados.get(m);
	if (!r) {
		r = m.clone();
		(r as Material & {color?: Color}).color?.copy(BORDE_NUEVO);
		resaltados.set(m, r);
	}
	return r;
}
const mapear = (orig: Material | Material[], f: (m: Material) => Material) => (Array.isArray(orig) ? orig.map(f) : f(orig));

function pintar(m: Modelo, pasoActual: number, soloEse: boolean) {
	for (const p of m.piezas) {
		p.objeto.visible = soloEse ? p.paso === pasoActual : p.paso <= pasoActual;
		const anterior = !soloEse && p.paso < pasoActual;
		const nueva = !soloEse && p.paso === pasoActual && pasoActual > 0;
		p.objeto.traverse((o) => {
			const x = o as Mesh | LineSegments;
			if (!(x as Mesh).isMesh && !(x as LineSegments).isLineSegments) return;
			if (!originales.has(x)) originales.set(x, x.material);
			const orig = originales.get(x)!;
			if ((x as Mesh).isMesh) x.material = anterior ? mapear(orig, palido) : orig;
			// Bordes: naranja en las piezas nuevas (menos en el primer paso, que es todo nuevo).
			else x.material = nueva ? mapear(orig, resaltado) : orig;
		});
	}
}

// Cámara ortográfica que encuadra una esfera.
function Encuadre({esfera, margen, direccion = DIRECCION_VISTA}: {esfera: Sphere; margen: number; direccion?: Vector3}) {
	const camera = useThree((s) => s.camera) as OrthographicCamera;
	const {width, height} = useVideoConfig();
	const r = Math.max(esfera.radius, 1);
	camera.position.copy(esfera.center).addScaledVector(direccion, r * 4);
	camera.near = 0.1;
	camera.far = r * 10;
	camera.zoom = Math.min(width, height) / (2 * r * margen);
	camera.lookAt(esfera.center);
	camera.updateProjectionMatrix();
	return null;
}

// Grupo que envuelve al modelo para girarlo (ROTSTEP) alrededor de un centro. Se arma en el render
// y no en un efecto: Remotion puede capturar el primer fotograma antes de que corran los efectos.
const pivotes = new WeakMap<Modelo, Group>();
function pivoteDe(m: Modelo): Group {
	let p = pivotes.get(m);
	if (!p) {
		pivotes.set(m, (p = new Group()));
		p.add(m.raiz);
	}
	return p;
}

// Deja el modelo en su posición de carga, para medirlo sin lo que dejó el fotograma anterior.
function neutralizar(m: Modelo) {
	const p = pivoteDe(m);
	p.position.set(0, 0, 0);
	p.rotation.set(0, 0, 0);
	m.raiz.position.set(0, 0, 0);
	p.updateMatrixWorld(true);
}

function Escena({m, esfera, rotacion}: {m: Modelo; esfera: Sphere; rotacion: [number, number, number] | null}) {
	// ROTSTEP: se gira el modelo alrededor del centro del encuadre; la cámara queda fija.
	const pivote = pivoteDe(m);
	const e = rotacion ?? [0, 0, 0];
	pivote.position.copy(esfera.center);
	m.raiz.position.copy(esfera.center).multiplyScalar(-1);
	pivote.rotation.copy(new Euler(...e.map((g) => (g * Math.PI) / 180) as [number, number, number], 'XYZ'));
	return <primitive object={pivote} />;
}

const Luces = () => (
	<>
		<hemisphereLight args={['#ffffff', '#b0a898', 1.9]} />
		<directionalLight position={[-300, 800, 500]} intensity={1.8} />
		<directionalLight position={[600, 200, -300]} intensity={0.5} />
	</>
);

const ROJO_FLECHA = new MeshBasicMaterial({color: '#e3000b'});
const EJE_Y = new Vector3(0, 1, 0);

// Grupo de flechas colgado del modelo (en coordenadas LDraw), rehecho en cada fotograma.
const gruposFlechas = new WeakMap<Modelo, Group>();
function flechasDe(m: Modelo): Group {
	let g = gruposFlechas.get(m);
	if (!g) {
		gruposFlechas.set(m, (g = new Group()));
		m.raiz.add(g);
	}
	return g;
}

// Arma las flechas del paso y devuelve los puntos extremos (en el mundo, con el modelo neutralizado)
// para que el encuadre las incluya.
function armarFlechas(m: Modelo, flechas: {indices: number[]; dir: V3}[], radioTotal: number): Vector3[] {
	const g = flechasDe(m);
	g.clear();
	const extremos: Vector3[] = [];
	for (const f of flechas) {
		const caja = new Box3();
		for (const i of f.indices) if (m.lineas[i]) caja.expandByObject(m.lineas[i]);
		if (caja.isEmpty()) continue;
		const esfera = caja.getBoundingSphere(new Sphere());
		const centro = m.raiz.worldToLocal(esfera.center.clone()); // a coordenadas LDraw
		const dir = new Vector3(...f.dir).normalize();
		const grosor = Math.max(1.2, radioTotal * 0.01);
		const largo = Math.max(24, esfera.radius * 1.2);
		const punta = centro.clone().addScaledVector(dir, esfera.radius + 4);
		const cola = punta.clone().addScaledVector(dir, largo);
		const haciaPieza = dir.clone().negate();
		const q = new Quaternion().setFromUnitVectors(EJE_Y, haciaPieza);
		const altoPunta = grosor * 6;
		const vara = new Malla(new CylinderGeometry(grosor, grosor, largo - altoPunta, 12), ROJO_FLECHA);
		vara.position.copy(cola).addScaledVector(haciaPieza, (largo - altoPunta) / 2);
		vara.quaternion.copy(q);
		const cabeza = new Malla(new ConeGeometry(grosor * 2.6, altoPunta, 16), ROJO_FLECHA);
		cabeza.position.copy(punta).addScaledVector(dir, altoPunta / 2);
		cabeza.quaternion.copy(q);
		g.add(vara, cabeza);
		extremos.push(m.raiz.localToWorld(cola.clone()), m.raiz.localToWorld(punta.clone()));
	}
	return extremos;
}

export const ManualPasos: React.FC<PropsManual> = ({modelo, rotaciones, flechas, detalle}) => {
	const frame = useCurrentFrame();
	const {width, height} = useVideoConfig();
	const m = useModelo(modelo);
	const final = m !== null && frame >= m.pasos;
	if (m) pintar(m, final ? m.pasos : frame, final);
	if (m && final) for (const p of m.piezas) p.objeto.visible = true;
	// Encuadre: lo visible en el paso, con un tope de acercamiento respecto del modelo terminado.
	let esfera: Sphere | null = null;
	let direccion = DIRECCION_VISTA;
	if (m) {
		neutralizar(m);
		const total = new Sphere(m.centro.clone(), m.tamano.length() / 2);
		const caja = new Box3();
		for (const p of m.piezas) if (p.objeto.visible && (!detalle || p.paso === frame)) caja.expandByObject(p.objeto);
		const extremos = final ? (flechasDe(m).clear(), []) : armarFlechas(m, flechas?.[frame] ?? [], total.radius);
		for (const e of extremos) caja.expandByPoint(e);
		if (detalle && !caja.isEmpty()) {
			// Recuadro ampliado: lo nuevo con aire alrededor para ver dónde va.
			const s = caja.getBoundingSphere(new Sphere());
			esfera = new Sphere(s.center, Math.max(s.radius * 1.6, 30));
			// Lo nuevo puede quedar del otro lado del modelo: se elige la vista isométrica que lo enfrenta.
			const haciaLoNuevo = s.center.clone().sub(total.center).normalize();
			direccion = VISTAS.reduce((mejor, v) => (v.dot(haciaLoNuevo) > mejor.dot(haciaLoNuevo) ? v : mejor));
		} else {
			const visible = final || caja.isEmpty() ? total : caja.getBoundingSphere(new Sphere());
			esfera = new Sphere(visible.center, Math.max(visible.radius, total.radius / ZOOM_MAX));
		}
	}
	return (
		<AbsoluteFill style={{background: '#ffffff'}}>
			<ThreeCanvas width={width} height={height} orthographic camera={{position: [0, 0, 1000]}}>
				<Luces />
				{m && esfera ? (
					<>
						<Encuadre esfera={esfera} margen={1.08} direccion={direccion} />
						<Escena m={m} esfera={esfera} rotacion={rotaciones?.[frame] ?? null} />
					</>
				) : null}
			</ThreeCanvas>
		</AbsoluteFill>
	);
};

export const ManualPiezas: React.FC<PropsManual> = ({modelo}) => {
	const frame = useCurrentFrame();
	const {width, height} = useVideoConfig();
	const m = useModelo(modelo);
	if (m) pintar(m, frame, true);
	let esfera: Sphere | null = null;
	if (m) {
		const caja = new Box3();
		for (const p of m.piezas) if (p.paso === frame) caja.expandByObject(p.objeto);
		esfera = caja.getBoundingSphere(new Sphere());
	}
	return (
		<AbsoluteFill style={{background: '#ffffff'}}>
			<ThreeCanvas width={width} height={height} orthographic camera={{position: [0, 0, 1000]}}>
				<Luces />
				{m && esfera ? (
					<>
						<Encuadre esfera={esfera} margen={1.02} />
						<primitive object={m.raiz} />
					</>
				) : null}
			</ThreeCanvas>
		</AbsoluteFill>
	);
};
