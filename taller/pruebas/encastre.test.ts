import assert from 'node:assert/strict';
import {test} from 'node:test';
import {transformarConector} from '../../verificador/src/conectores.ts';
import {conexiones} from '../../verificador/src/conexiones.ts';
import type {ConectorUbicado} from '../../verificador/src/conexiones.ts';
import type {Transform, Vec3} from '../../verificador/src/matematica.ts';
import {aplicar, aplicarR, determinante, IDENTIDAD} from '../../verificador/src/matematica.ts';
import {encastrar, parsearRot, rotacionEntre} from '../src/encastre.ts';
import {biblioteca} from '../src/entorno.ts';
import {conectoresPieza, ficha, puntoGrilla} from '../src/ficha.ts';

const cerca = (a: Vec3, b: Vec3) => a.every((x, i) => Math.abs(x - b[i]) < 1e-6);

test('rotacionEntre lleva a en b, incluso opuestos', () => {
	const casos: [Vec3, Vec3][] = [[[0, -1, 0], [1, 0, 0]], [[0, -1, 0], [0, 1, 0]], [[1, 0, 0], [1, 0, 0]], [[0, 0, 1], [0.6, 0, 0.8]]];
	for (const [a, b] of casos) {
		const r = rotacionEntre(a, b);
		assert.ok(cerca(aplicarR(r, a), b), `${a} → ${b}`);
		assert.ok(Math.abs(determinante(r) - 1) < 1e-9);
	}
});

test('parsearRot aplica de izquierda a derecha', () => {
	const r = parsearRot('X90 Y90');
	// (0,0,1) → X90 → (0,-1,0) → Y90 → (0,-1,0)
	assert.ok(cerca(aplicarR(r, [0, 0, 1]), [0, -1, 0]));
	assert.throws(() => parsearRot('W90'), /rotación inválida/);
});

test('3001 sobre 3001, stud (0,0) con anti-stud (0,0): 24 LDU más arriba', () => {
	const bib = biblioteca();
	const f = ficha(bib, '3001');
	const cs = conectoresPieza(bib, '3001.dat');
	const base = IDENTIDAD;
	const tr = encastrar(base, cs[puntoGrilla(f.studs, [0, 0], 'stud').n], cs[puntoGrilla(f.antistuds, [0, 0], 'anti-stud').n]);
	assert.deepEqual(tr.r, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
	assert.ok(cerca(tr.t, [0, -24, 0]));
});

test('el resultado conecta según el verificador, también con giro', () => {
	const bib = biblioteca();
	const f = ficha(bib, '3003');
	const cs = conectoresPieza(bib, '3003.dat');
	const base: Transform = {r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [20, 0, 40]};
	for (const giro of [0, 90, 180, 270]) {
		const tr = encastrar(base, cs[puntoGrilla(f.studs, [1, 1], 'stud').n], cs[puntoGrilla(f.antistuds, [0, 0], 'anti-stud').n], giro);
		assert.ok(tr.r.every((x) => [0, 1, -1].includes(x)), `matriz limpia con giro ${giro}`);
		const ubicados: ConectorUbicado[] = [];
		for (const [pieza, t] of [[0, base], [1, tr]] as const)
			for (const c of cs) {
				const w = transformarConector(c, t);
				if (w) ubicados.push({pieza, c: w});
			}
		assert.ok(conexiones(ubicados).some((x) => (x.a === 0 && x.b === 1) || (x.a === 1 && x.b === 0)), `giro ${giro}`);
		assert.ok(cerca(aplicar(tr, cs[puntoGrilla(f.antistuds, [0, 0], 'anti-stud').n].base), aplicar(base, cs[puntoGrilla(f.studs, [1, 1], 'stud').n].base)));
	}
});

test('3008 sobre 3008 conecta según el verificador', () => {
	const bib = biblioteca();
	const f = ficha(bib, '3008');
	const cs = conectoresPieza(bib, '3008.dat');
	const tr = encastrar(IDENTIDAD, cs[puntoGrilla(f.studs, [0, 0], 'stud').n], cs[puntoGrilla(f.antistuds, [0, 0], 'anti-stud').n]);
	assert.ok(cerca(tr.t, [0, -24, 0]));
	const ubicados: ConectorUbicado[] = [];
	for (const [pieza, t] of [[0, IDENTIDAD], [1, tr]] as const)
		for (const c of cs) {
			const w = transformarConector(c, t);
			if (w) ubicados.push({pieza, c: w});
		}
	assert.ok(conexiones(ubicados).some((x) => x.a !== x.b));
});
