# Corredor y jueces del experimento 01: plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDO: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para ejecutar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`) para seguir el avance.

**Objetivo:** correr las 25 corridas del [experimento 01](experimentos/01-arbol-esfuerzo/preregistro.md), auditarlas, elegir el juez, juzgar a ciegas (VLM y humano) y analizar.

**Arquitectura:**
- Scripts en `taller/src/experimento/`, que usan el taller (render, validar, métricas) y lanzan `claude -p` como proceso hijo.
- Todo lo que generan va a `.cache/experimentos/01/` (fuera de git).
- Las corridas se ejecutan en una carpeta del temporal del sistema, fuera del repo.

**Tecnologías:** las del [plan del taller](plan-taller.md) más el CLI `claude` (v2.1.284+).

**Spec:** el [preregistro](experimentos/01-arbol-esfuerzo/preregistro.md). Este plan lo implementa sin cambiarlo; si algo no se puede, se anota en "Desvíos".

## Restricciones globales

- **Requiere el taller terminado** (todas las tareas de [plan-taller.md](plan-taller.md)).
- **Comando exacto de cada corrida** (probado el 2026-09-29; `--bare` no sirve porque exige API key):
  - args: `-p --model claude-opus-5-5 --effort <nivel> --setting-sources "" --strict-mcp-config --disable-slash-commands --no-session-persistence --tools Bash,Read,Write,Edit --disallowedTools WebSearch,WebFetch,Agent --permission-mode bypassPermissions --max-budget-usd <tope> --output-format stream-json --verbose`
  - la consigna entra por **stdin**.
- **Comando del juez:** `-p --model <juez> --effort high --setting-sources "" --strict-mcp-config --disable-slash-commands --no-session-persistence --tools Read --permission-mode bypassPermissions --output-format json`. El prompt entra por stdin y el veredicto se lee de `result`.
- **Contabilidad:** el mensaje final de stream-json (`type: "result"`) trae `total_cost_usd`, `num_turns`, `duration_ms` y `modelUsage[modelo].{outputTokens, thinkingTokens}`. Los `thinkingTokens` ya están incluidos en `outputTokens`.
- **Semilla:** `20260929`. PRNG: mulberry32.
- **Concurrencia:** 3 corridas de diseño y 6 llamadas al juez. La laptop tiene 7,8 GB.
- **Todo se puede reanudar:** si existe el resultado de una unidad, se salta.
- **Procesos hijos:** con `spawn(process.execPath | 'claude', args)`, sin shell. En Windows el ejecutable es `claude.cmd`: se resuelve una vez con `where claude` y se lanza con `shell: false`. Si no arranca, usar el `.exe` o el `cli.js` que ese `.cmd` invoca.

## Estructura de archivos

```
taller/src/experimento/
  azar.ts            mulberry32, permutación, ids anónimos
  plan.ts            plan de corridas (nivel por corrida, orden) → plan.json
  correr.ts          lanza corridas con concurrencia y tope de tiempo; reanudable
  transcript.ts      lee stream-json: costo, tokens, turnos, usos de herramientas, lecturas fuera de lugar
  auditar.ts         por corrida: entrega, validez, piezas prohibidas, contaminación → auditoria.json
  degradar.ts        versiones degradadas de un .mpd (quitar, recolorear, tosca)
  imagenes.ts        imágenes estándar de un modelo (grilla de 4 vistas a 512 + silueta a 64)
  juez.ts            prompt, llamada, parseo del veredicto; pares en los dos órdenes
  seleccion-juez.ts  prueba de selección (Fable vs Opus) sobre sets degradados
  juicio.ts          anonimiza, juzga todos los pares con el juez elegido
  pagina-humano.ts   HTML local con los pares para el juez humano (exporta JSON)
  bt.ts              Bradley–Terry con empates de Davidson + bootstrap
  analizar.ts        tablas y gráfico → resultados.md
taller/pruebas/experimento/*.test.ts
```

---

### Tarea 1: azar, plan y transcript

**Archivos:** crear `azar.ts`, `plan.ts` y `transcript.ts`; test en `taller/pruebas/experimento/base.test.ts`.

**Interfaces:**
- `mulberry32(semilla: number): () => number`
- `mezclar<T>(xs: T[], azar: () => number): T[]` (Fisher–Yates, no modifica la entrada)
- `idsAnonimos(n: number, azar): string[]` (4 letras mayúsculas, sin repetir)
- `type Corrida = {id: string /* "r01".."r25" */; nivel: 'low' | 'medium' | 'high' | 'xhigh' | 'max'; orden: number}`
- `planCorridas(semilla = 20260929, porNivel = 5): Corrida[]`: 5 de cada nivel, orden = posición en una permutación aleatoria
- `type Resumen = {costoUsd: number; turnos: number; duracionMs: number; tokensSalida: number; tokensPensamiento: number; herramientas: Record<string, number>; comandosTaller: Record<string, number>; rutasLeidas: string[]; final: string}`
- `resumirTranscript(jsonl: string): Resumen`

`comandosTaller` cuenta los subcomandos (`piezas`, `construir`, `validar`, `render`, `metricas`) en los `command` de las llamadas a Bash que contienen `taller/src/cli.ts`. `rutasLeidas` junta los `file_path` de Read, Write y Edit y las rutas absolutas que aparezcan en los comandos de Bash.

- [ ] **Paso 1: tests que fallan**

```ts
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {idsAnonimos, mezclar, mulberry32} from '../../src/experimento/azar.ts';
import {planCorridas} from '../../src/experimento/plan.ts';
import {resumirTranscript} from '../../src/experimento/transcript.ts';

test('mulberry32 es determinista', () => {
	const a = mulberry32(1);
	const b = mulberry32(1);
	assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('plan: 25 corridas, 5 por nivel, orden permutado y estable', () => {
	const p = planCorridas();
	assert.equal(p.length, 25);
	for (const n of ['low', 'medium', 'high', 'xhigh', 'max']) assert.equal(p.filter((c) => c.nivel === n).length, 5);
	assert.deepEqual([...p.map((c) => c.orden)].sort((x, y) => x - y), Array.from({length: 25}, (_, i) => i));
	assert.deepEqual(planCorridas(), p);
	assert.notDeepEqual(p.map((c) => c.nivel).slice(0, 5), ['low', 'low', 'low', 'low', 'low']);
});

test('ids anónimos únicos de 4 letras', () => {
	const ids = idsAnonimos(25, mulberry32(7));
	assert.equal(new Set(ids).size, 25);
	assert.ok(ids.every((x) => /^[A-Z]{4}$/.test(x)));
	assert.deepEqual(mezclar([1, 2, 3], mulberry32(1)).sort(), [1, 2, 3]);
});

test('resumirTranscript cuenta herramientas, comandos del taller y costo', () => {
	const lineas = [
		{type: 'assistant', message: {content: [{type: 'tool_use', name: 'Bash', input: {command: 'node --no-warnings C:/x/taller/src/cli.ts render modelo.mpd --salida r/'}}]}},
		{type: 'assistant', message: {content: [{type: 'tool_use', name: 'Bash', input: {command: 'node --no-warnings C:/x/taller/src/cli.ts validar modelo.mpd'}}]}},
		{type: 'assistant', message: {content: [{type: 'tool_use', name: 'Read', input: {file_path: 'C:/otra/cosa.ldr'}}]}},
		{type: 'result', total_cost_usd: 1.5, num_turns: 3, duration_ms: 1000, result: 'ENTREGADO', modelUsage: {'claude-opus-5-5': {outputTokens: 900, thinkingTokens: 400}}},
	];
	const r = resumirTranscript(lineas.map((l) => JSON.stringify(l)).join('\n'));
	assert.deepEqual(r.comandosTaller, {render: 1, validar: 1});
	assert.equal(r.herramientas.Bash, 2);
	assert.ok(r.rutasLeidas.includes('C:/otra/cosa.ldr'));
	assert.equal(r.costoUsd, 1.5);
	assert.equal(r.tokensPensamiento, 400);
	assert.equal(r.final, 'ENTREGADO');
});
```

- [ ] **Paso 2: implementar** (mulberry32 estándar; Fisher–Yates; `transcript.ts` recorre las líneas JSON, ignora las que no parsean y toma el último `type: "result"`).
- [ ] **Paso 3: `node --no-warnings --test "pruebas/experimento/*.test.ts"` en PASS; commit.**

---

### Tarea 2: correr

**Archivos:** crear `correr.ts`; test en `pruebas/experimento/correr.test.ts`.

**Interfaces:**
- `prepararCarpeta(c: Corrida, base: string): string`:
  - crea `<base>/<id>/`;
  - escribe `consigna.md` con `{{DIR}}`, `{{TALLER}}` y `{{DSL_URL}}` reemplazados (`pathToFileURL(taller/src/dsl.ts).href`);
  - copia `hechos-arbol.md`;
  - devuelve la ruta.
- `argsCorrida(nivel: string, tope: number): string[]`: exactamente los de "Restricciones globales".
- `correrTodas(op: {concurrencia: number; tope: number; limiteMin: number; soloIds?: string[]}): Promise<void>`:
  - carpetas de trabajo: `join(os.tmpdir(), 'lego-lab-exp01')`;
  - toma las corridas en orden `orden` y lanza hasta `concurrencia` a la vez;
  - por corrida: `transcript.jsonl` (stdout), `stderr.txt` y `resultado.json = {id, nivel, inicio, fin, codigo, cortadaPorTiempo, resumen: Resumen}`;
  - al terminar, copia `diseno.ts`, `modelo.mpd`, `modelo.mapa.json`, `ficha.md` y `renders/` a `.cache/experimentos/01/corridas/<id>/`;
  - si ya existe `resultado.json`, la salta;
  - si pasa `limiteMin`, mata el proceso y marca `cortadaPorTiempo`.
- CLI: `node --no-warnings src/experimento/correr.ts [--concurrencia 3] [--tope <usd>] [--limite-min 180] [--solo r07,calibracion]`.
  - La **calibración** es una corrida `calibracion` en `max` que no está en el plan; `--solo calibracion` la lanza.

- [ ] **Paso 1: test que falla**: `prepararCarpeta` deja una consigna sin `{{`, la línea de import con `file:///` y `hechos-arbol.md` copiado. `argsCorrida('max', 30)` contiene `--effort`, `max`, `--max-budget-usd`, `30` y **no** contiene `--bare`.
- [ ] **Paso 2: implementar.** Probar a mano con una corrida falsa: `--solo` sobre un id de prueba y una consigna de una línea ("respondé ENTREGADO") con `low`. Se verifica que genere `resultado.json` con costo > 0.
- [ ] **Paso 3: tests en PASS; commit.**

---

### Tarea 3: auditar

**Archivos:** crear `auditar.ts`; test en `pruebas/experimento/auditar.test.ts`.

**Interfaces:**
- `PROHIBIDAS: RegExp = /^Plant Tree/i` (sobre el título LDraw) y `IDS_PROHIBIDOS = ['2435', '3470', '3471', '3778', '52211', '2518c01']`
- `type Auditoria = {id; nivel; entrego: boolean; valido: boolean | null; errores: number; prohibidas: string[]; contaminada: boolean; motivosContaminacion: string[]; metricas: Metricas | null; resumen: Resumen}`
- `auditar(id: string): Promise<Auditoria>`
  - `entrego` = existe `modelo.mpd` en la carpeta de la corrida.
  - `valido` y `metricas` salen de `validarModelo` y `metricas` del taller.
  - **Contaminación:** cualquier ruta en `resumen.rutasLeidas` que no esté bajo la carpeta de la corrida ni bajo `taller/`. También cuenta si menciona `referencias/`, `.cache/experimentos`, `omr`, otra corrida (`/r\d\d/`) o `sets-test`. `node_modules` del taller no cuenta.
- CLI: `auditar.ts [--todas]` escribe `.cache/experimentos/01/auditoria.json`.

- [ ] **Paso 1: tests que fallan.** Con un `Resumen` sintético: una lectura de `C:/…/lego-lab/referencias/sets-test/x.mpd` marca contaminada; una lectura de la carpeta de la corrida no. Un `.mpd` con `3471.dat` da `prohibidas: ['3471']`.
- [ ] **Paso 2: implementar. Paso 3: PASS; commit.**

---

### Tarea 4: degradar e imágenes estándar

**Archivos:** crear `degradar.ts` e `imagenes.ts`; test en `pruebas/experimento/degradar.test.ts`.

**Interfaces:**
- `degradar(mpd: string, tipo: 'quitar' | 'recolorear' | 'tosca', azar): string`. Opera sobre las líneas tipo 1 de piezas (no las de submodelos):
  - `quitar`: borra el 30 %;
  - `recolorear`: al 50 % le asigna un color al azar de `[1, 2, 4, 14, 15, 0, 71, 70]`, distinto del original;
  - `tosca`: reemplaza el archivo por `3005.dat` conservando la matriz y el color.
- `imagenesEstandar(modelo: string, salidaDir: string, nombre: string): {grilla: string; silueta: string}`: grilla `34,frente,lado,34atras` a 512 px por vista (1024×1024) y silueta `frente` a 64 px. Un solo `renderizar` con los dos pedidos.

- [ ] **Paso 1: tests que fallan.**
  - `quitar` deja el 70 % ± 1 de las líneas de pieza y no toca las de submodelo ni los `0 FILE`.
  - `recolorear` cambia exactamente `round(0.5·n)` colores.
  - `tosca` deja todas las líneas en `3005.dat` con la misma matriz.
  - El mismo azar da el mismo resultado.
- [ ] **Paso 2: implementar. Paso 3: PASS; commit.**

---

### Tarea 5: juez y prueba de selección

**Archivos:** crear `juez.ts` y `seleccion-juez.ts`; test en `pruebas/experimento/juez.test.ts`.

**Prompt del juez** (fijo; se guarda en `juez.ts` como constante `PROMPT_JUEZ`):

```
Sos juez de modelos originales hechos con ladrillos LEGO para videos cortos de armado (formato vertical, se ven en el celular).
Vas a comparar dos modelos, A y B. De cada uno hay dos imágenes: una grilla con 4 vistas (3/4, frente, lado, 3/4 desde atrás) y su silueta de frente a 64 px, que es como se vería de lejos en un teléfono.
Abrí las cuatro imágenes con Read:
- A grilla: {{A_GRILLA}}
- A silueta: {{A_SILUETA}}
- B grilla: {{B_GRILLA}}
- B silueta: {{B_SILUETA}}
{{TEMA}}
Criterios, cada uno por separado:
1. reconoce: ¿se reconoce al instante qué es, también en la silueta de 64 px?
2. creatividad: ¿tiene una idea, una técnica no obvia o un uso ingenioso de una pieza?
3. tecnica: proporción, paleta de colores, terminación de todos los lados.
4. historia: ¿evoca o cuenta algo?
5. general: ¿cuál es mejor modelo para un video de armado? Un modelo técnicamente prolijo pero aburrido no es mejor.
Primero escribí tu razonamiento, breve y concreto, mirando las imágenes. Después, en la ÚLTIMA línea y sin nada más, un JSON así:
{"reconoce":"A|B|empate","creatividad":"A|B|empate","tecnica":"A|B|empate","historia":"A|B|empate","general":"A|B|empate"}
```

`{{TEMA}}` es `"Los dos modelos representan un árbol."` en el experimento, y `"Los dos modelos representan lo mismo."` en la prueba de selección.

**Interfaces:**
- `type Veredicto = Record<'reconoce' | 'creatividad' | 'tecnica' | 'historia' | 'general', 'A' | 'B' | 'empate'>`
- `parsearVeredicto(texto: string): Veredicto | null`: última línea que parsea como JSON con las 5 claves y valores válidos
- `juzgarPar(juez: string, a: Imagenes, b: Imagenes, tema: string, dirTrabajo: string): Promise<{veredicto: Veredicto | null; costoUsd: number; crudo: string}>`: un reintento si el veredicto es `null`
- `combinarOrdenes(ab: Veredicto, ba: Veredicto): Veredicto`: `ba` se da vuelta (A↔B). Si coinciden, ese valor; si no, `empate`.
- `seleccionJuez(): Promise<{porJuez: Record<string, {aciertos: number; total: number; consistencia: number; costoUsd: number}>; elegido: string}>`
  - Usa los 10 modelos de `referencias/sets-test/modelos/` × 3 degradaciones = 30 pares, cada uno juzgado en los dos órdenes por `claude-fable-5-1` y `claude-opus-5-5`.
  - Acierto: el veredicto combinado en `general` elige el original.
  - Regla del preregistro: más aciertos; si la diferencia es menor a 5 pp, el más consistente; si siguen empatados, Opus.
  - Escribe `.cache/experimentos/01/seleccion-juez.json`.

- [ ] **Paso 1: tests que fallan.**
  - `parsearVeredicto` con texto + JSON final da el objeto; con JSON inválido o una clave faltante da `null`.
  - `combinarOrdenes({general: 'A', …}, {general: 'B', …})` da `general: 'A'` (coinciden después de dar vuelta).
  - `({general: 'A'}, {general: 'A'})` da `empate`.
- [ ] **Paso 2: implementar.** Concurrencia 6 con un pool simple. Cada llamada corre en su propia carpeta temporal, y las imágenes se pasan por ruta absoluta.
- [ ] **Paso 3: PASS; commit.**

---

### Tarea 6: juicio a ciegas y página humana

**Archivos:** crear `juicio.ts` y `pagina-humano.ts`; test en `pruebas/experimento/juicio.test.ts`.

**Interfaces:**
- `anonimizar(): Promise<Record<string, string>>`
  - Asigna ids anónimos con semilla `20260929 + 1` a las corridas con `entrego` y genera las imágenes estándar en `.cache/experimentos/01/ciego/<ANON>/`.
  - Escribe la clave en `.cache/experimentos/01/clave.json`. Esa clave no la lee ningún otro script salvo `analizar.ts`.
- `juzgarTodo(juez: string): Promise<void>`
  - Todos los pares no ordenados de modelos anónimos, en los dos órdenes.
  - Salida: `juicios-vlm.jsonl` con `{a, b, ab: Veredicto | null, ba: Veredicto | null, combinado: Veredicto}`.
  - Reanudable por par.
  - Las corridas sin entrega no entran acá: `analizar` les asigna derrotas.
- `generarPaginaHumano(): string`
  - Genera `.cache/experimentos/01/humano.html`, autocontenido, con las imágenes en base64.
  - **75 pares:** se eligen con semilla, parejos entre pares de modelos. El HTML no conoce los niveles, así que la selección usa la clave solo para balancear por par de niveles y el HTML guarda únicamente ids anónimos.
  - Más **10 repetidos**: aparecen al final, mezclados y con los lados invertidos.
  - Lado izquierdo/derecho al azar; botones "Izquierda", "Empate" y "Derecha"; progreso.
  - Guarda el avance en `localStorage` (con try/catch).
  - Botón "Descargar respuestas" → `respuestas-humano.json` `[{a, b, izq, der, eleccion: 'A'|'B'|'empate', repetido: boolean}]`.
  - Una sola pregunta: "¿Cuál es mejor modelo para un video de armado?".

- [ ] **Paso 1: tests que fallan.**
  - Con 25 modelos, la selección da 75 pares, cubre los 10 pares de niveles con 7–8 cada uno y ningún modelo aparece menos de 3 veces.
  - El HTML no contiene las palabras `low`, `medium`, `high`, `xhigh` ni `max` fuera de atributos de estilo. Chequearlo con una regex sobre el texto visible y los datos embebidos.
- [ ] **Paso 2: implementar. Paso 3: PASS; commit.**

---

### Tarea 7: Bradley–Terry y análisis

**Archivos:** crear `bt.ts` y `analizar.ts`; test en `pruebas/experimento/bt.test.ts`.

**Modelo (Davidson 1970):** con fuerzas πᵢ = e^{θᵢ} y parámetro de empate ν = e^{λ},
- P(i gana a j) = πᵢ / D
- P(empate) = ν·√(πᵢπⱼ) / D
- D = πᵢ + πⱼ + ν·√(πᵢπⱼ)

Se maximiza la log-verosimilitud por ascenso de gradiente sobre (θ, λ) con θ centrado (Σθ = 0).

```ts
export type Comparacion = {i: number; j: number; resultado: 'i' | 'j' | 'empate'};

export function ajustarBT(n: number, comps: Comparacion[], iter = 4000, paso = 0.05): {theta: number[]; nu: number} {
	const theta = new Array(n).fill(0);
	let lambda = Math.log(0.5);
	for (let k = 0; k < iter; k++) {
		const g = new Array(n).fill(0);
		let gl = 0;
		const nu = Math.exp(lambda);
		for (const c of comps) {
			const pi = Math.exp(theta[c.i]);
			const pj = Math.exp(theta[c.j]);
			const t = nu * Math.sqrt(pi * pj);
			const d = pi + pj + t;
			// Derivadas de log D respecto de θi, θj, λ.
			const dI = (pi + t / 2) / d;
			const dJ = (pj + t / 2) / d;
			const dL = t / d;
			if (c.resultado === 'i') (g[c.i] += 1 - dI), (g[c.j] -= dJ), (gl -= dL);
			else if (c.resultado === 'j') (g[c.j] += 1 - dJ), (g[c.i] -= dI), (gl -= dL);
			else (g[c.i] += 0.5 - dI), (g[c.j] += 0.5 - dJ), (gl += 1 - dL);
		}
		const m = comps.length || 1;
		for (let a = 0; a < n; a++) theta[a] += (paso * g[a]) / m * n;
		lambda += (paso * gl) / m;
		const media = theta.reduce((s, x) => s + x, 0) / n;
		for (let a = 0; a < n; a++) theta[a] -= media;
	}
	return {theta, nu: Math.exp(lambda)};
}
```

**Interfaces:**
- `ajustarBT` (arriba)
- `bootstrapBT(n, comps, reps = 2000, azar): {theta: number[]; ic: [number, number][]; pSuperior: number[][]}`: remuestrea comparaciones con reposición; `pSuperior[a][b]` es la proporción de réplicas con θa > θb
- `bootstrapMedia(xs: number[], reps = 10000, azar): {media; ic: [number, number]}`
- `wilson(k, n): [number, number]`
- `kappa(a: string[], b: string[]): number` (Cohen)
- `kendallTau(x: number[], y: number[]): number`
- `analizar(): Promise<string>` escribe `.cache/experimentos/01/resultados.md` y `diseno/experimentos/01-arbol-esfuerzo/resultados.md` con:
  1. Tabla por nivel: válidos (IC de Wilson); media ± IC de cada métrica, del costo, de los tokens de pensamiento, de la duración y de los usos de `render` y `validar`; formas de copa declaradas.
  2. BT del juez humano (criterio único) y BT del juez VLM por criterio, con IC y P(nivel contiguo superior).
  3. Acuerdo VLM–humano en los pares compartidos: porcentaje, κ y τ entre rankings de niveles.
  4. Gráfico de calidad vs. costo (SVG inline): x = costo medio, y = θ humano.
  5. Aplicación de la regla de decisión del preregistro.
  6. Corridas contaminadas y cortadas, y cómo se trataron.
  - Las corridas sin entrega pierden contra todas.
  - Los pares de modelos del mismo nivel se descartan para el BT por nivel.

- [ ] **Paso 1: tests que fallan.**
  - `ajustarBT` recupera el orden de θ = [−1, 0, 1] con 3.000 comparaciones simuladas (con semilla y ν = 0,3), con error < 0,15 en cada θ.
  - `wilson(5, 5)[0] > 0.5`.
  - `kappa` de listas idénticas = 1.
  - `kendallTau([1,2,3],[3,2,1]) = −1`.
- [ ] **Paso 2: implementar. Paso 3: PASS; commit.**

---

## Orden de ejecución la noche del experimento

1. Correr los tests del taller y del corredor.
2. **Congelar el preregistro:** commit con fecha, más la semilla y el commit del taller anotados en el preregistro.
3. `correr.ts --solo calibracion` (en `max`). Revisar a mano que el agente haya usado el taller y entregado. Fijar el tope = 3× su costo, anotarlo en el preregistro y commitear.
4. `correr.ts --concurrencia 3 --tope <t> --limite-min 180`.
5. **En paralelo**, mientras corren los diseños: `seleccion-juez.ts` (no mira árboles).
6. `auditar.ts --todas` → `anonimizar` → `juzgarTodo(<elegido>)` → `generarPaginaHumano`.
7. El juez humano completa la página y guarda `respuestas-humano.json` en `.cache/experimentos/01/`.
8. `analizar.ts`.
