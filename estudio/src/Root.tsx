import {Composition, Folder} from 'remotion';
import {Armado, calcularMetadatos, PropsArmado} from './armado/Armado';
import {ManualPasos, ManualPiezas, metadatosManual, metadatosPiezas} from './manual/Manual';
import {metadatosVistas, PropsVistas, Vistas} from './taller/Vistas';

// Sets oficiales: solo uso interno, como banco de pruebas. Nunca se publican.
const SETS_TEST = ['40014-1', '40011-1', '40271-1', '40425-1', '8259-1', '3180-1', '7636-1', '42048-1', '4955-1', '10226-1'];

export const Root = () => (
	<>
	<Folder name="manual">
		<Composition id="manual-pasos" component={ManualPasos} width={1200} height={900} fps={30} durationInFrames={1} defaultProps={{modelo: 'manual/seccion.packed.mpd'}} calculateMetadata={metadatosManual} />
		<Composition id="manual-detalles" component={ManualPasos} width={600} height={600} fps={30} durationInFrames={1} defaultProps={{modelo: 'manual/seccion.packed.mpd', detalle: true}} calculateMetadata={metadatosManual} />
		<Composition id="manual-piezas" component={ManualPiezas} width={300} height={300} fps={30} durationInFrames={1} defaultProps={{modelo: 'manual/piezas.packed.mpd'}} calculateMetadata={metadatosPiezas} />
	</Folder>
	<Folder name="sets-test">
		{SETS_TEST.map((set) => (
			<Composition
				key={set}
				id={`test-${set}`}
				component={Armado}
				width={1080}
				height={1920}
				fps={30}
				durationInFrames={300}
				defaultProps={{modelo: `modelos/${set}.packed.mpd`, cuadrosPorPaso: 18, cuadrosCaida: 12}}
				calculateMetadata={calcularMetadatos}
			/>
		))}
	</Folder>
	<Folder name="taller">
		<Composition
			id="taller-vistas"
			component={Vistas}
			width={512}
			height={512}
			fps={30}
			durationInFrames={1}
			defaultProps={{modelo: 'modelos/40014-1.packed.mpd', vistas: ['34', 'frente', 'lado', '34atras'], lado: 512, modo: 'color'} satisfies PropsVistas}
			calculateMetadata={metadatosVistas}
		/>
	</Folder>
	</>
);
