// Uso: node src/cli.ts <modelo.mpd>... [--json <carpeta>] [--sin-rebrickable]
//
// Salida: resumen en consola y, con --json, un reporte <modelo>.json por archivo.
// Código de salida: 0 sin errores, 1 si algún modelo tiene errores.

import {createReadStream, existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {createGunzip} from 'node:zlib';
import {Biblioteca} from './ldraw.ts';
import type {Hallazgo} from './verificar.ts';
import {verificar} from './verificar.ts';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIR_LDRAW = process.env.LDRAW_DIR ?? join(raiz, '.cache/ldraw');
const DIR_SOMBRA = process.env.LDCAD_SHADOW_DIR ?? join(raiz, '.cache/LDCadShadowLibrary-main');
const INVENTARIOS = join(raiz, '.cache/rebrickable/inventory_parts.csv.gz');

async function combinacionesConocidas(): Promise<Set<string> | undefined> {
	if (!existsSync(INVENTARIOS)) return undefined;
	const set = new Set<string>();
	const lineas = createInterface({input: createReadStream(INVENTARIOS).pipe(createGunzip())});
	for await (const l of lineas) {
		const [, pieza, color] = l.split(',');
		set.add(`${pieza}|${color}`);
	}
	return set;
}

const args = process.argv.slice(2);
const modelos = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--json');
const dirJson = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
if (modelos.length === 0) {
	console.error('Uso: node src/cli.ts <modelo.mpd>... [--json <carpeta>] [--sin-rebrickable]');
	process.exit(2);
}

const combinaciones = args.includes('--sin-rebrickable') ? undefined : await combinacionesConocidas();
let conErrores = 0;

for (const ruta of modelos) {
	const inicio = Date.now();
	const bib = new Biblioteca(DIR_LDRAW, DIR_SOMBRA);
	const principal = bib.cargarModelo(ruta, basename(ruta));
	const r = verificar(bib, principal, {combinacionesConocidas: combinaciones});
	const errores = r.hallazgos.filter((h) => h.severidad === 'error');
	const avisos = r.hallazgos.filter((h) => h.severidad === 'aviso');
	if (errores.length > 0) conErrores++;

	const seg = ((Date.now() - inicio) / 1000).toFixed(1);
	console.log(
		`\n${errores.length === 0 ? 'OK   ' : 'FALLA'} ${basename(ruta)} · ${r.piezas} piezas · ${r.pasos} pasos · ` +
			`${r.conexiones} conexiones · ~${r.masaEstimadaG} g · ${seg} s`,
	);
	if (r.piezasSinConectores.length > 0)
		console.log(`      sin datos de conexión: ${r.piezasSinConectores.join(', ')}`);
	for (const [sev, lista] of [['error', errores], ['aviso', avisos]] as const) {
		const porRegla = new Map<string, Hallazgo[]>();
		for (const h of lista) porRegla.set(h.regla, [...(porRegla.get(h.regla) ?? []), h]);
		for (const [regla, hs] of porRegla) {
			console.log(`  ${sev === 'error' ? '✗' : '·'} ${regla} (${hs.length})`);
			for (const h of hs.slice(0, 3)) {
				const donde = h.submodelo ? ` [${h.submodelo}${h.paso ? ` paso ${h.paso}` : ''}]` : '';
				console.log(`      ${h.mensaje}${donde}`);
			}
			if (hs.length > 3) console.log(`      … y ${hs.length - 3} más`);
		}
	}
	if (dirJson) {
		mkdirSync(dirJson, {recursive: true});
		writeFileSync(join(dirJson, basename(ruta).replace(/\.\w+$/, '') + '.json'), JSON.stringify(r, null, 2));
	}
}

console.log(`\n${modelos.length - conErrores}/${modelos.length} modelos sin errores`);
process.exitCode = conErrores > 0 ? 1 : 0;
