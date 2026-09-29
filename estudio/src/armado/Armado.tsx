import {ThreeCanvas} from '@remotion/three';
import {useThree} from '@react-three/fiber';
import {useEffect, useState} from 'react';
import type {PerspectiveCamera} from 'three';
import {
	AbsoluteFill,
	CalculateMetadataFunction,
	Easing,
	continueRender,
	delayRender,
	interpolate,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion';
import {cargarModelo, Modelo} from './cargarModelo';

export type PropsArmado = {
	modelo: string; // ruta dentro de public/, p. ej. "modelos/40014-1.packed.mpd"
	cuadrosPorPaso: number;
	cuadrosCaida: number;
};

export const INTRO = 15;
export const FINAL = 75;

export const calcularMetadatos: CalculateMetadataFunction<PropsArmado> = async ({props}) => {
	const m = await cargarModelo(staticFile(props.modelo));
	return {durationInFrames: INTRO + m.pasos * props.cuadrosPorPaso + FINAL};
};

// Altura (en LDU, 1 ladrillo = 24) desde la que cae cada pieza nueva.
const ALTURA_CAIDA = 160;

function aplicarPaso(m: Modelo, frame: number, props: PropsArmado) {
	const t = frame - INTRO;
	const pasoActual = Math.floor(t / props.cuadrosPorPaso);
	const enPaso = t - pasoActual * props.cuadrosPorPaso;
	const caida = interpolate(enPaso, [0, props.cuadrosCaida], [1, 0], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
		easing: Easing.out(Easing.cubic),
	});
	for (const p of m.piezas) {
		p.objeto.visible = p.paso <= pasoActual;
		p.objeto.position.copy(p.reposo);
		if (p.paso === pasoActual) p.objeto.position.addScaledVector(p.arribaLocal, ALTURA_CAIDA * caida);
	}
}

function Camara({m}: {m: Modelo}) {
	const frame = useCurrentFrame();
	const {durationInFrames} = useVideoConfig();
	const camera = useThree((s) => s.camera) as PerspectiveCamera;
	// Distancia para que la esfera envolvente entre en el campo más angosto (el horizontal, en vertical).
	const esfera = m.tamano.length() / 2;
	const fovV = (camera.fov * Math.PI) / 180;
	const fovH = 2 * Math.atan(Math.tan(fovV / 2) * camera.aspect);
	const distancia = (esfera / Math.sin(Math.min(fovV, fovH) / 2)) * 1.08;
	const angulo = interpolate(frame, [0, durationInFrames], [-0.9, 0.5]);
	const elevacion = 0.5;
	camera.position.set(
		m.centro.x + Math.sin(angulo) * Math.cos(elevacion) * distancia,
		m.centro.y + Math.sin(elevacion) * distancia,
		m.centro.z + Math.cos(angulo) * Math.cos(elevacion) * distancia,
	);
	camera.lookAt(m.centro);
	return null;
}

export const Armado: React.FC<PropsArmado> = (props) => {
	const frame = useCurrentFrame();
	const {width, height} = useVideoConfig();
	const [modelo, setModelo] = useState<Modelo | null>(null);
	const [handle] = useState(() => delayRender('Cargando modelo LDraw', {timeoutInMilliseconds: 10 * 60 * 1000}));

	useEffect(() => {
		cargarModelo(staticFile(props.modelo)).then((m) => {
			setModelo(m);
			continueRender(handle);
		});
	}, [props.modelo, handle]);

	if (modelo) aplicarPaso(modelo, frame, props);

	return (
		<AbsoluteFill style={{background: 'linear-gradient(#f4efe6, #e2d8c6)'}}>
			<ThreeCanvas width={width} height={height} camera={{fov: 30, near: 1, far: 20000}}>
				<hemisphereLight args={['#ffffff', '#8a7f6e', 1.6]} />
				<directionalLight position={[300, 800, 500]} intensity={2.2} />
				<directionalLight position={[-600, 300, -200]} intensity={0.6} />
				{modelo ? (
					<>
						<Camara m={modelo} />
						<primitive object={modelo.raiz} />
					</>
				) : null}
			</ThreeCanvas>
		</AbsoluteFill>
	);
};
