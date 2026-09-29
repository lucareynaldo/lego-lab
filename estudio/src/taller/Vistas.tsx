// Vistas para el taller de diseño: una grilla de vistas ortográficas del modelo en una sola imagen.
// El encuadre es siempre el del modelo completo, para que las imágenes de distintos pasos sean
// comparables (la métrica de cambio de silueta las resta píxel a píxel).

import {ThreeCanvas} from '@remotion/three';
import {useThree} from '@react-three/fiber';
import {useEffect, useMemo, useState} from 'react';
import {AbsoluteFill, CalculateMetadataFunction, continueRender, delayRender, staticFile} from 'remotion';
import type {Group, LineSegments, Mesh, Object3D, OrthographicCamera} from 'three';
import {Box3, MeshBasicMaterial, Sphere, Vector3} from 'three';
import {cargarModelo, Modelo} from '../armado/cargarModelo';

export type PropsVistas = {
	modelo: string; // ruta dentro de public/
	vistas: string[];
	lado: number; // píxeles por vista
	modo: 'color' | 'silueta';
	paso?: number; // base 0: lo colocado hasta ese paso inclusive; sin paso, todo
};

// Direcciones en el mundo de three (el modelo se carga girado π en X: el frente LDraw, −Z, queda en +Z).
const DIRECCIONES: Record<string, {dir: Vector3; arriba: Vector3}> = {
	'34': {dir: new Vector3(-1, 0.9, 1.1).normalize(), arriba: new Vector3(0, 1, 0)},
	'34atras': {dir: new Vector3(1, 0.9, -1.1).normalize(), arriba: new Vector3(0, 1, 0)},
	frente: {dir: new Vector3(0, 0, 1), arriba: new Vector3(0, 1, 0)},
	lado: {dir: new Vector3(1, 0, 0), arriba: new Vector3(0, 1, 0)},
	arriba: {dir: new Vector3(0, 1, 0), arriba: new Vector3(0, 0, -1)},
};

const columnasPara = (n: number) => (n <= 2 ? n : n <= 4 ? 2 : 3);

export const metadatosVistas: CalculateMetadataFunction<PropsVistas> = async ({props}) => {
	const n = Math.max(1, props.vistas.length);
	const columnas = columnasPara(n);
	return {width: columnas * props.lado, height: Math.ceil(n / columnas) * props.lado, durationInFrames: 1};
};

const NEGRO = new MeshBasicMaterial({color: '#000000'});

const Luces = () => (
	<>
		<hemisphereLight args={['#ffffff', '#b0a898', 1.9]} />
		<directionalLight position={[-300, 800, 500]} intensity={1.8} />
		<directionalLight position={[600, 200, -300]} intensity={0.5} />
	</>
);

function Camara({esfera, dir, arriba, lado}: {esfera: Sphere; dir: Vector3; arriba: Vector3; lado: number}) {
	const camera = useThree((s) => s.camera) as OrthographicCamera;
	const r = Math.max(esfera.radius, 1);
	camera.position.copy(esfera.center).addScaledVector(dir, r * 4);
	camera.up.copy(arriba);
	camera.near = 0.1;
	camera.far = r * 10;
	camera.zoom = lado / (2 * r * 1.05);
	camera.lookAt(esfera.center);
	camera.updateProjectionMatrix();
	return null;
}

// Copia del modelo para una vista (un objeto de three no puede estar en dos escenas), con la
// visibilidad del paso y, en modo silueta, todo negro y sin bordes.
function copiaPara(m: Modelo, paso: number | undefined, modo: PropsVistas['modo']): Object3D {
	const raiz = m.raiz.clone();
	// LDrawLoader numera los pasos en un solo recorrido en profundidad, así que los pasos internos de un
	// submodelo son posteriores al del grupo que lo coloca: hay que mirar todos los grupos, no solo los
	// hijos de la raíz.
	if (paso !== undefined)
		raiz.traverse((o) => {
			if (o !== raiz && (o as Group).isGroup) o.visible = (o.userData.buildingStep ?? 0) <= paso;
		});
	if (modo === 'silueta')
		raiz.traverse((o) => {
			if ((o as Mesh).isMesh) (o as Mesh).material = NEGRO;
			else if ((o as LineSegments).isLineSegments) o.visible = false;
		});
	return raiz;
}

export const Vistas: React.FC<PropsVistas> = ({modelo, vistas, lado, modo, paso}) => {
	const [m, setM] = useState<Modelo | null>(null);
	const [handle] = useState(() => delayRender('Cargando modelo', {timeoutInMilliseconds: 10 * 60 * 1000}));
	useEffect(() => {
		cargarModelo(staticFile(modelo)).then((x) => {
			setM(x);
			continueRender(handle);
		});
	}, [modelo, handle]);
	const esfera = useMemo(() => (m ? new Box3().setFromObject(m.raiz).getBoundingSphere(new Sphere()) : null), [m]);
	const columnas = columnasPara(Math.max(1, vistas.length));
	return (
		<AbsoluteFill style={{background: '#ffffff', display: 'grid', gridTemplateColumns: `repeat(${columnas}, ${lado}px)`, gridAutoRows: `${lado}px`}}>
			{m && esfera
				? vistas.map((v) => {
						const d = DIRECCIONES[v] ?? DIRECCIONES['34'];
						return (
							<ThreeCanvas key={v} width={lado} height={lado} orthographic camera={{position: [0, 0, 1000]}}>
								{modo === 'color' ? <Luces /> : null}
								<Camara esfera={esfera} dir={d.dir} arriba={d.arriba} lado={lado} />
								<primitive object={copiaPara(m, paso, modo)} />
							</ThreeCanvas>
						);
					})
				: null}
		</AbsoluteFill>
	);
};
