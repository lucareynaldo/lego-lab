# Taller de diseño: plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDO: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para ejecutar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`) para seguir el avance.

**Objetivo:** que un agente diseñe modelos LDraw con comandos de terminal: buscar piezas, encastrarlas por conector desde un script, construir el `.mpd`, validarlo, verlo en varias vistas y medirlo.

**Arquitectura:**
- Paquete nuevo `taller/` (Node + TypeScript sin compilar, como `verificador/`).
- Importa los módulos del verificador para biblioteca, conectores, geometría y verificación.
- Agrega una composición de Remotion en `estudio/` para los renders de varias vistas, que se ejecuta con el `render-secuencias.mjs` que ya existe.
- Un solo CLI (`taller/src/cli.ts`) expone todo.

**Tecnologías:** Node ≥ 23.6 (ejecuta `.ts` directo), TypeScript 7.0.2 estricto, `node:test`, `pngjs` 7.0.0, Remotion 4.0.528 + three 0.186 (ya en `estudio/`).

**Spec:** [`diseno/spec-taller.md`](spec-taller.md). Evidencia: [`investigaciones/02-diseno-de-modelos.md`](../investigaciones/02-diseno-de-modelos.md).

## Restricciones globales

- **No empezar hasta que el agente del verificador haya terminado y commiteado.** Después, confirmar que estas firmas siguen iguales (si cambiaron, adaptar el plan antes de seguir):
  - `verificador/src/ldraw.ts`: `class Biblioteca(dirLDraw, dirSombra)`, `.cargarModelo(ruta, nombrePorDefecto): string`, `.archivo(nombre): Archivo | null`, `.colores: Map<number, {nombre, rgb}>`, `normalizarNombre`, `esPieza`, `pasosDe` (línea `i + 1` dentro del archivo embebido, sin contar `0 FILE`).
  - `verificador/src/conectores.ts`: `type Conector`, `conectoresDe(bib, nombre)`, `transformarConector(c, tr): Conector | null`.
  - `verificador/src/conexiones.ts`: `conexiones(ConectorUbicado[]): Conexion[]`.
  - `verificador/src/geometria.ts`: `mallaDe(bib, nombre)`, `cajaEnMundo(malla, tr)`.
  - `verificador/src/verificar.ts`: `verificar(bib, principal, {combinacionesConocidas?})` → `Reporte` con `hallazgos: {severidad, regla, mensaje, submodelo?, paso?, piezas?: string[]}[]`, donde `piezas` son `"submodelo:línea"`.
  - `verificador/src/matematica.ts`: `Vec3`, `Mat3` (por filas), `Transform {r, t}`, `IDENTIDAD`, `aplicar`, `aplicarR`, `componer`, `multiplicarR`, `normalizar`, `punto`, `cruz`, `largo`, `escalar`, `restar`, `sumar`, `Caja`, `cajaVacia`, `expandirCaja`.
- **No se modifica `verificador/`.** En `estudio/` solo se agrega `src/taller/Vistas.tsx` y se registra en `src/Root.tsx`.
- **Dependencias nuevas:** solo `pngjs` 7.0.0 y `@types/pngjs` 6.0.5, en `taller/`.
- **Estilo:** tabs, código y mensajes en español, comentarios solo donde el porqué no es obvio.
- **Rutas con espacios (Windows):** todo proceso hijo se lanza con `spawnSync(process.execPath, [args…])`, nunca con un shell.
- **Unidades LDraw:** 1 stud = 20 LDU, 1 placa = 8, 1 ladrillo = 24, **−Y es arriba**.
- **Los tests necesitan `.cache/`** (biblioteca LDraw, shadow library, CSV de Rebrickable), igual que los del verificador.
- **Commits:** en una rama `taller`, un commit por tarea, con el trailer de atribución que pida la sesión.

## Qué revisar especialmente

Casos que el spec implica y que un usuario va a encontrar primero. Cada uno tiene su test en la tarea que corresponde.

1. **Ids de pieza con mayúsculas, `.dat` o barra invertida** (`"3001.DAT"`, `"s\\3001s01"`): se normalizan con `normalizarNombre`. Test en la Tarea 5.
2. **Stud fuera de rango, o una pieza sin studs o anti-studs:** error claro con la línea del script. Test en la Tarea 5.
3. **Color por nombre con otra capitalización o con espacios** (`"reddish brown"`, `"Reddish_Brown"`, `70`): los tres valen. Test en la Tarea 1.
4. **Submodelos con nombres raros o colocados en ciclo** (`m.sub("Copa Alta")`, un sub dentro de sí mismo): nombre saneado y error por ciclo. Test en la Tarea 5.
5. **Carpetas con espacios** al construir y renderizar: funcionan. Test en la Tarea 6 (`construir` en una carpeta con espacio).

---

## Estructura de archivos

```
taller/
  package.json, tsconfig.json, README.md
  src/
    entorno.ts      rutas de datos y Biblioteca compartida
    csv.ts          lectura de CSV (gz) de Rebrickable
    colores.ts      resolver colores por nombre/código; equivalencia LDraw↔Rebrickable
    catalogo.ts     índice de piezas (título, categoría, frecuencia, colores) y búsqueda
    ficha.ts        conectores de una pieza, grillas de studs/anti-studs, caja
    encastre.ts     rotaciones y cálculo del transform que alinea dos conectores
    dsl.ts          API del script de diseño (Modelo, Submodelo, poner, colocar, paso, guardar)
    render.ts       empaquetar + ordenar submodelo + render-secuencias
    imagen.ts       PNG → binaria, dimensión fractal, cambio de silueta
    metricas.ts     métricas del modelo
    cli.ts          comandos
  pruebas/
    *.test.ts
    fixtures/*.ts
estudio/src/taller/Vistas.tsx   composición "taller-vistas"
estudio/src/Root.tsx            (+ registro)
```

---

### Tarea 1: paquete, entorno, CSV y colores

**Archivos:**
- Crear: `taller/package.json`, `taller/tsconfig.json`, `taller/src/entorno.ts`, `taller/src/csv.ts`, `taller/src/colores.ts`
- Test: `taller/pruebas/colores.test.ts`

**Interfaces:**
- Produce:
  - `RAIZ`, `DIR_LDRAW`, `DIR_SOMBRA`, `DIR_REBRICKABLE`, `DIR_CACHE`, `DIR_ESTUDIO: string`
  - `biblioteca(): Biblioteca` (compartida, solo para piezas)
  - `nuevaBiblioteca(): Biblioteca` (limpia, para cargar modelos)
  - `campos(linea: string): string[]`
  - `lineasCsv(ruta: string): AsyncGenerator<string[]>` (salta la cabecera)
  - `type Color = {codigo: number; nombre: string; rgb: string}`
  - `colorDe(bib: Biblioteca, valor: string | number): Color` (lanza `Error("color desconocido: …")`)
  - `coloresEquivalentes(): Promise<Set<number>>`: códigos LDraw cuyo id de Rebrickable es el mismo color
  - `combinaciones(): Promise<Set<string>>`: `"pieza|color"` vistos en inventarios

- [ ] **Paso 1: crear el paquete**

`taller/package.json`:
```json
{
  "name": "taller",
  "private": true,
  "version": "0.1.0",
  "description": "Herramientas para diseñar modelos LDraw: catálogo, encastre, construcción, render, validación y métricas",
  "type": "module",
  "scripts": {
    "taller": "node --no-warnings src/cli.ts",
    "tipos": "tsc -p .",
    "test": "node --no-warnings --test \"pruebas/*.test.ts\"",
    "test:render": "node --no-warnings --test \"pruebas/render/*.test.ts\""
  },
  "dependencies": {
    "pngjs": "7.0.0"
  },
  "devDependencies": {
    "@types/node": "24.5.2",
    "@types/pngjs": "6.0.5",
    "typescript": "7.0.2"
  }
}
```

`taller/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "pruebas", "../verificador/src/quickhull3d.d.ts"]
}
```

Correr: `cd taller && npm install`

- [ ] **Paso 2: escribir el test que falla**

`taller/pruebas/colores.test.ts`:
```ts
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {coloresEquivalentes, colorDe} from '../src/colores.ts';
import {campos} from '../src/csv.ts';
import {biblioteca} from '../src/entorno.ts';

test('campos respeta comillas con comas', () => {
	assert.deepEqual(campos('3001,"Brick 2 x 4, Classic",11,Plastic'), ['3001', 'Brick 2 x 4, Classic', '11', 'Plastic']);
	assert.deepEqual(campos('a,"con ""comillas""",c'), ['a', 'con "comillas"', 'c']);
});

test('colorDe acepta código, nombre LDraw y nombre con espacios', () => {
	const bib = biblioteca();
	assert.equal(colorDe(bib, 70).codigo, 70);
	assert.equal(colorDe(bib, 'Reddish_Brown').codigo, 70);
	assert.equal(colorDe(bib, 'reddish brown').codigo, 70);
	assert.equal(colorDe(bib, '4').codigo, 4);
	assert.throws(() => colorDe(bib, 'violeta imaginario'), /color desconocido/);
});

test('los colores sólidos clásicos coinciden entre LDraw y Rebrickable', async () => {
	const eq = await coloresEquivalentes();
	for (const c of [0, 1, 2, 4, 14, 15, 19, 70, 71, 72]) assert.ok(eq.has(c), `color ${c}`);
});
```

- [ ] **Paso 3: correrlo y ver que falla**

Correr: `cd taller && npm test`
Esperado: FALLA, no encuentra el módulo `../src/colores.ts`.

- [ ] **Paso 4: implementar**

`taller/src/entorno.ts`:
```ts
// Rutas de datos (en .cache/, fuera de git) y bibliotecas LDraw.

import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Biblioteca} from '../../verificador/src/ldraw.ts';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DIR_LDRAW = process.env.LDRAW_DIR ?? join(RAIZ, '.cache/ldraw');
export const DIR_SOMBRA = process.env.LDCAD_SHADOW_DIR ?? join(RAIZ, '.cache/LDCadShadowLibrary-main');
export const DIR_REBRICKABLE = join(RAIZ, '.cache/rebrickable');
export const DIR_CACHE = join(RAIZ, '.cache/taller');
export const DIR_ESTUDIO = join(RAIZ, 'estudio');

// Para consultar piezas: los archivos de la biblioteca se cachean por proceso.
let compartida: Biblioteca | null = null;
export const biblioteca = () => (compartida ??= new Biblioteca(DIR_LDRAW, DIR_SOMBRA));

// Para cargar un modelo: sus archivos embebidos quedan en esta instancia y no se mezclan con otros.
export const nuevaBiblioteca = () => new Biblioteca(DIR_LDRAW, DIR_SOMBRA);
```

`taller/src/csv.ts`:
```ts
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {createGunzip} from 'node:zlib';

// Separa una línea CSV respetando comillas ("a, b" es un campo; "" es una comilla).
export function campos(linea: string): string[] {
	const out: string[] = [];
	let actual = '';
	let comillas = false;
	for (let i = 0; i < linea.length; i++) {
		const ch = linea[i];
		if (comillas) {
			if (ch === '"' && linea[i + 1] === '"') (actual += '"'), i++;
			else if (ch === '"') comillas = false;
			else actual += ch;
		} else if (ch === '"') comillas = true;
		else if (ch === ',') out.push(actual), (actual = '');
		else actual += ch;
	}
	out.push(actual);
	return out;
}

// Filas de un CSV (opcionalmente .gz), sin la cabecera.
export async function* lineasCsv(ruta: string): AsyncGenerator<string[]> {
	const entrada = ruta.endsWith('.gz') ? createReadStream(ruta).pipe(createGunzip()) : createReadStream(ruta);
	let primera = true;
	for await (const l of createInterface({input: entrada, crlfDelay: Infinity})) {
		if (primera) {
			primera = false;
			continue;
		}
		if (l) yield campos(l);
	}
}
```

`taller/src/colores.ts`:
```ts
// Colores: por código LDraw o por nombre de LDConfig.ldr. Los inventarios de Rebrickable usan sus propios
// ids; para los colores sólidos clásicos coinciden con el código LDraw, pero no para todos. Un código se
// considera equivalente si el id de Rebrickable tiene el mismo nombre o un RGB casi igual.

import {join} from 'node:path';
import type {Biblioteca} from '../../verificador/src/ldraw.ts';
import {lineasCsv} from './csv.ts';
import {biblioteca, DIR_REBRICKABLE} from './entorno.ts';

export type Color = {codigo: number; nombre: string; rgb: string};

const clave = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');

export function colorDe(bib: Biblioteca, valor: string | number): Color {
	const texto = String(valor).trim();
	if (/^\d+$/.test(texto)) {
		const c = bib.colores.get(Number(texto));
		if (c) return {codigo: Number(texto), ...c};
	} else {
		for (const [codigo, c] of bib.colores) if (clave(c.nombre) === clave(texto)) return {codigo, ...c};
	}
	throw new Error(`color desconocido: ${valor}`);
}

const DISTANCIA_MAX = 40; // suma de diferencias por canal (0–765)
const distancia = (a: string, b: string) =>
	[0, 2, 4].reduce((s, i) => s + Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)), 0);

let equivalentes: Promise<Set<number>> | null = null;
export function coloresEquivalentes(): Promise<Set<number>> {
	return (equivalentes ??= (async () => {
		const bib = biblioteca();
		const out = new Set<number>();
		for await (const [id, nombre, rgb] of lineasCsv(join(DIR_REBRICKABLE, 'colors.csv.gz'))) {
			const c = bib.colores.get(Number(id));
			if (c && (clave(c.nombre) === clave(nombre) || distancia(c.rgb, rgb) <= DISTANCIA_MAX)) out.add(Number(id));
		}
		return out;
	})());
}

let combos: Promise<Set<string>> | null = null;
export function combinaciones(): Promise<Set<string>> {
	return (combos ??= (async () => {
		const out = new Set<string>();
		for await (const [, pieza, color] of lineasCsv(join(DIR_REBRICKABLE, 'inventory_parts.csv.gz'))) out.add(`${pieza}|${color}`);
		return out;
	})());
}
```

- [ ] **Paso 5: correr los tests y ver que pasan**

Correr: `cd taller && npm test && npm run tipos`
Esperado: 3 tests en PASS; `tsc` sin errores.

- [ ] **Paso 6: commit**

```bash
git add taller/package.json taller/package-lock.json taller/tsconfig.json taller/src/entorno.ts taller/src/csv.ts taller/src/colores.ts taller/pruebas/colores.test.ts
git commit -m "taller: paquete, rutas de datos y colores"
```

---

### Tarea 2: catálogo y búsqueda

**Archivos:**
- Crear: `taller/src/catalogo.ts`
- Test: `taller/pruebas/catalogo.test.ts`

**Interfaces:**
- Consume: `lineasCsv`, `coloresEquivalentes`, `DIR_LDRAW`, `DIR_REBRICKABLE`, `DIR_CACHE`
- Produce:
  - `type EntradaCatalogo = {id: string; titulo: string; categoria: string; frecuencia: number; colores: number[]}`
  - `construirCatalogo(): Promise<EntradaCatalogo[]>` (escribe `.cache/taller/catalogo.json`)
  - `catalogo(): Promise<EntradaCatalogo[]>` (lee el caché o lo construye)
  - `buscar(cat: EntradaCatalogo[], texto: string, op?: {categoria?: string; max?: number; todas?: boolean}): EntradaCatalogo[]`
  - `esUsable(cabecera: string): boolean`

- [ ] **Paso 1: escribir el test que falla**

`taller/pruebas/catalogo.test.ts`:
```ts
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buscar, catalogo, esUsable} from '../src/catalogo.ts';

test('esUsable descarta alias, movidas y subpartes', () => {
	assert.equal(esUsable('0 Brick  2 x  4\n0 !LDRAW_ORG Part UPDATE 2004-03'), true);
	assert.equal(esUsable('0 ~Moved to 3001\n0 !LDRAW_ORG Part'), false);
	assert.equal(esUsable('0 =Brick  2 x  4\n0 !LDRAW_ORG Part Alias'), false);
	assert.equal(esUsable('0 _Brick  2 x  4 Mirrored\n0 !LDRAW_ORG Part'), false);
	assert.equal(esUsable('0 Brick  2 x  4 Red\n0 !LDRAW_ORG Part Physical_Colour'), false);
});

test('buscar ordena por frecuencia y filtra piezas nunca vendidas', async () => {
	const cat = await catalogo();
	const r = buscar(cat, 'brick 2 x 4');
	assert.equal(r[0].id, '3001');
	assert.ok(r.every((e) => e.frecuencia > 0));
	assert.ok(r[0].colores.includes(4) && r[0].colores.includes(15));
});

test('buscar por id exacto lo pone primero; --todas incluye piezas sin inventario', async () => {
	const cat = await catalogo();
	assert.equal(buscar(cat, '3471', {todas: true})[0].id, '3471');
	const arboles = buscar(cat, 'plant tree', {todas: true, max: 100}).map((e) => e.id);
	assert.ok(arboles.includes('3471'));
});

test('filtro por categoría', async () => {
	const cat = await catalogo();
	const r = buscar(cat, 'slope', {categoria: 'Slope', max: 50});
	assert.ok(r.length > 0 && r.every((e) => e.categoria.toLowerCase() === 'slope'));
});
```

- [ ] **Paso 2: correrlo y ver que falla**

Correr: `cd taller && node --no-warnings --test pruebas/catalogo.test.ts`
Esperado: FALLA, no encuentra el módulo `../src/catalogo.ts`.

- [ ] **Paso 3: implementar**

`taller/src/catalogo.ts`:
```ts
// Índice de las piezas LDraw usables, con frecuencia de uso y colores reales según los inventarios de
// Rebrickable. Se guarda en .cache/taller/catalogo.json; `piezas reindexar` lo rehace.

import {closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {coloresEquivalentes} from './colores.ts';
import {lineasCsv} from './csv.ts';
import {DIR_CACHE, DIR_LDRAW, DIR_REBRICKABLE} from './entorno.ts';

export type EntradaCatalogo = {id: string; titulo: string; categoria: string; frecuencia: number; colores: number[]};

const RUTA = join(DIR_CACHE, 'catalogo.json');
const VERSION = 1;

// Cabecera = primeros bytes del archivo: alcanza para el título, !LDRAW_ORG y !CATEGORY.
function cabecera(ruta: string): string {
	const fd = openSync(ruta, 'r');
	try {
		const buf = Buffer.alloc(2048);
		const n = readSync(fd, buf, 0, buf.length, 0);
		return buf.toString('latin1', 0, n).replace(/\r\n?/g, '\n');
	} finally {
		closeSync(fd);
	}
}

export function esUsable(cab: string): boolean {
	const titulo = cab.split('\n')[0].replace(/^0\s+/, '');
	if (/^[~=_|]/.test(titulo) || /Moved to/i.test(titulo)) return false;
	const org = cab.match(/^0 !LDRAW_ORG\s+(?:Unofficial_)?(\S+)(?:\s+(\S+))?/m);
	if (!org || org[1] !== 'Part') return false;
	return org[2] !== 'Alias' && org[2] !== 'Physical_Colour';
}

export async function construirCatalogo(): Promise<EntradaCatalogo[]> {
	const equivalentes = await coloresEquivalentes();
	const frecuencia = new Map<string, number>();
	const colores = new Map<string, Set<number>>();
	for await (const [, pieza, color, cantidad] of lineasCsv(join(DIR_REBRICKABLE, 'inventory_parts.csv.gz'))) {
		const id = pieza.toLowerCase();
		frecuencia.set(id, (frecuencia.get(id) ?? 0) + Number(cantidad));
		if (equivalentes.has(Number(color))) {
			let s = colores.get(id);
			if (!s) colores.set(id, (s = new Set()));
			s.add(Number(color));
		}
	}
	const dir = join(DIR_LDRAW, 'parts');
	const out: EntradaCatalogo[] = [];
	for (const f of readdirSync(dir)) {
		if (!f.toLowerCase().endsWith('.dat')) continue;
		const cab = cabecera(join(dir, f));
		if (!esUsable(cab)) continue;
		const titulo = cab.split('\n')[0].replace(/^0\s+/, '').trim();
		const id = f.slice(0, -4).toLowerCase();
		const categoria = cab.match(/^0 !CATEGORY\s+(.+)$/m)?.[1].trim() ?? titulo.split(/\s+/)[0];
		out.push({id, titulo, categoria, frecuencia: frecuencia.get(id) ?? 0, colores: [...(colores.get(id) ?? [])].sort((a, b) => a - b)});
	}
	mkdirSync(DIR_CACHE, {recursive: true});
	writeFileSync(RUTA, JSON.stringify({version: VERSION, piezas: out}));
	return out;
}

let cargado: Promise<EntradaCatalogo[]> | null = null;
export function catalogo(): Promise<EntradaCatalogo[]> {
	return (cargado ??= (async () => {
		if (existsSync(RUTA)) {
			const j = JSON.parse(readFileSync(RUTA, 'utf8'));
			if (j.version === VERSION) return j.piezas as EntradaCatalogo[];
		}
		return construirCatalogo();
	})());
}

export function buscar(cat: EntradaCatalogo[], texto: string, op: {categoria?: string; max?: number; todas?: boolean} = {}): EntradaCatalogo[] {
	const consulta = texto.trim().toLowerCase();
	const palabras = consulta.split(/\s+/).filter(Boolean);
	const exacta = cat.find((e) => e.id === consulta);
	const r = cat.filter((e) => {
		if (e === exacta) return false;
		if (!op.todas && e.frecuencia === 0) return false;
		if (op.categoria && e.categoria.toLowerCase() !== op.categoria.toLowerCase()) return false;
		const t = e.titulo.toLowerCase().replace(/\s+/g, ' ');
		return palabras.every((p) => t.includes(p));
	});
	r.sort((a, b) => b.frecuencia - a.frecuencia || a.id.localeCompare(b.id));
	return [...(exacta ? [exacta] : []), ...r].slice(0, op.max ?? 20);
}
```

- [ ] **Paso 4: correr los tests y ver que pasan**

Correr: `cd taller && node --no-warnings --test pruebas/catalogo.test.ts`
Esperado: 4 tests en PASS. La primera corrida construye el caché (unos segundos: 24.735 archivos).

- [ ] **Paso 5: commit**

```bash
git add taller/src/catalogo.ts taller/pruebas/catalogo.test.ts
git commit -m "taller: catálogo de piezas con frecuencia y colores reales"
```

---

### Tarea 3: ficha de pieza (grillas de studs y anti-studs)

**Archivos:**
- Crear: `taller/src/ficha.ts`
- Test: `taller/pruebas/ficha.test.ts`

**Interfaces:**
- Consume: `conectoresDe`, `Conector`, `mallaDe`, `normalizarNombre`, `biblioteca()`
- Produce:
  - `archivoDe(id: string): string`: `"3001"` / `"3001.DAT"` / `"s\\x"` → `"3001.dat"` / `"s/x.dat"`
  - `conectoresPieza(bib: Biblioteca, archivo: string): Conector[]`
  - `type PuntoGrilla = {i: number; j: number; n: number; pos: Vec3}` (`n` = índice en `conectoresPieza`)
  - `type Grilla = {columnas: number; filas: number; puntos: PuntoGrilla[]}`
  - `esStud(c: Conector): boolean` y `esAntistud(c: Conector): boolean`
  - `grilla(conectores: Conector[], filtro: (c: Conector) => boolean): Grilla`
  - `puntoGrilla(g: Grilla, ij: [number, number], que: string): PuntoGrilla` (lanza si está fuera de rango)
  - `type Ficha = {id; titulo; caja: Caja; tamano: {x: number; y: number; z: number}; studs: Grilla; antistuds: Grilla; otros: {n: number; tipo: string; genero?: string; pos: Vec3; eje: Vec3}[]}`
  - `ficha(bib: Biblioteca, id: string): Ficha`

Datos confirmados en la shadow library:
- `stud.dat` declara un macho `R 6 4` en el origen, con eje hacia −Y.
- `s/3001s01.dat` declara las hembras del 3001: `[gender=F] [secs=R 6 20] [pos=0 24 0] [grid=C 4 C 2 20 20]`, o sea 8 anti-studs a y = 24, con eje hacia −Y.

- [ ] **Paso 1: escribir el test que falla**

`taller/pruebas/ficha.test.ts`:
```ts
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {biblioteca} from '../src/entorno.ts';
import {archivoDe, ficha, puntoGrilla} from '../src/ficha.ts';

test('archivoDe normaliza ids', () => {
	assert.equal(archivoDe('3001'), '3001.dat');
	assert.equal(archivoDe('3001.DAT'), '3001.dat');
	assert.equal(archivoDe('s\\3001s01'), 's/3001s01.dat');
});

test('3001: 8 studs en 4×2, 8 anti-studs, 4×3×2', () => {
	const f = ficha(biblioteca(), '3001');
	assert.equal(f.studs.puntos.length, 8);
	assert.deepEqual([f.studs.columnas, f.studs.filas], [4, 2]);
	assert.equal(f.antistuds.puntos.length, 8);
	assert.deepEqual(f.tamano, {x: 4, y: 3, z: 2});
	const s00 = puntoGrilla(f.studs, [0, 0], 'stud');
	assert.deepEqual(s00.pos.map(Math.round), [-30, 0, -10]);
	const a00 = puntoGrilla(f.antistuds, [0, 0], 'anti-stud');
	assert.deepEqual(a00.pos.map(Math.round), [-30, 24, -10]);
});

test('puntoGrilla fuera de rango da un error claro', () => {
	const f = ficha(biblioteca(), '3001');
	assert.throws(() => puntoGrilla(f.studs, [4, 0], 'stud'), /stud \(4,0\) fuera de rango: la pieza tiene 4×2/);
});

test('una baldosa lisa no tiene studs', () => {
	const f = ficha(biblioteca(), '3069b');
	assert.equal(f.studs.puntos.length, 0);
	assert.throws(() => puntoGrilla(f.studs, [0, 0], 'stud'), /no tiene studs/);
});
```

- [ ] **Paso 2: correrlo y ver que falla**

Correr: `cd taller && node --no-warnings --test pruebas/ficha.test.ts`
Esperado: FALLA, no encuentra el módulo `../src/ficha.ts`.

- [ ] **Paso 3: implementar**

`taller/src/ficha.ts`:
```ts
// Qué tiene una pieza para encastrar: studs y anti-studs indexados en grilla (i crece en +X, j en +Z,
// desde la esquina de menor X y Z) y el resto de sus conectores numerados.

import type {Conector} from '../../verificador/src/conectores.ts';
import {conectoresDe} from '../../verificador/src/conectores.ts';
import {mallaDe} from '../../verificador/src/geometria.ts';
import type {Biblioteca} from '../../verificador/src/ldraw.ts';
import {normalizarNombre} from '../../verificador/src/ldraw.ts';
import type {Caja, Vec3} from '../../verificador/src/matematica.ts';
import {normalizar, punto} from '../../verificador/src/matematica.ts';

export const archivoDe = (id: string) => {
	const n = normalizarNombre(id);
	return n.endsWith('.dat') ? n : `${n}.dat`;
};

export const conectoresPieza = (bib: Biblioteca, archivo: string): Conector[] => conectoresDe(bib, archivo);

const ARRIBA: Vec3 = [0, -1, 0];
const haciaArriba = (c: Conector) => punto(normalizar(c.eje), ARRIBA) > 0.999;
const redondo6 = (c: Conector) => c.tipo === 'cil' && c.secs.some((s) => s.forma === 'R' && Math.abs(s.r - 6) < 0.01);

export const esStud = (c: Conector) => c.tipo === 'cil' && c.genero === 'M' && haciaArriba(c) && redondo6(c);
export const esAntistud = (c: Conector) => c.tipo === 'cil' && c.genero === 'F' && haciaArriba(c) && redondo6(c);

export type PuntoGrilla = {i: number; j: number; n: number; pos: Vec3};
export type Grilla = {columnas: number; filas: number; puntos: PuntoGrilla[]};

export function grilla(conectores: Conector[], filtro: (c: Conector) => boolean): Grilla {
	const elegidos = conectores.map((c, n) => ({c, n})).filter(({c}) => filtro(c));
	if (elegidos.length === 0) return {columnas: 0, filas: 0, puntos: []};
	const minX = Math.min(...elegidos.map(({c}) => c.base[0]));
	const minZ = Math.min(...elegidos.map(({c}) => c.base[2]));
	const porCelda = new Map<string, PuntoGrilla>();
	for (const {c, n} of elegidos) {
		const i = Math.round((c.base[0] - minX) / 20);
		const j = Math.round((c.base[2] - minZ) / 20);
		// Dos conectores en la misma celda (p. ej., a distinta altura): queda el primero.
		if (!porCelda.has(`${i},${j}`)) porCelda.set(`${i},${j}`, {i, j, n, pos: c.base});
	}
	const puntos = [...porCelda.values()].sort((a, b) => a.j - b.j || a.i - b.i);
	return {columnas: Math.max(...puntos.map((p) => p.i)) + 1, filas: Math.max(...puntos.map((p) => p.j)) + 1, puntos};
}

export function puntoGrilla(g: Grilla, [i, j]: [number, number], que: string): PuntoGrilla {
	if (g.puntos.length === 0) throw new Error(`la pieza no tiene ${que}s`);
	const p = g.puntos.find((x) => x.i === i && x.j === j);
	if (!p) throw new Error(`${que} (${i},${j}) fuera de rango: la pieza tiene ${g.columnas}×${g.filas} (i < ${g.columnas}, j < ${g.filas})`);
	return p;
}

export type Ficha = {
	id: string;
	titulo: string;
	caja: Caja;
	tamano: {x: number; y: number; z: number}; // studs, placas, studs
	studs: Grilla;
	antistuds: Grilla;
	otros: {n: number; tipo: string; genero?: string; pos: Vec3; eje: Vec3}[];
};

const redondear = (x: number, paso = 0.01) => Math.round(x / paso) * paso;

export function ficha(bib: Biblioteca, id: string): Ficha {
	const archivo = archivoDe(id);
	const a = bib.archivo(archivo);
	if (!a) throw new Error(`pieza inexistente: ${id}`);
	const conectores = conectoresPieza(bib, archivo);
	const {caja} = mallaDe(bib, archivo);
	const studs = grilla(conectores, esStud);
	const antistuds = grilla(conectores, esAntistud);
	const enGrilla = new Set([...studs.puntos, ...antistuds.puntos].map((p) => p.n));
	// La altura se mide sin los studs (4 LDU): un 3001 mide 3 placas, no 3,5. Los studs nacen en su base.
	const tope = studs.puntos.length > 0 ? Math.min(...studs.puntos.map((p) => p.pos[1])) : caja.min[1];
	return {
		id: archivo.slice(0, -4),
		titulo: a.titulo,
		caja,
		tamano: {
			x: redondear((caja.max[0] - caja.min[0]) / 20),
			y: redondear((caja.max[1] - tope) / 8),
			z: redondear((caja.max[2] - caja.min[2]) / 20),
		},
		studs,
		antistuds,
		otros: conectores
			.map((c, n) => ({c, n}))
			.filter(({n}) => !enGrilla.has(n))
			.map(({c, n}) => ({n, tipo: c.tipo, genero: 'genero' in c ? c.genero : undefined, pos: c.base, eje: normalizar(c.eje)})),
	};
}
```

- [ ] **Paso 4: correr los tests y ver que pasan**

Correr: `cd taller && node --no-warnings --test pruebas/ficha.test.ts`
Esperado: 4 tests en PASS.

- [ ] **Paso 5: commit**

```bash
git add taller/src/ficha.ts taller/pruebas/ficha.test.ts
git commit -m "taller: ficha de pieza con grillas de studs y anti-studs"
```

---

### Tarea 4: encastre (alinear dos conectores)

**Archivos:**
- Crear: `taller/src/encastre.ts`
- Test: `taller/pruebas/encastre.test.ts`

**Interfaces:**
- Consume: `Conector`, `transformarConector`, `conexiones`, las funciones de `matematica.ts`, `ficha`, `conectoresPieza`
- Produce:
  - `rotacionEje(eje: Vec3, grados: number): Mat3`
  - `rotacionEntre(a: Vec3, b: Vec3): Mat3`
  - `parsearRot(s: string): Mat3` (`"X90 Y45"`, aplicadas de izquierda a derecha; `""` = identidad)
  - `limpiar(tr: Transform): Transform`
  - `encastrar(base: Transform, conBase: Conector, conNueva: Conector, giro?: number): Transform`

**Regla:** se hace coincidir el punto `base` del conector nuevo con el `base` del conector existente, y sus ejes quedan paralelos y en el mismo sentido. Así es como el verificador reconoce un stud dentro de un anti-stud (ver el caso "stud en anti-stud de un ladrillo" en `verificador/pruebas/unitarias.ts`). `giro` rota alrededor del eje del conector, en el punto de contacto.

- [ ] **Paso 1: escribir el test que falla**

`taller/pruebas/encastre.test.ts`:
```ts
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
```

- [ ] **Paso 2: correrlo y ver que falla**

Correr: `cd taller && node --no-warnings --test pruebas/encastre.test.ts`
Esperado: FALLA, no encuentra el módulo `../src/encastre.ts`.

- [ ] **Paso 3: implementar**

`taller/src/encastre.ts`:
```ts
// Encastre por conector: calcula dónde va una pieza para que uno de sus conectores quede en uno de otra
// pieza. Evita que el diseñador escriba matrices a mano.

import type {Conector} from '../../verificador/src/conectores.ts';
import type {Mat3, Transform, Vec3} from '../../verificador/src/matematica.ts';
import {aplicar, aplicarR, cruz, escalar, IDENTIDAD, largo, multiplicarR, normalizar, punto, restar} from '../../verificador/src/matematica.ts';

// Rotación de `grados` alrededor de `eje` (Rodrigues), por filas como en LDraw.
export function rotacionEje(eje: Vec3, grados: number): Mat3 {
	const [x, y, z] = normalizar(eje);
	const a = (grados * Math.PI) / 180;
	const c = Math.cos(a);
	const s = Math.sin(a);
	const k = 1 - c;
	return [
		c + x * x * k, x * y * k - z * s, x * z * k + y * s,
		y * x * k + z * s, c + y * y * k, y * z * k - x * s,
		z * x * k - y * s, z * y * k + x * s, c + z * z * k,
	];
}

// La rotación mínima que lleva la dirección a en la dirección b.
export function rotacionEntre(a: Vec3, b: Vec3): Mat3 {
	const u = normalizar(a);
	const v = normalizar(b);
	const c = punto(u, v);
	if (c > 1 - 1e-12) return [...IDENTIDAD.r] as Mat3;
	if (c < -1 + 1e-12) {
		const aux: Vec3 = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
		return rotacionEje(cruz(u, aux), 180);
	}
	const k = cruz(u, v);
	const s = largo(k);
	return rotacionEje(escalar(k, 1 / s), (Math.atan2(s, c) * 180) / Math.PI);
}

const EJES: Record<string, Vec3> = {X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1]};

export function parsearRot(s: string): Mat3 {
	let r = [...IDENTIDAD.r] as Mat3;
	for (const tok of s.trim().split(/\s+/).filter(Boolean)) {
		const m = tok.match(/^([XYZ])(-?\d+(?:\.\d+)?)$/i);
		if (!m) throw new Error(`rotación inválida: "${tok}" (se espera algo como "X90 Y-45")`);
		r = multiplicarR(rotacionEje(EJES[m[1].toUpperCase()], Number(m[2])), r);
	}
	return r;
}

const EXACTOS = [0, 1, -1, 0.5, -0.5];
function limpio(n: number): number {
	for (const e of EXACTOS) if (Math.abs(n - e) < 1e-9) return e;
	const r = Math.round(n * 1e6) / 1e6;
	return Object.is(r, -0) ? 0 : r;
}

export const limpiar = (tr: Transform): Transform => ({r: tr.r.map(limpio) as Mat3, t: tr.t.map(limpio) as Vec3});

// Transform de la pieza nueva (en el sistema del submodelo) para que su conector `conNueva` (local)
// quede sobre `conBase` (local de la pieza base, ubicada en `base`).
export function encastrar(base: Transform, conBase: Conector, conNueva: Conector, giro = 0): Transform {
	const pB = aplicar(base, conBase.base);
	const aB = normalizar(aplicarR(base.r, conBase.eje));
	const r = multiplicarR(rotacionEje(aB, giro), rotacionEntre(conNueva.eje, aB));
	return limpiar({r, t: restar(pB, aplicarR(r, conNueva.base))});
}
```

- [ ] **Paso 4: correr los tests y ver que pasan**

Correr: `cd taller && node --no-warnings --test pruebas/encastre.test.ts`
Esperado: 4 tests en PASS.

- [ ] **Paso 5: commit**

```bash
git add taller/src/encastre.ts taller/pruebas/encastre.test.ts
git commit -m "taller: encastre por conector y rotaciones por ejes"
```

---

### Tarea 5: API del script de diseño

**Archivos:**
- Crear: `taller/src/dsl.ts`, `taller/pruebas/fixtures/dos-ladrillos.ts`
- Test: `taller/pruebas/dsl.test.ts`

**Interfaces:**
- Consume: `biblioteca()`, `nuevaBiblioteca()`, `colorDe`, `archivoDe`, `ficha`, `conectoresPieza`, `puntoGrilla`, `encastrar`, `parsearRot`, `limpiar`, `esPieza`, `verificar`
- Produce:
  - `grilla(x: number, capas: number, z: number): Vec3` → `[20x, −8·capas, 20z]`
  - `class PiezaColocada {archivo; color: Color; tr: Transform; nombre?: string; origen: string; sub: Submodelo}`
  - `type Opciones = {nombre?: string; en?: Vec3; rot?: string; sobre?: PiezaColocada; stud?: [number, number]; debajo?: PiezaColocada; antistud?: [number, number]; con?: [number, number]; giro?: number; conector?: {de: PiezaColocada; n: number}; propio?: number}`. Es plano a propósito: una unión discriminada no se deja leer sin `in` en cada rama. Las combinaciones se validan al ejecutar: una sola forma de ubicar y los campos que esa forma exige.
  - `class Submodelo {nombre: string; archivo: string; poner(id, color, op?): PiezaColocada; colocar(sub: Submodelo, op?: {en?: Vec3; rot?: string}): void; paso(): void}`
  - `class Modelo {nombre: string; raiz: Submodelo; sub(nombre): Submodelo; texto(): {mpd: string; mapa: Record<string, string>}; guardar(ruta?): string}`
  - `guardar` escribe en `process.env.TALLER_SALIDA ?? ruta ?? 'modelo.mpd'` y también `<ruta sin .mpd>.mapa.json`. Devuelve la ruta del `.mpd`.
  - Claves del mapa: `"<archivo del submodelo>:<línea>"`, con la numeración de `pasosDe` (1 = primera línea después de `0 FILE`). Valor: `"<archivo del script>:<línea> (<nombre>)"`.

- [ ] **Paso 1: escribir el fixture y el test que falla**

`taller/pruebas/fixtures/dos-ladrillos.ts`:
```ts
import {Modelo} from '../../src/dsl.ts';

const m = new Modelo('Dos Ladrillos');
const pila = m.sub('pila');
const a = pila.poner('3001', 'Red', {nombre: 'abajo'});
pila.paso();
pila.poner('3001', 'white', {sobre: a, stud: [2, 0], nombre: 'arriba'});
pila.paso();
m.raiz.colocar(pila);
m.raiz.paso();
m.guardar();
```

`taller/pruebas/dsl.test.ts`:
```ts
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {verificar} from '../../verificador/src/verificar.ts';
import {grilla, Modelo} from '../src/dsl.ts';
import {nuevaBiblioteca} from '../src/entorno.ts';

function construirFixture(nombre: string) {
	const dir = mkdtempSync(join(tmpdir(), 'taller dsl '));
	const salida = join(dir, 'modelo.mpd');
	const r = spawnSync(process.execPath, ['--no-warnings', join(import.meta.dirname, 'fixtures', nombre)], {env: {...process.env, TALLER_SALIDA: salida}, encoding: 'utf8'});
	return {r, salida};
}

test('dos 3001 encastrados pasan el verificador sin errores ni avisos', () => {
	const {r, salida} = construirFixture('dos-ladrillos.ts');
	assert.equal(r.status, 0, r.stderr);
	const bib = nuevaBiblioteca();
	const principal = bib.cargarModelo(salida, 'modelo.mpd');
	assert.equal(principal, 'dos-ladrillos.ldr');
	const rep = verificar(bib, principal);
	assert.deepEqual(rep.hallazgos, []);
	assert.equal(rep.piezas, 2);
	const mapa = JSON.parse(readFileSync(salida.replace(/\.mpd$/, '.mapa.json'), 'utf8'));
	assert.match(Object.values(mapa).join('\n'), /dos-ladrillos\.ts:\d+ \(arriba\)/);
});

test('texto: cabecera, STEP y mapa con la numeración de pasosDe', () => {
	const m = new Modelo('x');
	const s = m.sub('s');
	s.poner('3001', 4, {en: grilla(0, 0, 0)});
	s.paso();
	m.raiz.colocar(s);
	const {mpd, mapa} = m.texto();
	const bloqueS = mpd.split('0 FILE s.ldr\n')[1].split('0 NOFILE')[0].split('\n');
	const clave = Object.keys(mapa).find((k) => k.startsWith('s.ldr:'))!;
	const n = Number(clave.split(':')[1]);
	assert.match(bloqueS[n - 1], /^1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001\.dat$/);
	assert.ok(mpd.startsWith('0 FILE x.ldr\n'));
});

test('ids con mayúsculas y .dat; colores por nombre con espacios', () => {
	const m = new Modelo('x');
	const p = m.raiz.poner('3001.DAT', 'reddish brown');
	assert.equal(p.archivo, '3001.dat');
	assert.equal(p.color.codigo, 70);
});

test('errores con la línea del script', () => {
	const m = new Modelo('x');
	const a = m.raiz.poner('3001', 4);
	assert.throws(() => m.raiz.poner('3001', 4, {sobre: a, stud: [9, 9]}), /dsl\.test\.ts:\d+: stud \(9,9\) fuera de rango/);
	assert.throws(() => m.raiz.poner('noexiste', 4), /dsl\.test\.ts:\d+: pieza inexistente: noexiste/);
	const t = m.raiz.poner('3069b', 4, {en: [0, -24, 0]});
	assert.throws(() => m.raiz.poner('3001', 4, {sobre: t, stud: [0, 0]}), /no tiene studs/);
	assert.throws(() => m.raiz.poner('3001', 4, {sobre: a}), /hay que indicar stud/);
	assert.throws(() => m.raiz.poner('3001', 4, {sobre: a, stud: [0, 0], en: [0, 0, 0]}), /una sola forma/);
});

test('nombres saneados, duplicados y ciclos', () => {
	const m = new Modelo('x');
	const s = m.sub('Copa Alta');
	assert.equal(s.archivo, 'copa-alta.ldr');
	assert.throws(() => m.sub('copa alta'), /ya existe/);
	const t = m.sub('t');
	t.colocar(s);
	assert.throws(() => s.colocar(t), /ciclo/);
	assert.throws(() => s.colocar(s), /ciclo/);
});

test('sobre exige que la base esté en el mismo submodelo', () => {
	const m = new Modelo('x');
	const a = m.sub('a').poner('3001', 4);
	assert.throws(() => m.sub('b').poner('3001', 4, {sobre: a, stud: [0, 0]}), /otro submodelo/);
});
```

- [ ] **Paso 2: correrlo y ver que falla**

Correr: `cd taller && node --no-warnings --test pruebas/dsl.test.ts`
Esperado: FALLA, no encuentra el módulo `../src/dsl.ts`.

- [ ] **Paso 3: implementar**

`taller/src/dsl.ts`:
```ts
// API para escribir un modelo como script sin coordenadas a mano.
//
//   const m = new Modelo('arbol');
//   const tronco = m.sub('tronco');                                   // un submodelo = un sub-armado
//   const base = tronco.poner('3005', 'Reddish_Brown');               // en el origen del submodelo
//   tronco.poner('3005', 'Reddish_Brown', {sobre: base, stud: [0, 0], giro: 90});  // anti-stud (0,0) sobre stud (0,0)
//   tronco.poner('3024', 'Green', {debajo: base, antistud: [0, 0]});  // stud (0,0) dentro del anti-stud (0,0)
//   tronco.poner('4274', 'Light_Bluish_Grey', {conector: {de: base, n: 7}, propio: 3});   // índices de `piezas ver`
//   tronco.poner('2417', 'Green', {en: grilla(0, 9, 1), rot: 'X90 Y45'});                  // libre
//   tronco.paso();
//   m.raiz.colocar(tronco);  m.raiz.paso();
//   m.guardar();                                                      // modelo.mpd + modelo.mapa.json
//
// Grilla: stud (i, j) con i en +X y j en +Z, desde la esquina de menor X y Z (`con` elige el anti-stud o
// stud propio, por defecto (0,0)). `giro`: 0/90/180/270 alrededor del eje del conector. Unidades: 1 stud =
// 20 LDU, 1 placa = 8, −Y es arriba. `rot`: giros por eje en grados, de izquierda a derecha.

import {writeFileSync} from 'node:fs';
import {basename, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Transform, Vec3} from '../../verificador/src/matematica.ts';
import {IDENTIDAD} from '../../verificador/src/matematica.ts';
import {esPieza} from '../../verificador/src/ldraw.ts';
import type {Color} from './colores.ts';
import {colorDe} from './colores.ts';
import {encastrar, limpiar, parsearRot} from './encastre.ts';
import {biblioteca} from './entorno.ts';
import {archivoDe, conectoresPieza, ficha, puntoGrilla} from './ficha.ts';

export const grilla = (x: number, capas: number, z: number): Vec3 => [20 * x, -8 * capas, 20 * z];

const ESTE_ARCHIVO = fileURLToPath(import.meta.url);

// "archivo.ts:línea" de quien llamó a la API (el script de diseño).
function llamador(): string {
	for (const l of (new Error().stack ?? '').split('\n').slice(1)) {
		const m = l.match(/\(?(?:file:\/\/\/?)?([^()\s]+?):(\d+):\d+\)?$/);
		if (!m) continue;
		const ruta = decodeURIComponent(m[1]);
		if (ruta.startsWith('node:') || resolve(ruta) === ESTE_ARCHIVO) continue;
		return `${basename(ruta)}:${m[2]}`;
	}
	return '?';
}

const sanear = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'sub';

export type Opciones = {
	nombre?: string;
	en?: Vec3;
	rot?: string;
	sobre?: PiezaColocada;
	stud?: [number, number];
	debajo?: PiezaColocada;
	antistud?: [number, number];
	con?: [number, number];
	giro?: number;
	conector?: {de: PiezaColocada; n: number};
	propio?: number;
};

// Sin parameter properties: erasableSyntaxOnly (y el type stripping de Node) no los admiten.
export class PiezaColocada {
	readonly archivo: string;
	readonly color: Color;
	readonly tr: Transform;
	readonly origen: string;
	readonly sub: Submodelo;
	readonly nombre?: string;
	constructor(archivo: string, color: Color, tr: Transform, origen: string, sub: Submodelo, nombre?: string) {
		this.archivo = archivo;
		this.color = color;
		this.tr = tr;
		this.origen = origen;
		this.sub = sub;
		this.nombre = nombre;
	}
}

type Item = {tipo: 'pieza'; p: PiezaColocada} | {tipo: 'sub'; sub: Submodelo; tr: Transform; origen: string};

const fmt = (n: number) => {
	const r = Number(n.toFixed(6));
	return Object.is(r, -0) ? '0' : String(r);
};
const lineaRef = (color: number, tr: Transform, archivo: string) => `1 ${color} ${[...tr.t, ...tr.r].map(fmt).join(' ')} ${archivo}`;

export class Submodelo {
	readonly nombre: string;
	readonly archivo: string;
	private pasos: Item[][] = [];
	private actual: Item[] = [];
	colocado = false;

	constructor(nombre: string) {
		this.nombre = nombre;
		this.archivo = `${nombre}.ldr`;
	}

	poner(id: string, color: string | number, op: Opciones = {}): PiezaColocada {
		const origen = llamador();
		try {
			const bib = biblioteca();
			const archivo = archivoDe(id);
			const a = bib.archivo(archivo);
			if (!a || !esPieza(a)) throw new Error(`pieza inexistente: ${id}`);
			const p = new PiezaColocada(archivo, colorDe(bib, color), this.ubicar(archivo, op), origen, this, op.nombre);
			this.actual.push({tipo: 'pieza', p});
			return p;
		} catch (e) {
			throw new Error(`${origen}: ${(e as Error).message}`);
		}
	}

	private ubicar(archivo: string, op: Opciones): Transform {
		const bib = biblioteca();
		const formas = [op.en, op.sobre, op.debajo, op.conector].filter((x) => x !== undefined).length;
		if (formas > 1) throw new Error('usá una sola forma de ubicar: en, sobre, debajo o conector');
		if (op.sobre && !op.stud) throw new Error('con "sobre" hay que indicar stud: [i, j]');
		if (op.debajo && !op.antistud) throw new Error('con "debajo" hay que indicar antistud: [i, j]');
		if (op.conector && op.propio === undefined) throw new Error('con "conector" hay que indicar propio: <n>');
		const mismoSub = (p: PiezaColocada) => {
			if (p.sub !== this) throw new Error(`la pieza base está en otro submodelo (${p.sub.nombre}); encastrá dentro del mismo sub-armado`);
		};
		if (op.sobre && op.stud) {
			mismoSub(op.sobre);
			const base = puntoGrilla(ficha(bib, op.sobre.archivo).studs, op.stud, 'stud');
			const propio = puntoGrilla(ficha(bib, archivo).antistuds, op.con ?? [0, 0], 'anti-stud');
			return encastrar(op.sobre.tr, conectoresPieza(bib, op.sobre.archivo)[base.n], conectoresPieza(bib, archivo)[propio.n], op.giro ?? 0);
		}
		if (op.debajo && op.antistud) {
			mismoSub(op.debajo);
			const base = puntoGrilla(ficha(bib, op.debajo.archivo).antistuds, op.antistud, 'anti-stud');
			const propio = puntoGrilla(ficha(bib, archivo).studs, op.con ?? [0, 0], 'stud');
			return encastrar(op.debajo.tr, conectoresPieza(bib, op.debajo.archivo)[base.n], conectoresPieza(bib, archivo)[propio.n], op.giro ?? 0);
		}
		if (op.conector && op.propio !== undefined) {
			mismoSub(op.conector.de);
			const cb = conectoresPieza(bib, op.conector.de.archivo)[op.conector.n];
			const cn = conectoresPieza(bib, archivo)[op.propio];
			if (!cb) throw new Error(`conector ${op.conector.n} inexistente en ${op.conector.de.archivo}`);
			if (!cn) throw new Error(`conector ${op.propio} inexistente en ${archivo}`);
			return encastrar(op.conector.de.tr, cb, cn, op.giro ?? 0);
		}
		if (op.en) return limpiar({r: parsearRot(op.rot ?? ''), t: op.en});
		return IDENTIDAD;
	}

	contiene(otro: Submodelo): boolean {
		return [...this.pasos, this.actual].some((paso) => paso.some((it) => it.tipo === 'sub' && (it.sub === otro || it.sub.contiene(otro))));
	}

	colocar(sub: Submodelo, op: {en?: Vec3; rot?: string} = {}): void {
		const origen = llamador();
		if (sub === this || sub.contiene(this)) throw new Error(`${origen}: ciclo: ${sub.nombre} no puede ir dentro de ${this.nombre}`);
		sub.colocado = true;
		this.actual.push({tipo: 'sub', sub, tr: limpiar({r: parsearRot(op.rot ?? ''), t: op.en ?? [0, 0, 0]}), origen});
	}

	paso(): void {
		if (this.actual.length > 0) this.pasos.push(this.actual);
		this.actual = [];
	}

	// Líneas del bloque (sin "0 FILE") y mapa línea → origen, con la numeración de pasosDe (1 = primera).
	lineas(): {lineas: string[]; mapa: [number, string][]} {
		const lineas = [`0 ${this.nombre}`, `0 Name: ${this.archivo}`, '0 Author: taller'];
		const mapa: [number, string][] = [];
		const pasos = this.actual.length > 0 ? [...this.pasos, this.actual] : this.pasos;
		for (const paso of pasos) {
			for (const it of paso) {
				if (it.tipo === 'pieza') {
					lineas.push(lineaRef(it.p.color.codigo, it.p.tr, it.p.archivo));
					mapa.push([lineas.length, it.p.nombre ? `${it.p.origen} (${it.p.nombre})` : it.p.origen]);
				} else {
					lineas.push(lineaRef(16, it.tr, it.sub.archivo));
					mapa.push([lineas.length, `${it.origen} (${it.sub.nombre})`]);
				}
			}
			lineas.push('0 STEP');
		}
		return {lineas, mapa};
	}
}

export class Modelo {
	readonly nombre: string;
	readonly raiz: Submodelo;
	private subs = new Map<string, Submodelo>();

	constructor(nombre: string) {
		this.nombre = sanear(nombre);
		this.raiz = new Submodelo(this.nombre);
	}

	sub(nombre: string): Submodelo {
		const n = sanear(nombre);
		if (this.subs.has(n) || n === this.nombre) throw new Error(`${llamador()}: el submodelo "${n}" ya existe`);
		const s = new Submodelo(n);
		this.subs.set(n, s);
		return s;
	}

	texto(): {mpd: string; mapa: Record<string, string>} {
		const out: string[] = [];
		const mapa: Record<string, string> = {};
		for (const s of [this.raiz, ...this.subs.values()]) {
			if (s !== this.raiz && !s.colocado) console.error(`aviso: el submodelo "${s.nombre}" no se colocó en ningún lado`);
			const {lineas, mapa: m} = s.lineas();
			out.push(`0 FILE ${s.archivo}`, ...lineas, '0 NOFILE');
			for (const [n, origen] of m) mapa[`${s.archivo}:${n}`] = origen;
		}
		return {mpd: out.join('\n') + '\n', mapa};
	}

	guardar(ruta?: string): string {
		const destino = process.env.TALLER_SALIDA ?? ruta ?? 'modelo.mpd';
		const {mpd, mapa} = this.texto();
		writeFileSync(destino, mpd);
		writeFileSync(destino.replace(/\.mpd$/i, '') + '.mapa.json', JSON.stringify(mapa, null, 1));
		return destino;
	}
}
```

- [ ] **Paso 4: correr los tests y ver que pasan**

Correr: `cd taller && node --no-warnings --test pruebas/dsl.test.ts && npm run tipos`
Esperado: 6 tests en PASS; `tsc` sin errores.

- [ ] **Paso 5: commit**

```bash
git add taller/src/dsl.ts taller/pruebas/dsl.test.ts taller/pruebas/fixtures/dos-ladrillos.ts
git commit -m "taller: API de script de diseño con encastre y mapa a líneas del script"
```

---

### Tarea 6: CLI (piezas, construir, validar)

**Archivos:**
- Crear: `taller/src/cli.ts`, `taller/src/validar.ts`, `taller/pruebas/fixtures/flotante.ts`
- Test: `taller/pruebas/cli.test.ts`

**Interfaces:**
- Consume: `catalogo`, `buscar`, `construirCatalogo`, `ficha`, `combinaciones`, `nuevaBiblioteca`, `verificar`, `colorDe`
- Produce:
  - `validarModelo(ruta: string, sub?: string): Promise<ResultadoValidar>` y `nombreSub(sub: string): string`, exportadas desde `taller/src/validar.ts` para que las usen `render` (Tarea 7) y `metricas` (Tarea 8)
  - `type ResultadoValidar = {ok: boolean; piezas: number; pasos: number; submodelos: number; errores: HallazgoTaller[]; avisos: HallazgoTaller[]}`
  - `type HallazgoTaller = {regla: string; mensaje: string; submodelo?: string; paso?: number; donde: string[]}`
  - Salidas del CLI: JSON por stdout. Códigos de salida: 0 bien, 1 errores del modelo, 2 uso incorrecto.

- [ ] **Paso 1: escribir el fixture y el test que falla**

`taller/pruebas/fixtures/flotante.ts`:
```ts
import {Modelo} from '../../src/dsl.ts';

const m = new Modelo('flotante');
m.raiz.poner('3001', 'Red');
m.raiz.paso();
m.raiz.poner('3001', 'Blue', {en: [200, -200, 0], nombre: 'en-el-aire'});
m.raiz.paso();
m.guardar();
```

`taller/pruebas/cli.test.ts`:
```ts
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {pathToFileURL} from 'node:url';

const CLI = join(import.meta.dirname, '../src/cli.ts');
const correr = (args: string[], cwd?: string) => spawnSync(process.execPath, ['--no-warnings', CLI, ...args], {encoding: 'utf8', cwd});

test('piezas buscar devuelve JSON ordenado por frecuencia', () => {
	const r = correr(['piezas', 'buscar', 'brick', '2', 'x', '4', '--max', '3']);
	assert.equal(r.status, 0, r.stderr);
	const j = JSON.parse(r.stdout);
	assert.equal(j[0].id, '3001');
	assert.equal(j.length, 3);
});

test('piezas ver 3001', () => {
	const r = correr(['piezas', 'ver', '3001']);
	assert.equal(r.status, 0, r.stderr);
	const j = JSON.parse(r.stdout);
	assert.equal(j.studs.cantidad, 8);
	assert.ok(j.colores.some((c: {codigo: number}) => c.codigo === 4));
});

test('construir en una carpeta con espacios y validar OK', () => {
	const dir = mkdtempSync(join(tmpdir(), 'taller cli '));
	const script = join(dir, 'mi diseno.ts');
	// El fixture importa '../../src/dsl.ts'; desde otra carpeta hace falta una URL file:// absoluta
	// (en Windows, "C:/…" como especificador ESM se lee como un esquema "c:").
	const fuente = readFileSync(join(import.meta.dirname, 'fixtures/dos-ladrillos.ts'), 'utf8');
	writeFileSync(script, fuente.replace('../../src/dsl.ts', pathToFileURL(join(import.meta.dirname, '../src/dsl.ts')).href));
	const c = correr(['construir', script, '--salida', join(dir, 'modelo.mpd')], dir);
	assert.equal(c.status, 0, c.stderr);
	assert.ok(existsSync(join(dir, 'modelo.mpd')));
	const v = correr(['validar', join(dir, 'modelo.mpd')], dir);
	assert.equal(v.status, 0, v.stdout + v.stderr);
	assert.equal(JSON.parse(v.stdout).ok, true);
});

test('validar un modelo roto señala la línea del script', () => {
	const dir = mkdtempSync(join(tmpdir(), 'taller cli '));
	const c = correr(['construir', join(import.meta.dirname, 'fixtures/flotante.ts'), '--salida', join(dir, 'modelo.mpd')], dir);
	assert.equal(c.status, 0, c.stderr);
	const v = correr(['validar', join(dir, 'modelo.mpd')], dir);
	assert.equal(v.status, 1);
	const j = JSON.parse(v.stdout);
	assert.equal(j.ok, false);
	// El verificador puede señalar la pieza suelta, la base o las dos: alcanza con que traduzca a líneas del script.
	assert.ok(j.errores.some((e: {donde: string[]}) => e.donde.some((d) => /flotante\.ts:\d+/.test(d))), v.stdout);
});

test('comando desconocido: código 2 y uso', () => {
	const r = correr(['volar']);
	assert.equal(r.status, 2);
	assert.match(r.stderr, /Uso:/);
});
```

- [ ] **Paso 2: correrlo y ver que falla**

Correr: `cd taller && node --no-warnings --test pruebas/cli.test.ts`
Esperado: FALLA, porque `src/cli.ts` no existe (status ≠ 0).

- [ ] **Paso 3: implementar `validar.ts`**

`taller/src/validar.ts`:
```ts
// Corre el verificador y traduce las ubicaciones "submodelo:línea" a líneas del script de diseño.

import {existsSync, readFileSync} from 'node:fs';
import {basename} from 'node:path';
import {normalizarNombre} from '../../verificador/src/ldraw.ts';
import {verificar} from '../../verificador/src/verificar.ts';
import {combinaciones} from './colores.ts';
import {nuevaBiblioteca} from './entorno.ts';

export type HallazgoTaller = {regla: string; mensaje: string; submodelo?: string; paso?: number; donde: string[]};
export type ResultadoValidar = {ok: boolean; piezas: number; pasos: number; submodelos: number; errores: HallazgoTaller[]; avisos: HallazgoTaller[]};

export const nombreSub = (sub: string) => normalizarNombre(/\.(ldr|dat|mpd)$/i.test(sub) ? sub : `${sub}.ldr`);

export async function validarModelo(ruta: string, sub?: string): Promise<ResultadoValidar> {
	const rutaMapa = ruta.replace(/\.mpd$/i, '') + '.mapa.json';
	const mapa: Record<string, string> = existsSync(rutaMapa) ? JSON.parse(readFileSync(rutaMapa, 'utf8')) : {};
	const bib = nuevaBiblioteca();
	const principal = bib.cargarModelo(ruta, basename(ruta));
	const raiz = sub ? nombreSub(sub) : principal;
	if (!bib.archivo(raiz)) throw new Error(`no existe el submodelo ${sub}`);
	const rep = verificar(bib, raiz, {combinacionesConocidas: await combinaciones()});
	const traducir = (h: (typeof rep.hallazgos)[number]): HallazgoTaller => ({
		regla: h.regla,
		mensaje: h.mensaje,
		submodelo: h.submodelo,
		paso: h.paso,
		donde: (h.piezas ?? []).map((p) => mapa[p] ?? p),
	});
	const errores = rep.hallazgos.filter((h) => h.severidad === 'error').map(traducir);
	const avisos = rep.hallazgos.filter((h) => h.severidad === 'aviso').map(traducir);
	return {ok: errores.length === 0, piezas: rep.piezas, pasos: rep.pasos, submodelos: rep.submodelos, errores, avisos};
}
```

- [ ] **Paso 4: implementar `cli.ts`**

`taller/src/cli.ts`:
```ts
// Uso: node --no-warnings taller/src/cli.ts <comando> …
//   piezas buscar <texto…> [--categoria <c>] [--max <n>] [--todas]
//   piezas ver <id>
//   piezas reindexar
//   construir <diseno.ts> [--salida <modelo.mpd>]
//   validar <modelo.mpd> [--sub <nombre>]
//   render <modelo.mpd> --salida <carpeta> [--vistas 34,frente,lado,arriba] [--lado <px>] [--modo color|silueta] [--paso <n>] [--sub <nombre>]
//   metricas <modelo.mpd>
// Salida en JSON por stdout. Código de salida: 0 bien, 1 el modelo tiene errores, 2 uso incorrecto.

import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {buscar, catalogo, construirCatalogo} from './catalogo.ts';
import {colorDe} from './colores.ts';
import {biblioteca} from './entorno.ts';
import {ficha} from './ficha.ts';
import {validarModelo} from './validar.ts';

const USO = `Uso: node --no-warnings taller/src/cli.ts <comando> …
  piezas buscar <texto…> [--categoria <c>] [--max <n>] [--todas]
  piezas ver <id>
  piezas reindexar
  construir <diseno.ts> [--salida <modelo.mpd>]
  validar <modelo.mpd> [--sub <nombre>]
  render <modelo.mpd> --salida <carpeta> [--vistas 34,frente,lado,arriba] [--lado <px>] [--modo color|silueta] [--paso <n>] [--sub <nombre>]
  metricas <modelo.mpd>`;

const CON_VALOR = new Set(['--categoria', '--max', '--salida', '--sub', '--vistas', '--lado', '--modo', '--paso']);
const args = process.argv.slice(2);
const opcion = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const posicionales = args.filter((a, i) => !a.startsWith('--') && !CON_VALOR.has(args[i - 1] ?? ''));
const salir = (codigo: number, mensaje?: string): never => {
	if (mensaje) console.error(mensaje);
	process.exit(codigo);
};
const imprimir = (x: unknown) => console.log(JSON.stringify(x, null, 2));

const [comando, ...resto] = posicionales;
try {
	switch (comando) {
		case 'piezas': {
			const [sub, ...texto] = resto;
			if (sub === 'buscar') {
				imprimir(buscar(await catalogo(), texto.join(' '), {categoria: opcion('--categoria'), max: opcion('--max') ? Number(opcion('--max')) : undefined, todas: args.includes('--todas')}));
			} else if (sub === 'ver' && texto[0]) {
				const bib = biblioteca();
				const f = ficha(bib, texto[0]);
				const entrada = (await catalogo()).find((e) => e.id === f.id);
				const grilla = (g: typeof f.studs) => ({
					cantidad: g.puntos.length,
					columnas: g.columnas,
					filas: g.filas,
					// Solo se listan si la grilla tiene huecos.
					...(g.puntos.length < g.columnas * g.filas ? {puntos: g.puntos.map((p) => [p.i, p.j])} : {}),
				});
				imprimir({
					id: f.id,
					titulo: f.titulo,
					tamano: f.tamano,
					studs: grilla(f.studs),
					antistuds: grilla(f.antistuds),
					otros: f.otros,
					colores: (entrada?.colores ?? []).map((c) => ({codigo: c, nombre: colorDe(bib, c).nombre})),
					frecuencia: entrada?.frecuencia ?? 0,
				});
			} else if (sub === 'reindexar') {
				imprimir({piezas: (await construirCatalogo()).length});
			} else salir(2, USO);
			break;
		}
		case 'construir': {
			if (!resto[0]) salir(2, USO);
			const salida = resolve(opcion('--salida') ?? 'modelo.mpd');
			const r = spawnSync(process.execPath, ['--no-warnings', resolve(resto[0])], {stdio: 'inherit', env: {...process.env, TALLER_SALIDA: salida}});
			if (r.status !== 0) salir(1);
			imprimir({modelo: salida});
			break;
		}
		case 'validar': {
			if (!resto[0]) salir(2, USO);
			const r = await validarModelo(resolve(resto[0]), opcion('--sub'));
			imprimir(r);
			if (!r.ok) salir(1);
			break;
		}
		default:
			salir(2, USO);
	}
} catch (e) {
	salir(1, `error: ${(e as Error).message}`);
}
```

- [ ] **Paso 5: correr los tests y ver que pasan**

Correr: `cd taller && npm test && npm run tipos`
Esperado: todos en PASS (colores, catálogo, ficha, encastre, dsl, cli).

- [ ] **Paso 6: commit**

```bash
git add taller/src/cli.ts taller/src/validar.ts taller/pruebas/cli.test.ts taller/pruebas/fixtures/flotante.ts
git commit -m "taller: CLI con piezas, construir y validar"
```

---

### Tarea 7: render de varias vistas

**Archivos:**
- Crear: `estudio/src/taller/Vistas.tsx`, `taller/src/render.ts`
- Modificar: `estudio/src/Root.tsx` (registrar la composición), `taller/src/cli.ts` (comando `render`)
- Test: `taller/pruebas/render/render.test.ts` (lento; se corre con `npm run test:render`)

**Interfaces:**
- Consume: `DIR_ESTUDIO`, `DIR_CACHE`, `nombreSub` (de `validar.ts`), `estudio/scripts/empaquetar.mjs <entrada> <salida>`, `estudio/scripts/render-secuencias.mjs <trabajos.json>` (formato de trabajo `{composicion, props, salida, fotogramas?}`; la imagen queda en `<salida>/element-<n>.png`)
- Produce:
  - Composición `taller-vistas`, props `PropsVistas = {modelo: string; vistas: string[]; lado: number; modo: 'color' | 'silueta'; paso?: number}`, donde `paso` es base 0 (se muestra lo colocado hasta ese paso inclusive; sin `paso` se muestra todo).
  - `type PedidoRender = {modelo: string; sub?: string; vistas: string[]; lado: number; modo: 'color' | 'silueta'; paso?: number /* base 1 */; salida: string /* .png */}`
  - `renderizar(pedidos: PedidoRender[]): void` (un solo bundle y un solo navegador para todos)
  - `extraerSub(mpd: string, sub: string): string` (pone primero el bloque del submodelo)
  - `VISTAS = ['34', '34atras', 'frente', 'lado', 'arriba']`

- [ ] **Paso 1: escribir la composición**

`estudio/src/taller/Vistas.tsx`:
```tsx
// Vistas para el taller de diseño: una grilla de vistas ortográficas del modelo en una sola imagen.
// El encuadre es siempre el del modelo completo, para que las imágenes de distintos pasos sean
// comparables (la métrica de cambio de silueta las resta píxel a píxel).

import {ThreeCanvas} from '@remotion/three';
import {useThree} from '@react-three/fiber';
import {useEffect, useMemo, useState} from 'react';
import {AbsoluteFill, CalculateMetadataFunction, continueRender, delayRender, staticFile} from 'remotion';
import type {LineSegments, Mesh, Object3D, OrthographicCamera} from 'three';
import {Box3, MeshBasicMaterial, Sphere, Vector3} from 'three';
import {cargarModelo, Modelo} from '../armado/cargarModelo';

export type PropsVistas = {
	modelo: string; // ruta dentro de public/
	vistas: string[];
	lado: number; // píxeles por vista
	modo: 'color' | 'silueta';
	paso?: number; // base 0: lo colocado hasta ese paso inclusive; sin paso, todo
};

// Direcciones en el mundo de three (el modelo se carga girado π en X: el frente LDraw, −Z, queda en +Z).
const DIRECCIONES: Record<string, {dir: Vector3; arriba: Vector3}> = {
	'34': {dir: new Vector3(-1, 0.9, 1.1).normalize(), arriba: new Vector3(0, 1, 0)},
	'34atras': {dir: new Vector3(1, 0.9, -1.1).normalize(), arriba: new Vector3(0, 1, 0)},
	frente: {dir: new Vector3(0, 0, 1), arriba: new Vector3(0, 1, 0)},
	lado: {dir: new Vector3(1, 0, 0), arriba: new Vector3(0, 1, 0)},
	arriba: {dir: new Vector3(0, 1, 0), arriba: new Vector3(0, 0, -1)},
};

const columnasPara = (n: number) => (n <= 2 ? n : n <= 4 ? 2 : 3);

export const metadatosVistas: CalculateMetadataFunction<PropsVistas> = async ({props}) => {
	const n = Math.max(1, props.vistas.length);
	const columnas = columnasPara(n);
	return {width: columnas * props.lado, height: Math.ceil(n / columnas) * props.lado, durationInFrames: 1};
};

const NEGRO = new MeshBasicMaterial({color: '#000000'});

const Luces = () => (
	<>
		<hemisphereLight args={['#ffffff', '#b0a898', 1.9]} />
		<directionalLight position={[-300, 800, 500]} intensity={1.8} />
		<directionalLight position={[600, 200, -300]} intensity={0.5} />
	</>
);

function Camara({esfera, dir, arriba, lado}: {esfera: Sphere; dir: Vector3; arriba: Vector3; lado: number}) {
	const camera = useThree((s) => s.camera) as OrthographicCamera;
	const r = Math.max(esfera.radius, 1);
	camera.position.copy(esfera.center).addScaledVector(dir, r * 4);
	camera.up.copy(arriba);
	camera.near = 0.1;
	camera.far = r * 10;
	camera.zoom = lado / (2 * r * 1.05);
	camera.lookAt(esfera.center);
	camera.updateProjectionMatrix();
	return null;
}

// Copia del modelo para una vista (un objeto de three no puede estar en dos escenas), con la
// visibilidad del paso y, en modo silueta, todo negro y sin bordes.
function copiaPara(m: Modelo, paso: number | undefined, modo: PropsVistas['modo']): Object3D {
	const raiz = m.raiz.clone();
	raiz.children.forEach((hijo) => {
		const p = hijo.userData.buildingStep ?? 0;
		hijo.visible = paso === undefined || p <= paso;
	});
	if (modo === 'silueta')
		raiz.traverse((o) => {
			if ((o as Mesh).isMesh) (o as Mesh).material = NEGRO;
			else if ((o as LineSegments).isLineSegments) o.visible = false;
		});
	return raiz;
}

export const Vistas: React.FC<PropsVistas> = ({modelo, vistas, lado, modo, paso}) => {
	const [m, setM] = useState<Modelo | null>(null);
	const [handle] = useState(() => delayRender('Cargando modelo', {timeoutInMilliseconds: 10 * 60 * 1000}));
	useEffect(() => {
		cargarModelo(staticFile(modelo)).then((x) => {
			setM(x);
			continueRender(handle);
		});
	}, [modelo, handle]);
	const esfera = useMemo(() => (m ? new Box3().setFromObject(m.raiz).getBoundingSphere(new Sphere()) : null), [m]);
	const columnas = columnasPara(Math.max(1, vistas.length));
	return (
		<AbsoluteFill style={{background: '#ffffff', display: 'grid', gridTemplateColumns: `repeat(${columnas}, ${lado}px)`, gridAutoRows: `${lado}px`}}>
			{m && esfera
				? vistas.map((v) => {
						const d = DIRECCIONES[v] ?? DIRECCIONES['34'];
						return (
							<ThreeCanvas key={v} width={lado} height={lado} orthographic camera={{position: [0, 0, 1000]}}>
								{modo === 'color' ? <Luces /> : null}
								<Camara esfera={esfera} dir={d.dir} arriba={d.arriba} lado={lado} />
								<primitive object={copiaPara(m, paso, modo)} />
							</ThreeCanvas>
						);
					})
				: null}
		</AbsoluteFill>
	);
};
```

- [ ] **Paso 2: registrarla en `estudio/src/Root.tsx`**

Agregar el import junto a los otros:
```tsx
import {metadatosVistas, PropsVistas, Vistas} from './taller/Vistas';
```
Agregar la carpeta después de `<Folder name="sets-test">…</Folder>`:
```tsx
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
```

Correr: `cd estudio && npx tsc -p . --noEmit`
Esperado: sin errores.

- [ ] **Paso 3: escribir el test que falla**

`taller/pruebas/render/render.test.ts`:
```ts
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {PNG} from 'pngjs';
import {RAIZ} from '../../src/entorno.ts';
import {extraerSub, renderizar} from '../../src/render.ts';

const SET = join(RAIZ, 'referencias/sets-test/modelos/40014-1.mpd');

test('extraerSub pone primero el bloque pedido', () => {
	const mpd = '0 FILE a.ldr\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 b.ldr\n0 NOFILE\n0 FILE b.ldr\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat\n0 NOFILE\n';
	assert.ok(extraerSub(mpd, 'b').startsWith('0 FILE b.ldr\n'));
	assert.throws(() => extraerSub(mpd, 'c'), /no existe el submodelo c/);
});

test('grilla de 4 vistas en color y silueta a 64 px', {timeout: 10 * 60 * 1000}, () => {
	const dir = mkdtempSync(join(tmpdir(), 'taller render '));
	const color = join(dir, 'color.png');
	const silueta = join(dir, 'silueta.png');
	renderizar([
		{modelo: SET, vistas: ['34', 'frente', 'lado', '34atras'], lado: 256, modo: 'color', salida: color},
		{modelo: SET, vistas: ['frente'], lado: 64, modo: 'silueta', salida: silueta},
	]);
	assert.ok(existsSync(color) && existsSync(silueta));
	const c = PNG.sync.read(readFileSync(color));
	assert.deepEqual([c.width, c.height], [512, 512]);
	const s = PNG.sync.read(readFileSync(silueta));
	assert.deepEqual([s.width, s.height], [64, 64]);
	// Silueta: casi todo negro o blanco (el antialiasing deja grises en el borde).
	let extremos = 0;
	let negros = 0;
	for (let i = 0; i < s.data.length; i += 4) {
		const v = s.data[i];
		if (v < 32 || v > 223) extremos++;
		if (v < 128) negros++;
	}
	assert.ok(extremos / (s.width * s.height) > 0.9);
	assert.ok(negros > 0);
});
```

- [ ] **Paso 4: correrlo y ver que falla**

Correr: `cd taller && npm run test:render`
Esperado: FALLA, no encuentra el módulo `../../src/render.ts`.

- [ ] **Paso 5: implementar `render.ts`**

`taller/src/render.ts`:
```ts
// Render de vistas con estudio/ (Remotion): empaqueta cada modelo en estudio/public/taller/ y ejecuta
// render-secuencias.mjs una sola vez para todos los pedidos (un bundle, un navegador).

import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {normalizarNombre} from '../../verificador/src/ldraw.ts';
import {DIR_CACHE, DIR_ESTUDIO} from './entorno.ts';
import {nombreSub} from './validar.ts';

export const VISTAS = ['34', '34atras', 'frente', 'lado', 'arriba'];

export type PedidoRender = {modelo: string; sub?: string; vistas: string[]; lado: number; modo: 'color' | 'silueta'; paso?: number; salida: string};

export function extraerSub(mpd: string, sub: string): string {
	const bloques = mpd.replace(/\r\n?/g, '\n').split(/^(?=0 FILE )/m).filter((b) => b.startsWith('0 FILE '));
	const buscado = nombreSub(sub);
	const i = bloques.findIndex((b) => normalizarNombre(b.slice(7, b.indexOf('\n'))) === buscado);
	if (i < 0) throw new Error(`no existe el submodelo ${sub}`);
	return [bloques[i], ...bloques.filter((_, k) => k !== i)].join('');
}

function ejecutar(script: string, args: string[]) {
	const r = spawnSync(process.execPath, [join(DIR_ESTUDIO, 'scripts', script), ...args], {cwd: DIR_ESTUDIO, encoding: 'utf8'});
	if (r.status !== 0) throw new Error(`${script} falló:\n${r.stdout}\n${r.stderr}`);
}

// Empaqueta (con caché por contenido) y devuelve la ruta relativa a estudio/public.
function empaquetar(modelo: string, sub?: string): string {
	let texto = readFileSync(modelo, 'latin1');
	if (sub) texto = extraerSub(texto, sub);
	const hash = createHash('sha1').update(texto).digest('hex').slice(0, 12);
	const relativa = `taller/${hash}.packed.mpd`;
	const destino = join(DIR_ESTUDIO, 'public', relativa);
	if (!existsSync(destino)) {
		mkdirSync(join(DIR_CACHE, 'render'), {recursive: true});
		const entrada = join(DIR_CACHE, 'render', `${hash}.mpd`);
		writeFileSync(entrada, texto, 'latin1');
		mkdirSync(dirname(destino), {recursive: true});
		ejecutar('empaquetar.mjs', [entrada, destino]);
	}
	return relativa;
}

export function renderizar(pedidos: PedidoRender[]): void {
	if (pedidos.length === 0) return;
	const lote = join(DIR_CACHE, 'render', `lote-${process.pid}-${Date.now()}`);
	mkdirSync(lote, {recursive: true});
	const trabajos = pedidos.map((p, k) => {
		for (const v of p.vistas) if (!VISTAS.includes(v)) throw new Error(`vista desconocida: ${v} (vistas: ${VISTAS.join(', ')})`);
		return {
			composicion: 'taller-vistas',
			props: {modelo: empaquetar(p.modelo, p.sub), vistas: p.vistas, lado: p.lado, modo: p.modo, ...(p.paso ? {paso: p.paso - 1} : {})},
			salida: join(lote, String(k)),
			fotogramas: [0],
		};
	});
	const rutaTrabajos = join(lote, 'trabajos.json');
	writeFileSync(rutaTrabajos, JSON.stringify(trabajos));
	ejecutar('render-secuencias.mjs', [rutaTrabajos]);
	pedidos.forEach((p, k) => {
		mkdirSync(dirname(p.salida), {recursive: true});
		copyFileSync(join(lote, String(k), 'element-0.png'), p.salida);
	});
}
```

- [ ] **Paso 6: agregar `render` al CLI**

En `taller/src/cli.ts`, agregar el import:
```ts
import {join} from 'node:path';
import {renderizar} from './render.ts';
```
(fusionar `join` con el import de `node:path` que ya existe: `import {join, resolve} from 'node:path';`)

Agregar el caso antes de `default:`:
```ts
		case 'render': {
			const salidaDir = opcion('--salida');
			if (!resto[0] || !salidaDir) salir(2, USO);
			const vistas = (opcion('--vistas') ?? '34,frente,lado,arriba').split(',').map((v) => v.trim()).filter(Boolean);
			const lado = Number(opcion('--lado') ?? 512);
			const modo = opcion('--modo') === 'silueta' ? 'silueta' : 'color';
			const paso = opcion('--paso') ? Number(opcion('--paso')) : undefined;
			const sub = opcion('--sub');
			const nombre = ['vistas', vistas.join('-'), lado, modo, ...(paso ? [`paso${paso}`] : []), ...(sub ? [sub] : [])].join('_') + '.png';
			const png = join(resolve(salidaDir!), nombre);
			renderizar([{modelo: resolve(resto[0]), sub, vistas, lado, modo, paso, salida: png}]);
			imprimir({imagen: png});
			break;
		}
```

- [ ] **Paso 7: correr los tests de render y ver que pasan**

Correr: `cd taller && npm run test:render`
Esperado: 2 tests en PASS. Mirar a ojo `color.png` (la ruta queda en el directorio temporal): 4 vistas del set, todas encuadradas.

- [ ] **Paso 8: agregar `estudio/public/taller/` al `.gitignore`**

Agregar al final de `.gitignore` de la raíz:
```
estudio/public/taller/
```

- [ ] **Paso 9: commit**

```bash
git add estudio/src/taller/Vistas.tsx estudio/src/Root.tsx taller/src/render.ts taller/src/cli.ts taller/pruebas/render/render.test.ts .gitignore
git commit -m "taller: render de grilla de vistas (color y silueta) con estudio"
```

---

### Tarea 8: imagen y métricas

**Archivos:**
- Crear: `taller/src/imagen.ts`, `taller/src/metricas.ts`
- Modificar: `taller/src/cli.ts` (comando `metricas`)
- Test: `taller/pruebas/imagen.test.ts` (rápido), `taller/pruebas/render/metricas.test.ts` (lento)

**Interfaces:**
- Consume: `renderizar`, `validarModelo`, `nuevaBiblioteca`, `pasosDe`, `esPieza`, `componer`, `IDENTIDAD`, `mallaDe`, `cajaEnMundo`, `cajaVacia`, `expandirCaja`
- Produce:
  - `type Imagen = {ancho: number; alto: number; negro: Uint8Array}`
  - `leerBinaria(ruta: string): Imagen` (negro = luminancia < 128)
  - `dimensionFractal(img: Imagen): number`: conteo de cajas sobre el **borde** de la silueta, cajas de 2 hasta lado/4
  - `cambioSilueta(pasos: Imagen[]): {porPaso: number[]; media: number; min: number; pasosInvisibles: number}`
  - `type Metricas = {valido; piezas; pasos; submodelos; colores; noBasicas; piezasPorPaso: {media; max}; studs: {ancho; fondo; alto}; fractal; cambioSilueta: {media; min; pasosInvisibles}; errores: number; avisos: number}`
  - `metricas(ruta: string): Promise<Metricas>`
  - `esBasica(titulo: string): boolean`

- [ ] **Paso 1: escribir el test rápido que falla**

`taller/pruebas/imagen.test.ts`:
```ts
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cambioSilueta, dimensionFractal, type Imagen} from '../src/imagen.ts';
import {esBasica} from '../src/metricas.ts';

const vacia = (n: number): Imagen => ({ancho: n, alto: n, negro: new Uint8Array(n * n)});

test('una línea vertical tiene dimensión ~1', () => {
	const img = vacia(256);
	for (let y = 0; y < 256; y++) img.negro[y * 256 + 100] = 1;
	assert.ok(Math.abs(dimensionFractal(img) - 1) < 0.05);
});

test('un tablero de 1 px tiene dimensión ~2', () => {
	const img = vacia(256);
	for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) img.negro[y * 256 + x] = (x + y) % 2;
	assert.ok(Math.abs(dimensionFractal(img) - 2) < 0.05);
});

test('un cuadrado lleno se mide por su borde: ~1', () => {
	const img = vacia(256);
	for (let y = 64; y < 192; y++) for (let x = 64; x < 192; x++) img.negro[y * 256 + x] = 1;
	assert.ok(Math.abs(dimensionFractal(img) - 1) < 0.1);
});

test('cambioSilueta: fracción de píxeles cambiados sobre el área final', () => {
	const a = vacia(10);
	const b = vacia(10);
	const c = vacia(10);
	for (let i = 0; i < 10; i++) (b.negro[i] = 1), (c.negro[i] = 1);
	for (let i = 10; i < 20; i++) c.negro[i] = 1;
	const r = cambioSilueta([a, b, c, c]);
	assert.deepEqual(r.porPaso, [0, 0.5, 0.5, 0]);
	assert.equal(r.pasosInvisibles, 2);
	assert.equal(r.min, 0);
});

test('esBasica', () => {
	assert.equal(esBasica('Brick  2 x  4'), true);
	assert.equal(esBasica('Plate  1 x  2'), true);
	assert.equal(esBasica('Brick  1 x  1 x  5'), true);
	assert.equal(esBasica('Tile  2 x  2'), true);
	assert.equal(esBasica('Slope Brick 45  2 x  2'), false);
	assert.equal(esBasica('Brick  1 x  1 with Stud on 1 Side'), false);
	assert.equal(esBasica('Tile  2 x  2 Round'), false);
});
```

- [ ] **Paso 2: correrlo y ver que falla**

Correr: `cd taller && node --no-warnings --test pruebas/imagen.test.ts`
Esperado: FALLA, no encuentra el módulo `../src/imagen.ts`.

- [ ] **Paso 3: implementar `imagen.ts`**

`taller/src/imagen.ts`:
```ts
// Siluetas: PNG → imagen binaria, dimensión fractal del borde (conteo de cajas) y cambio entre pasos.
// La dimensión fractal se mide sobre el borde, como en los estudios de preferencia (Spehar et al.
// 2003; Hagerhall et al. 2004), donde las siluetas naturales preferidas están cerca de 1,3–1,5.

import {readFileSync} from 'node:fs';
import {PNG} from 'pngjs';

export type Imagen = {ancho: number; alto: number; negro: Uint8Array};

export function leerBinaria(ruta: string): Imagen {
	const png = PNG.sync.read(readFileSync(ruta));
	const negro = new Uint8Array(png.width * png.height);
	for (let i = 0; i < negro.length; i++) {
		const [r, g, b] = [png.data[i * 4], png.data[i * 4 + 1], png.data[i * 4 + 2]];
		negro[i] = 0.299 * r + 0.587 * g + 0.114 * b < 128 ? 1 : 0;
	}
	return {ancho: png.width, alto: png.height, negro};
}

function borde({ancho, alto, negro}: Imagen): Uint8Array {
	const b = new Uint8Array(ancho * alto);
	for (let y = 0; y < alto; y++)
		for (let x = 0; x < ancho; x++) {
			const i = y * ancho + x;
			if (!negro[i]) continue;
			const orilla = x === 0 || y === 0 || x === ancho - 1 || y === alto - 1;
			if (orilla || !negro[i - 1] || !negro[i + 1] || !negro[i - ancho] || !negro[i + ancho]) b[i] = 1;
		}
	return b;
}

function pendiente(xs: number[], ys: number[]): number {
	const n = xs.length;
	const mx = xs.reduce((s, x) => s + x, 0) / n;
	const my = ys.reduce((s, y) => s + y, 0) / n;
	let num = 0;
	let den = 0;
	for (let i = 0; i < n; i++) (num += (xs[i] - mx) * (ys[i] - my)), (den += (xs[i] - mx) ** 2);
	return den === 0 ? 0 : num / den;
}

export function dimensionFractal(img: Imagen): number {
	const b = borde(img);
	const xs: number[] = [];
	const ys: number[] = [];
	for (let s = 2; s <= Math.min(img.ancho, img.alto) / 4; s *= 2) {
		let n = 0;
		for (let by = 0; by < img.alto; by += s)
			for (let bx = 0; bx < img.ancho; bx += s) {
				let hay = false;
				for (let y = by; y < Math.min(by + s, img.alto) && !hay; y++)
					for (let x = bx; x < Math.min(bx + s, img.ancho); x++)
						if (b[y * img.ancho + x]) {
							hay = true;
							break;
						}
				if (hay) n++;
			}
		if (n > 0) xs.push(Math.log(1 / s)), ys.push(Math.log(n));
	}
	return xs.length < 2 ? 0 : pendiente(xs, ys);
}

const INVISIBLE = 0.01;

export function cambioSilueta(pasos: Imagen[]) {
	if (pasos.length === 0) return {porPaso: [], media: 0, min: 0, pasosInvisibles: 0};
	const final = pasos[pasos.length - 1].negro.reduce((s, v) => s + v, 0) || 1;
	let previo = new Uint8Array(pasos[0].negro.length);
	const porPaso = pasos.map((img) => {
		let distintos = 0;
		for (let i = 0; i < img.negro.length; i++) if (img.negro[i] !== previo[i]) distintos++;
		previo = img.negro;
		return distintos / final;
	});
	return {
		porPaso,
		media: porPaso.reduce((s, x) => s + x, 0) / porPaso.length,
		min: Math.min(...porPaso),
		pasosInvisibles: porPaso.filter((x) => x < INVISIBLE).length,
	};
}
```

> El test de `cambioSilueta` espera `porPaso[0] = 0` para un primer paso vacío: `a` no tiene píxeles negros, así que no cambia nada. Es correcto y cuenta como paso invisible.

- [ ] **Paso 4: implementar `metricas.ts`**

`taller/src/metricas.ts`:
```ts
// Métricas de un modelo. Informan, no deciden: ver diseno/proceso.md, "Calidad: tres capas".

import {mkdirSync} from 'node:fs';
import {basename, join} from 'node:path';
import {cajaEnMundo, mallaDe} from '../../verificador/src/geometria.ts';
import type {Biblioteca} from '../../verificador/src/ldraw.ts';
import {esPieza, pasosDe} from '../../verificador/src/ldraw.ts';
import type {Transform} from '../../verificador/src/matematica.ts';
import {cajaVacia, componer, expandirCaja, IDENTIDAD} from '../../verificador/src/matematica.ts';
import {DIR_CACHE, nuevaBiblioteca} from './entorno.ts';
import {cambioSilueta, dimensionFractal, leerBinaria} from './imagen.ts';
import {renderizar, type PedidoRender} from './render.ts';
import {validarModelo} from './validar.ts';

export const esBasica = (titulo: string) => /^(Brick|Plate|Tile)\s+\d+\s+x\s+\d+(\s+x\s+\d+)?$/.test(titulo.trim());

type PiezaPlana = {archivo: string; color: number; tr: Transform};

// Piezas del modelo en coordenadas del principal y archivos de submodelo usados.
function recorrer(bib: Biblioteca, nombre: string, tr: Transform, color: number, piezas: PiezaPlana[], subs: Set<string>) {
	for (const paso of pasosDe(bib.archivo(nombre)!))
		for (const ref of paso.refs) {
			const a = bib.archivo(ref.archivo);
			const t = componer(tr, ref.transform);
			const c = ref.color === 16 ? color : ref.color;
			if (!a || esPieza(a)) piezas.push({archivo: ref.archivo, color: c, tr: t});
			else {
				subs.add(ref.archivo);
				recorrer(bib, ref.archivo, t, c, piezas, subs);
			}
		}
}

export type Metricas = {
	valido: boolean;
	errores: number;
	avisos: number;
	piezas: number;
	pasos: number;
	submodelos: number;
	colores: number;
	noBasicas: number;
	piezasPorPaso: {media: number; max: number};
	studs: {ancho: number; fondo: number; alto: number};
	fractal: number;
	cambioSilueta: {media: number; min: number; pasosInvisibles: number};
};

const r2 = (x: number) => Math.round(x * 100) / 100;

export async function metricas(ruta: string): Promise<Metricas> {
	const v = await validarModelo(ruta);
	const bib = nuevaBiblioteca();
	const principal = bib.cargarModelo(ruta, basename(ruta));
	const piezas: PiezaPlana[] = [];
	const subs = new Set<string>();
	recorrer(bib, principal, IDENTIDAD, 16, piezas, subs);

	const caja = cajaVacia();
	for (const p of piezas) {
		try {
			const c = cajaEnMundo(mallaDe(bib, p.archivo), p.tr);
			expandirCaja(caja, c.min);
			expandirCaja(caja, c.max);
		} catch {
			// Pieza sin geometría: el verificador ya la reporta.
		}
	}

	const archivos = [principal, ...subs];
	const porPaso = archivos.flatMap((a) => pasosDe(bib.archivo(a)!).map((p) => p.refs.length));
	const titulos = piezas.map((p) => bib.archivo(p.archivo)?.titulo ?? '');

	// Siluetas de frente: final a 512 px (fractal) y, por archivo, un cuadro por paso a 256 px.
	const dir = join(DIR_CACHE, 'metricas', `${process.pid}-${Date.now()}`);
	mkdirSync(dir, {recursive: true});
	const pedidos: PedidoRender[] = [{modelo: ruta, vistas: ['frente'], lado: 512, modo: 'silueta', salida: join(dir, 'final.png')}];
	const series: {archivo: string; salidas: string[]}[] = [];
	for (const a of archivos) {
		const n = pasosDe(bib.archivo(a)!).length;
		const salidas = Array.from({length: n}, (_, k) => join(dir, `${a}-${k + 1}.png`));
		salidas.forEach((salida, k) => pedidos.push({modelo: ruta, sub: a === principal ? undefined : a, vistas: ['frente'], lado: 256, modo: 'silueta', paso: k + 1, salida}));
		series.push({archivo: a, salidas});
	}
	renderizar(pedidos);

	const cambios = series.flatMap((s) => cambioSilueta(s.salidas.map(leerBinaria)).porPaso);
	return {
		valido: v.ok,
		errores: v.errores.length,
		avisos: v.avisos.length,
		piezas: piezas.length,
		pasos: porPaso.length,
		submodelos: subs.size,
		colores: new Set(piezas.map((p) => p.color)).size,
		noBasicas: r2(titulos.filter((t) => !esBasica(t)).length / Math.max(1, titulos.length)),
		piezasPorPaso: {media: r2(porPaso.reduce((s, x) => s + x, 0) / Math.max(1, porPaso.length)), max: Math.max(0, ...porPaso)},
		studs: {ancho: r2((caja.max[0] - caja.min[0]) / 20), fondo: r2((caja.max[2] - caja.min[2]) / 20), alto: r2((caja.max[1] - caja.min[1]) / 24)},
		fractal: r2(dimensionFractal(leerBinaria(join(dir, 'final.png')))),
		cambioSilueta: {
			media: r2(cambios.reduce((s, x) => s + x, 0) / Math.max(1, cambios.length)),
			min: r2(Math.min(...cambios)),
			pasosInvisibles: cambios.filter((x) => x < 0.01).length,
		},
	};
}
```

- [ ] **Paso 5: correr el test rápido y ver que pasa**

Correr: `cd taller && node --no-warnings --test pruebas/imagen.test.ts`
Esperado: 5 tests en PASS.

- [ ] **Paso 6: agregar `metricas` al CLI y escribir el test lento**

En `taller/src/cli.ts`, agregar `import {metricas} from './metricas.ts';` y el caso antes de `default:`:
```ts
		case 'metricas': {
			if (!resto[0]) salir(2, USO);
			imprimir(await metricas(resolve(resto[0])));
			break;
		}
```

`taller/pruebas/render/metricas.test.ts`:
```ts
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
	// Si la visibilidad por paso no funcionara (todo visible siempre), cada archivo cambiaría solo en su
	// primer paso: habría pasos − archivos pasos invisibles.
	assert.ok(m.cambioSilueta.pasosInvisibles < m.pasos - (m.submodelos + 1), JSON.stringify(m.cambioSilueta));
});
```

> Si esta última aserción falla, lo más probable es que `userData.buildingStep` no esté en los hijos directos de la raíz que arma `LDrawLoader`. Se confirma con `console.log(m.raiz.children.map((c) => c.userData.buildingStep))` en `Vistas.tsx`. Si no está, en `copiaPara` se usa `m.piezas` (que sí trae `paso`) para mapear cada pieza clonada por su posición en el recorrido (`traverse`), que es el mismo orden en el original y en la copia.

- [ ] **Paso 7: correr todo**

Correr: `cd taller && npm test && npm run test:render && npm run tipos`
Esperado: todo en PASS.

Correr también: `cd verificador && npm test`
Esperado: sigue en PASS (no se tocó).

- [ ] **Paso 8: commit**

```bash
git add taller/src/imagen.ts taller/src/metricas.ts taller/src/cli.ts taller/pruebas/imagen.test.ts taller/pruebas/render/metricas.test.ts
git commit -m "taller: métricas (dimensión fractal, cambio de silueta, economía)"
```

---

### Tarea 9: documentación

**Archivos:**
- Crear: `taller/README.md`
- Modificar: `README.md` (tabla "Estructura" y "Pipeline previsto"), `diseno/spec-taller.md` (estado)

- [ ] **Paso 1: escribir `taller/README.md`**

```markdown
# taller

Herramientas para que un agente (o una persona) diseñe modelos LDraw sin escribir coordenadas: buscar piezas, encastrarlas por conector desde un script, construir el `.mpd`, validarlo, verlo desde varias vistas y medirlo. Spec: [`diseno/spec-taller.md`](../diseno/spec-taller.md).

Node ≥ 23.6 ejecuta los `.ts` directamente. Reutiliza `verificador/` (importa sus módulos) y renderiza con `estudio/`.

## Uso

    npm install
    node --no-warnings src/cli.ts piezas buscar slope 45 --max 10
    node --no-warnings src/cli.ts piezas ver 3040
    node --no-warnings src/cli.ts construir diseno.ts --salida modelo.mpd
    node --no-warnings src/cli.ts validar modelo.mpd [--sub copa]
    node --no-warnings src/cli.ts render modelo.mpd --salida renders/ --vistas 34,frente,lado,34atras [--lado 64 --modo silueta] [--paso 3] [--sub copa]
    node --no-warnings src/cli.ts metricas modelo.mpd

La API del script está documentada al principio de `src/dsl.ts`.

## Pruebas

    npm test             # rápidas
    npm run test:render  # renderizan con Remotion (minutos)

## Datos

Los mismos que el verificador, en `../.cache/`: biblioteca LDraw, shadow library y CSV de Rebrickable (`inventory_parts`, `colors`). El índice del catálogo se guarda en `../.cache/taller/catalogo.json` (`piezas reindexar` lo rehace).
```

- [ ] **Paso 2: actualizar `README.md` de la raíz**

En la tabla "Estructura", agregar dos filas después de `investigaciones/`:
```markdown
| [`diseno/`](diseno/) | Cómo se diseñan los modelos: proceso, spec del taller y experimentos |
| [`taller/`](taller/) | Herramientas de diseño: catálogo, encastre por conector, render de vistas, métricas |
```
En "Pipeline previsto", agregar al principio del bloque:
```
diseño (diseno/proceso.md) con el taller → diseno.ts
  └─ taller construir → modelo .mpd
```

- [ ] **Paso 3: marcar el spec como implementado**

En `diseno/spec-taller.md`, cambiar `Estado: **propuesta**, sin implementar.` por `Estado: **implementado** (v1, <fecha>).`

- [ ] **Paso 4: commit**

```bash
git add taller/README.md README.md diseno/spec-taller.md
git commit -m "taller: documentación"
```

---

## Fuera de este plan

- **Corredor del experimento y jueces** (`diseno/experimentos/01-arbol-esfuerzo/`): se lanzan corridas `claude -p` aisladas, se audita el transcript, se anonimiza, se juzga con el VLM en los dos órdenes, se arma una página local para el juez humano y se hace el análisis Bradley–Terry con bootstrap. Plan aparte, escrito cuando el taller exista, porque depende de sus salidas reales.
- **Servidor de render persistente**, métrica de visibilidad por paso y encastre de clips y bisagras: ver "Qué no entra en v1" en el spec.
