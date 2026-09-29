import {mezclar, mulberry32} from './azar.ts';

export type Nivel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type Corrida = {id: string; nivel: Nivel; orden: number};

const NIVELES: Nivel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export function planCorridas(semilla = 20260929, porNivel = 5): Corrida[] {
	const niveles = NIVELES.flatMap((n) => Array.from({length: porNivel}, () => n));
	// la permutación decide qué nivel toca en cada posición de ejecución
	return mezclar(niveles, mulberry32(semilla)).map((nivel, i) => ({
		id: `r${String(i + 1).padStart(2, '0')}`,
		nivel,
		orden: i,
	}));
}
