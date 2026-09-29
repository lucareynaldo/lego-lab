import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mulberry32} from '../../src/experimento/azar.ts';
import {degradar} from '../../src/experimento/degradar.ts';

const M = '1 0 0 0 1 0 0 0 1 0 0 0 1';
const piezas = Array.from({length: 20}, (_, i) => `1 ${i % 3 === 0 ? 4 : 1} ${i} 0 0 ${M.slice(8)} ${3000 + i}.dat`);
const mpd = ['0 FILE main.ldr', '1 4 0 0 0 1 0 0 0 1 0 0 0 1 sub.ldr', '1 1 0 0 0 1 0 0 0 1 0 0 0 1 interno.ldr', ...piezas, '0 FILE sub.ldr', ...piezas.slice(0, 10), '0 FILE interno.ldr', '1 2 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat', ''].join('\r\n');
const esPieza = (l: string) => /^1 .* \S+\.dat\s*$/.test(l);
const contar = (t: string) => t.split(/\r?\n/).filter(esPieza).length;
const total = contar(mpd);

test('quitar deja el 70 % y no toca submodelos ni FILE', () => {
	const r = degradar(mpd, 'quitar', mulberry32(1));
	assert.ok(Math.abs(contar(r) - 0.7 * total) <= 1);
	assert.equal(r.split(/\r?\n/).filter((l) => /\.ldr\s*$/.test(l) && l.startsWith('1 ')).length, 2);
	assert.equal(r.split(/\r?\n/).filter((l) => l.startsWith('0 FILE')).length, 3);
});

test('recolorear cambia exactamente round(0.5·n) colores', () => {
	const r = degradar(mpd, 'recolorear', mulberry32(2)).split('\n');
	const o = mpd.split('\n');
	const cambiadas = o.filter((l, i) => l !== r[i]);
	assert.equal(cambiadas.length, Math.round(0.5 * total));
	o.forEach((l, i) => {
		if (l === r[i]) return;
		const a = l.trim().split(/\s+/);
		const b = r[i]!.trim().split(/\s+/);
		assert.ok(esPieza(l) && a[1] !== b[1] && [1, 2, 4, 14, 15, 0, 71, 70].includes(Number(b[1])));
		assert.deepEqual([a.slice(0, 1), a.slice(2)], [b.slice(0, 1), b.slice(2)]);
	});
});

test('tosca deja las piezas en 3005.dat con la misma matriz', () => {
	const r = degradar(mpd, 'tosca', mulberry32(3)).split('\n');
	const o = mpd.split('\n');
	let n = 0;
	o.forEach((l, i) => {
		if (!esPieza(l)) return assert.equal(r[i], l);
		n++;
		assert.equal(r[i], l.replace(/\S+\.dat(\s*)$/, '3005.dat$1'));
	});
	assert.equal(n, total);
});

test('el mismo azar da el mismo resultado', () => {
	for (const t of ['quitar', 'recolorear', 'tosca'] as const) assert.equal(degradar(mpd, t, mulberry32(9)), degradar(mpd, t, mulberry32(9)));
});
