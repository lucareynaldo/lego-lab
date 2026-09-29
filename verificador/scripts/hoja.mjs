// Hoja de contacto de hallazgos: arma la vista de cada uno (vista.ts), la renderiza con el estudio
// (un solo bundle para todas) y las junta en una imagen etiquetada.
//
// Uso: node scripts/hoja.mjs <carpeta de reportes .json> <regla> [máximo=12] [filtro de mensaje]
// Salida: ../estudio/salida/hojas/<regla>.png

import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, '../..');
const estudio = join(raiz, 'estudio');
const [carpeta, regla, maxTxt, filtro] = process.argv.slice(2);
const maximo = Number(maxTxt ?? 12);

const casos = [];
for (const f of readdirSync(carpeta).filter((x) => x.endsWith('.json')).sort()) {
	const r = JSON.parse(readFileSync(join(carpeta, f), 'utf8'));
	r.hallazgos.forEach((h, i) => {
		if (h.regla === regla && (!filtro || h.mensaje.includes(filtro))) casos.push({set: f.replace('.json', ''), i, mensaje: h.mensaje});
	});
}
// Uno por modelo primero, para ver variedad.
const vistos = new Set();
const elegidos = [...casos.filter((c) => !vistos.has(c.set) && vistos.add(c.set)), ...casos].filter((c, k, a) => a.indexOf(c) === k).slice(0, maximo);

const trabajos = [];
const tmp = join(raiz, '.cache/hoja');
mkdirSync(tmp, {recursive: true});
for (const [k, c] of elegidos.entries()) {
	const ldr = join(tmp, `h${k}.ldr`);
	const modelo = join(raiz, '.cache/omr', `${c.set}.mpd`);
	execFileSync(process.execPath, ['--no-warnings', join(aqui, '../src/vista.ts'), modelo, join(carpeta, `${c.set}.json`), String(c.i), ldr, '60']);
	const empaquetado = join(estudio, 'public/modelos', `hoja-${k}.packed.mpd`);
	execFileSync(process.execPath, [join(estudio, 'scripts/empaquetar.mjs'), ldr, empaquetado]);
	trabajos.push({
		composicion: 'test-40014-1',
		props: {modelo: `modelos/hoja-${k}.packed.mpd`, cuadrosPorPaso: 18, cuadrosCaida: 12},
		salida: join(estudio, 'salida/hoja', `h${k}`),
		fotogramas: [107],
	});
}
writeFileSync(join(tmp, 'trabajos.json'), JSON.stringify(trabajos));
execFileSync(process.execPath, [join(estudio, 'scripts/render-secuencias.mjs'), join(tmp, 'trabajos.json')], {cwd: estudio, stdio: 'ignore'});
writeFileSync(join(tmp, 'etiquetas.json'), JSON.stringify(elegidos.map((c, k) => ({img: join(estudio, 'salida/hoja', `h${k}`, 'element-107.png'), texto: `${c.set}: ${c.mensaje}`.slice(0, 110)}))));
mkdirSync(join(estudio, 'salida/hojas'), {recursive: true});
const salida = join(estudio, 'salida/hojas', `${regla}.png`);
execFileSync('py', ['-c', `
import json
from PIL import Image, ImageDraw
e=json.load(open(r'${join(tmp, 'etiquetas.json')}',encoding='utf-8'))
W,H=420,420
hoja=Image.new('RGB',(W*3,H*((len(e)+2)//3)),'white')
for k,x in enumerate(e):
  im=Image.open(x['img']).crop((90,510,990,1410)).resize((W,H))
  d=ImageDraw.Draw(im); d.rectangle((0,0,W,34),fill='white')
  t=x['texto']; d.text((4,2),t[:62],fill='black'); d.text((4,16),t[62:124],fill='black')
  hoja.paste(im,((k%3)*W,(k//3)*H))
hoja.save(r'${salida}')`]);
console.log(`${elegidos.length} de ${casos.length} casos → ${salida}`);
