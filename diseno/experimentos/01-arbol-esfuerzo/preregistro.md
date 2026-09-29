# Experimento 01: un árbol con cada nivel de esfuerzo

> **Preregistro.** Borrador del 2026-09-29. Se congela (commit con fecha) **antes de la primera corrida**. Lo que cambie después se anota en "Desvíos", con fecha y motivo. Base: [investigaciones/02 §11–12](../../../investigaciones/02-diseno-de-modelos.md#11-nivel-de-esfuerzo-effort-de-opus-55).

## Pregunta

¿Cuánto cambia el diseño de un modelo original según el nivel de esfuerzo de Claude Opus 5.5 (`low`, `medium`, `high`, `xhigh`, `max`), con la misma consigna y las mismas herramientas? ¿Y a qué costo?

## Por qué un árbol

- Hay muchas formas válidas de hacerlo (columnar, cónico, redondo, extendido, llorón, palmera…), así que se ve el despliegue estético.
- Es orgánico: obliga a abstraer y a salir de la grilla, justo donde los métodos por vóxeles fallan.
- Es chico: cabe en 60–250 piezas.
- Hay datos de preferencia humana sobre formas de árbol y siluetas fractales para contrastar ([hechos-arbol.md](hechos-arbol.md)).

## Hipótesis (fijadas antes de correr)

| # | Hipótesis | Qué la respalda |
|---|---|---|
| H1 | La proporción de modelos **válidos** (verificador sin errores) no baja al subir el esfuerzo | Más esfuerzo → más llamadas a herramientas (documentación de *effort*) |
| H2 | La **calidad** según el juicio humano sube de `low` a `high` y **no mejora de forma apreciable** en `xhigh`/`max` | Retornos decrecientes, sobrepensar (Snell; Ghosal; documentación oficial) |
| H3 | El **costo** (USD estimado, tokens de salida) crece con el esfuerzo, más que proporcionalmente de `high` a `max` | Documentación oficial |
| H4 | Con más esfuerzo hay **más llamadas** a `render` y `validar` por corrida | Documentación oficial |

**Exploratorio** (sin hipótesis): la diversidad de formas de árbol elegidas por nivel, la cantidad de piezas y la dimensión fractal de la silueta.

## Diseño

- **Condiciones:** los 5 niveles de esfuerzo.
- **Corridas:** **5 por nivel = 25 corridas** (recomendado). Mínimo aceptable: 3 por nivel = 15. Con n = 5 por nivel solo se detectan efectos grandes; el resultado se presenta como estimación exploratoria de tamaños de efecto, no como ranking definitivo.
- **Corrida de calibración:** una corrida en `max` antes de empezar, para estimar costo y tiempo y detectar fallas del taller. **No entra en el análisis.**
- **Orden:** las 25 corridas se intercalan en orden aleatorio, con semilla fija anotada acá antes de empezar. Así una deriva en el tiempo no coincide con un nivel.
- **Idénticas en todo menos el esfuerzo:**
  - misma [consigna](consigna.md) y mismos [hechos](hechos-arbol.md);
  - misma versión del taller (commit anotado);
  - mismo modelo (`claude-opus-5-5`) y mismo tope de presupuesto y de tiempo.
- **Aislamiento:** cada corrida corre en su propia carpeta, **fuera del repo** (en el temporal del sistema), así no hay CLAUDE.md que descubrir y la memoria de cada carpeta arranca vacía. El comando:

```sh
claude -p --model claude-opus-5-5 --effort <nivel> \
  --setting-sources "" --strict-mcp-config --disable-slash-commands --no-session-persistence \
  --tools Bash,Read,Write,Edit --disallowedTools WebSearch,WebFetch,Agent \
  --permission-mode bypassPermissions --max-budget-usd <tope> \
  --output-format stream-json --verbose < consigna.md > transcript.jsonl
```

  - `--bare` no sirve: exige `ANTHROPIC_API_KEY` y no lee la sesión OAuth de la suscripción.
  - La combinación de arriba se probó el 2026-09-29: el agente ve solo Bash, Read, Write y Edit, y no ve skills, plugins, hooks ni CLAUDE.md.
  - **Sin web, sin subagentes y sin memoria compartida.** Los hechos del árbol van en la consigna.
  - Bash puede leer todo el disco. La consigna prohíbe salir de la carpeta de la corrida y del taller. **Auditoría:** se revisa en cada transcript que no haya lecturas de `referencias/`, de otras corridas ni de modelos de árboles. Si una corrida lo hizo, se marca **contaminada** y se reporta aparte.
- **Topes:** el mismo para todas, generoso para no truncar a `max`. Si una corrida llega al tope, **se analiza igual** con lo que haya entregado y se anota.

## Qué se mide

**Primarias:**
1. **Validez:** `taller validar` sin errores sobre el `modelo.mpd` entregado.
2. **Calidad según el humano:** puntaje Bradley–Terry por nivel en el criterio "calidad general", con empates de Davidson.

**Secundarias:**
- Bradley–Terry del **juez VLM** por criterio: se reconoce, creatividad, técnica, historia, calidad general.
- **Métricas automáticas** de `taller metricas`: piezas, colores, `noBasicas`, piezas por paso, `fractal`, `cambioSilueta`.
- **Costo** (del JSON del CLI): `total_cost_usd`, tokens de salida y de pensamiento, turnos y duración.
- **Uso de herramientas** (del transcript): cantidad de `render`, `validar`, `construir` y `piezas`.
- **Forma de árbol elegida:** la declarada en `ficha.md`, según la clasificación de [hechos-arbol.md](hechos-arbol.md).

## Juicio

**Cegado:**
- Cada modelo recibe un id aleatorio de 4 letras.
- Todos se renderizan igual con el taller: grilla `34,frente,lado,34atras` a 512 px más la silueta de frente a 64 px.
- Los jueces ven solo esas imágenes: ni código, ni ficha, ni nivel.
- La clave id → nivel queda en `.cache/experimentos/01/clave.json` y **no se abre hasta que todos los juicios estén cerrados**.

**Juez VLM:**
- Todos los pares entre modelos: C(25,2) = 300, **en los dos órdenes** (600 llamadas por criterio).
- Una victoria cuenta solo si coinciden los dos órdenes; si no, es empate.
- El juez escribe su justificación antes del veredicto, con una rúbrica fija (en el plan del corredor).
- Se reporta la tasa de consistencia al invertir el orden.
- **Qué modelo:** decisión abierta (ver abajo). Preferible uno de otra familia (autopreferencia).

**Juez humano:**
- 75 pares en una página local.
- 7–8 pares por cada par de niveles, repartidos para que cada modelo aparezca varias veces; lado izquierdo o derecho al azar; se permiten empates.
- Criterio único: "¿cuál es mejor modelo para un video de armado?".
- 10 pares se repiten al final, sin aviso, para medir la consistencia del propio juez.

**Modelos que no se entregan:** si una corrida no produjo `modelo.mpd`, pierde todos sus pares. Un modelo inválido se juzga igual (se ve), y la validez se reporta aparte.

## Análisis (fijado de antemano)

1. **Por nivel:** media ± IC 95 % por bootstrap (remuestreando corridas, 10.000 réplicas) de cada métrica automática, costo y uso de herramientas; proporción de válidos con IC de Wilson.
2. **Bradley–Terry** por nivel (modelos agrupados por nivel, empates de Davidson), con IC por bootstrap sobre comparaciones, más P(nivel A > nivel B) para cada par de niveles contiguos.
   - Se estima con un **prior normal débil** sobre las fuerzas (θ ~ N(0, 3²)).
   - Sin el prior, la separación completa (un nivel que gana o pierde todo, por ejemplo por modelos no entregados) hace divergir el ajuste, y entonces los IC dependerían de cuántas iteraciones se corren y no de los datos.
3. **Acuerdo juez VLM–humano** en los pares compartidos: porcentaje, κ de Cohen y τ de Kendall entre los dos rankings de niveles (con 5 niveles, τ es grueso; se reporta igual).
4. **Gráfico de calidad (BT humano) vs. costo medio** por nivel.
5. **Criterios de decisión** para elegir el nivel por defecto del proceso:
   - el nivel más barato cuyo IC de BT humano se superpone con el del mejor nivel;
   - y con validez ≥ 80 %.
6. No se repiten corridas malas. **Una corrida se anula solo** si el transcript muestra una falla del taller o de la infraestructura, no del agente. Se reemplaza por otra del mismo nivel y se anota en "Desvíos".

## Decisiones (tomadas por el equipo el 2026-09-29)

1. **Cantidad de corridas: 25** (5 por nivel).
2. **Presupuesto:** los tokens no son una restricción. Queda ~80 % del límite semanal del plan Max, que vence el 2026-09-30, más USD 250 de crédito de cómputo.
   - **La restricción real es el tiempo:** las 25 corridas tienen que terminar antes de que venza el plan.
   - El tope por corrida (`--max-budget-usd`) es igual para todas y generoso: 3× lo que gaste la corrida de calibración. Sirve solo para cortar corridas desbocadas.
   - **Concurrencia:** 2–3 corridas a la vez. La laptop tiene 7,8 GB y cada render levanta un Chromium. El orden aleatorio se respeta al elegir qué corrida arranca cuando se libera un lugar.
3. **Juez VLM: el Fable más potente (`claude-fable-5-1`), solo si es mejor que Opus 5.5 para esta tarea.** Se decide con una **prueba de selección del juez**, antes de juzgar y sin ver ningún árbol:
   - Pares con respuesta conocida, armados con los sets oficiales del OMR (uso interno): el modelo original contra una versión degradada del mismo modelo.
   - Tres degradaciones:
     - se quita el 30 % de las piezas al azar;
     - se cambia el color del 50 % de las piezas al azar;
     - "tosca": cada pieza se reemplaza por un ladrillo 1×1 del mismo color en la misma posición.
   - 30 pares (10 modelos × 3 degradaciones), en los dos órdenes, con la misma rúbrica, las mismas imágenes y el mismo esfuerzo del juez (`high`) que en el experimento.
   - Gana el modelo con más aciertos. Si empatan (diferencia < 5 puntos porcentuales), gana el más consistente al invertir el orden. Si también empatan, queda Opus 5.5.
   - El juez tiene que ser un modelo distinto de los diseñadores. Tanto Fable como Opus son de Anthropic, así que el riesgo de autopreferencia no desaparece. Por eso se calibra igual contra el juez humano (acuerdo y κ).

## Congelamiento

- **Fecha:** 2026-09-30, 03:10 (antes de la corrida de calibración y de cualquier corrida del plan).
- **Semilla:** `20260929`. Anonimización: `20260929 + 1`.
- **Taller y corredor:** commit `fbc7c4f` del git sombra (ver Desvíos 1). La huella SHA-256 de este archivo queda anotada en el commit que lo congela.
- **Concurrencia prevista:** 2–3 corridas a la vez, según la memoria libre.

## Desvíos

1. **2026-09-30. El congelamiento no se hizo con un commit en el repo real.** El repo no tenía ningún commit, y otra sesión esperaba el OK de la usuaria para hacer el primero. Se usó un git sombra (otro GIT_DIR con el repo como árbol de trabajo) y se anotó la huella SHA-256 del preregistro. Cuando haya un primer commit real, este archivo tiene que entrar sin cambios respecto de esa huella, salvo esta sección de desvíos.
2. **2026-09-30. Se agregó un servidor de render persistente** (`estudio/scripts/servidor-render.mjs`): un render pasó de 34 s a 3–9 s, y la memoria no alcanzaba para varias corridas en paralelo. No cambia qué ve el agente, solo cuánto tarda.
3. **2026-09-30. Auditoría en dos niveles.**
   - `contaminada` solo marca pistas prohibidas: referencias, OMR, sets de prueba, modelos LDraw de ejemplo, otras corridas, `diseno/`, `investigaciones/` y árboles ajenos.
   - Las demás rutas fuera de lugar van a revisión manual (`rutasFuera`).
   - Se decidió antes de correr, para evitar falsos positivos.
   - También cuenta como contaminación leer el **contenido** de `taller/src/experimento/` o `taller/pruebas/experimento/`, donde están la rúbrica del juez y el análisis. Listar la carpeta no cuenta. Se agregó después de ver, en la corrida de calibración, que el agente explora el código del taller.
4. **2026-09-30. Tope y arranque.**
   - El lote principal usa un tope fijo de USD 50 por corrida, en vez de 3× el costo de la calibración. Los tokens no son una restricción y el tiempo sí.
   - El lote arranca cuando la calibración ya mostró que el agente usa el taller sin errores, sin esperar a que termine.
   - El código del taller que usan los diseñadores queda congelado desde el arranque del lote: commit `e15aeed` del git sombra (03:28). Incluye el arreglo de los anti-studs de sección cuadrada (piezas 1×N), un bug que encontró la corrida de calibración.
