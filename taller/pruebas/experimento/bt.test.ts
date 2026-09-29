import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mulberry32} from '../../src/experimento/azar.ts';
import {ajustarBT, bootstrapBT, bootstrapMedia, kappa, kendallTau, wilson, type Comparacion} from '../../src/experimento/bt.ts';

function simular(theta: number[], nu: number, cuantas: number, azar: () => number): Comparacion[] {
	const comps: Comparacion[] = [];
	for (let k = 0; k < cuantas; k++) {
		const i = Math.floor(azar() * theta.length);
		let j = Math.floor(azar() * (theta.length - 1));
		if (j >= i) j++;
		const pi = Math.exp(theta[i]!);
		const pj = Math.exp(theta[j]!);
		const t = nu * Math.sqrt(pi * pj);
		const d = pi + pj + t;
		const u = azar();
		comps.push({i, j, resultado: u < pi / d ? 'i' : u < (pi + pj) / d ? 'j' : 'empate'});
	}
	return comps;
}

test('ajustarBT recupera θ = [-1, 0, 1] y ν', () => {
	const comps = simular([-1, 0, 1], 0.3, 3000, mulberry32(20260929));
	const {theta, nu} = ajustarBT(3, comps);
	[-1, 0, 1].forEach((v, a) => assert.ok(Math.abs(theta[a]! - v) < 0.15, `θ${a}=${theta[a]}`));
	assert.ok(Math.abs(nu - 0.3) < 0.1, `ν=${nu}`);
});

test('bootstrapBT: IC contiene el verdadero y pSuperior ordena', () => {
	const comps = simular([-1, 0, 1], 0.3, 600, mulberry32(7));
	const r = bootstrapBT(3, comps, 200, mulberry32(1));
	[-1, 0, 1].forEach((v, a) => assert.ok(r.ic[a]![0] <= v && v <= r.ic[a]![1], `IC${a}=${r.ic[a]}`));
	assert.ok(r.pSuperior[2]![0]! > 0.95);
	assert.ok(r.pSuperior[0]![2]! < 0.05);
});

test('bootstrapMedia', () => {
	const r = bootstrapMedia([1, 2, 3, 4, 5], 2000, mulberry32(3));
	assert.equal(r.media, 3);
	assert.ok(r.ic[0] < 3 && 3 < r.ic[1]);
});

test('wilson', () => {
	assert.ok(wilson(5, 5)[0] > 0.5);
	assert.equal(wilson(5, 5)[1], 1);
	const [lo, hi] = wilson(5, 10);
	assert.ok(lo < 0.5 && hi > 0.5);
});

test('kappa de Cohen', () => {
	assert.equal(kappa(['a', 'b', 'a'], ['a', 'b', 'a']), 1);
	assert.ok(Math.abs(kappa(['a', 'a', 'b', 'b'], ['a', 'b', 'a', 'b'])) < 1e-9);
	assert.equal(kappa(['a', 'a'], ['a', 'a']), 1);
});

test('kendallTau', () => {
	assert.equal(kendallTau([1, 2, 3], [3, 2, 1]), -1);
	assert.equal(kendallTau([1, 2, 3], [1, 2, 3]), 1);
	assert.ok(kendallTau([1, 2, 2, 3], [1, 2, 3, 4]) > 0.8);
});

test('separación completa: θ finito, ordenado y estable con más iteraciones', () => {
	const azar = mulberry32(11);
	const comps: Comparacion[] = [];
	for (let k = 0; k < 60; k++) comps.push({i: 0, j: 1 + Math.floor(azar() * 4), resultado: 'i'});
	const a = ajustarBT(5, comps, 4000);
	const b = ajustarBT(5, comps, 40000);
	assert.ok(a.theta.every(Number.isFinite));
	assert.ok(a.theta.slice(1).every(t => a.theta[0]! > t));
	a.theta.forEach((t, k) => assert.ok(Math.abs(t - b.theta[k]!) < 1e-3));
	const r = bootstrapBT(5, comps, 50, mulberry32(2));
	assert.ok(r.ic.every(([lo, hi]) => Number.isFinite(lo) && Number.isFinite(hi)));
});

test('réplica con arranque en caliente = ajuste en frío', () => {
	const azar = mulberry32(5);
	const comps = simular([-1, 0, 1], 0.3, 400, azar);
	const base = ajustarBT(3, comps);
	const rem = Array.from({length: comps.length}, () => comps[Math.floor(azar() * comps.length)]!);
	const caliente = ajustarBT(3, rem, 200, undefined, base);
	const frio = ajustarBT(3, rem);
	caliente.theta.forEach((t, k) => assert.ok(Math.abs(t - frio.theta[k]!) < 1e-3));
	assert.ok(Math.abs(caliente.nu - frio.nu) < 1e-3);
});
