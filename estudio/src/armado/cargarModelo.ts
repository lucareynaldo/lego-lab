import {Box3, Group, Object3D, Vector3} from 'three';
import {LDrawLoader} from 'three/examples/jsm/loaders/LDrawLoader.js';
import {LDrawConditionalLineMaterial} from 'three/examples/jsm/materials/LDrawConditionalLineMaterial.js';

export type Pieza = {
	objeto: Object3D;
	paso: number;
	// Posición de reposo (local al padre) y dirección "arriba" del mundo expresada en el espacio del padre.
	reposo: Vector3;
	arribaLocal: Vector3;
};

export type Modelo = {
	raiz: Group;
	pasos: number;
	piezas: Pieza[];
	// Hijos directos de la raíz, en el orden de las líneas del archivo: en un modelo plano, el índice i
	// es la línea de pieza i (las piezas compuestas aportan varias Pieza pero un solo hijo).
	lineas: Object3D[];
	centro: Vector3;
	tamano: Vector3;
};

const TIPOS_PIEZA = new Set(['Part', 'Unofficial_Part']);

// Un modelo se carga una sola vez por pestaña: calculateMetadata y el componente comparten la promesa.
const cache = new Map<string, Promise<Modelo>>();

export function cargarModelo(url: string): Promise<Modelo> {
	let promesa = cache.get(url);
	if (!promesa) {
		promesa = cargar(url);
		cache.set(url, promesa);
	}
	return promesa;
}

async function cargar(url: string): Promise<Modelo> {
	const loader = new LDrawLoader();
	loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
	const raiz = await loader.loadAsync(url);
	// LDraw usa -Y hacia arriba.
	raiz.rotation.x = Math.PI;
	raiz.updateMatrixWorld(true);

	const piezas: Pieza[] = [];
	const arribaMundo = new Vector3(0, 1, 0);
	raiz.traverse((o) => {
		if (!(o as Group).isGroup || !TIPOS_PIEZA.has(o.userData.type)) return;
		const padre = o.parent!;
		const origenPadre = padre.localToWorld(new Vector3(0, 0, 0));
		const arribaLocal = padre.worldToLocal(origenPadre.clone().add(arribaMundo)).normalize();
		piezas.push({objeto: o, paso: o.userData.buildingStep ?? 0, reposo: o.position.clone(), arribaLocal});
	});

	const caja = new Box3().setFromObject(raiz);
	return {
		raiz,
		pasos: raiz.userData.numBuildingSteps ?? 1,
		piezas,
		lineas: raiz.children.filter((c) => (c as Group).isGroup),
		centro: caja.getCenter(new Vector3()),
		tamano: caja.getSize(new Vector3()),
	};
}
