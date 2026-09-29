import assert from 'node:assert/strict';
import {join} from 'node:path';
import {test} from 'node:test';
import {RAIZ} from '../../src/entorno.ts';
import {metricas} from '../../src/metricas.ts';

test('métricas de un set de prueba', {timeout: 20 * 60 * 1000}, async () => {
	const m = await metricas(join(RAIZ, 'referencias/sets-test/modelos/40014-1.mpd'));
	assert.ok(m.piezas > 0 && m.pasos > 0);
	assert.ok(m.fractal > 1 && m.fractal < 2, `fractal ${m.fractal}`);
	assert.ok(m.cambioSilueta.media > 0);
	assert.ok(m.noBasicas >= 0 && m.noBasicas <= 1);
	// Si la visibilidad por paso no funcionara (todo visible siempre), solo el primer cuadro cambiaría.
	assert.ok(m.cambioSilueta.pasosInvisibles < m.cambioSilueta.cuadros - 1, JSON.stringify(m.cambioSilueta));
});
