import {Config} from '@remotion/cli/config';

// three.js necesita WebGL en el Chrome headless; ANGLE funciona sin GPU dedicada.
Config.setChromiumOpenGlRenderer('angle');
