# Proceso de diseño de un modelo original

> Versión 0.1 (2026-09-29), todavía sin probar. Sale de [investigaciones/02](../investigaciones/02-diseno-de-modelos.md). Es la misma idea que el `proceso.md` de content-generator: cada paso termina en un archivo, y lo barato (texto) se corrige antes que lo caro (piezas y renders). Se ajusta después del [piloto del árbol](experimentos/01-arbol-esfuerzo/).

## Principio rector

**Claude diseña; las herramientas resuelven la geometría.**
- Los LLM son malos escribiendo coordenadas y rotaciones: 2,4 % de estructuras válidas en BrickGPT y ~50 % en preguntas espaciales de LEGO-Puzzles ([02 §2](../investigaciones/02-diseno-de-modelos.md#2-qué-hace-bien-y-qué-hace-mal-un-llm-diseñando-en-3d)).
- Por eso el modelo se escribe como un **script que encastra piezas por conector** ("sobre el stud (2,1) de la base") y el [taller](spec-taller.md) calcula las matrices.
- La validez la garantiza el verificador **después de cada sub-armado**, no el criterio de Claude.

## Pasos

Cada modelo vive en `modelos/<slug>/`. Esa carpeta no existe todavía: se crea con el primer modelo.

| # | Paso | Entregable | Hecho cuando | Base |
|---|---|---|---|---|
| 1 | **Ficha** | `ficha.md` | Tema, **escala** (micro, viñeta, minifig, exhibición), presupuesto de piezas y **2–3 rasgos icónicos**: los que, si faltan, el objeto deja de reconocerse | Alphin; Biederman ([02 §4.1, §6](../investigaciones/02-diseno-de-modelos.md#41-principios-de-diseño)) |
| 2 | **Hechos del objeto real** | `hechos.md` | Forma, proporciones, colores, texturas y variantes del objeto **real**, con fuente. **No se miran MOCs ni sets del mismo tema** | Fijación: Jansson y Smith; Sio et al. ([02 §9](../investigaciones/02-diseno-de-modelos.md#9-proceso-de-diseño-fijación-y-prototipos-en-paralelo)) |
| 3 | **Conceptos en paralelo** | `conceptos.md` | 3–5 conceptos, cada uno en un **contexto separado** (subagentes). Cada uno trae una idea en una frase, la silueta, la paleta, el árbol de sub-armados y dónde está la "revelación" | Dow et al.: en paralelo > en serie |
| 4 | **Modelo boceto** | `boceto/<concepto>.ts` → `.mpd` | Cada concepto en volúmenes simples (ladrillos y placas), validado, con render de 4 vistas y de 64 px | Psiaki: "casi todo empieza con ladrillos" |
| 5 | **Convergencia** | `conceptos.md` → Elección | Un **juez separado** compara los bocetos de a pares (§Calidad, capa 3) y elige 1–2 | GPTEval3D; MLLM-as-a-Judge |
| 6 | **Pasada de elementos** | `modelo.ts` → `modelo.mpd` | Sub-armado por sub-armado: pendientes, tiles, SNOT y al menos un NPU. **Se valida al cerrar cada sub-armado**; si falla, se vuelve al último sub-armado válido y se rehace | BrickGPT (vuelta atrás); salir del "look vóxel" |
| 7 | **Refinamiento** | Renders + notas en `ficha.md` | Ronda: render de varias vistas → críticas anotadas → 2–3 ediciones candidatas → el juez elige → se sigue. Se termina cuando la mejor candidata ya no le gana a la actual o se acaba el presupuesto | BlenderAlchemy; LL3M |
| 8 | **Diseño del armado** | Orden de `STEP` en `modelo.ts` | Se cumplen las reglas de armado (abajo) | Agrawala 2003; Berard |
| 9 | **QA** | `ficha.md` → QA | Pasa las tres capas de calidad | — |

## Reglas del armado (para el video)

En un video, el espectador ve el armado, no la caja. Los diseñadores de LEGO lo dicen explícitamente: diseñan "la experiencia de armado y el producto final" ([02 §4.2](../investigaciones/02-diseno-de-modelos.md#42-la-experiencia-de-armado)).

1. **Sub-armados = partes funcionales** (tronco, copa, base). Lo que pertenece a un mismo grupo va junto o seguido (Agrawala).
2. **Una pieza significativa por paso**, más piezas chicas. Una operación repetida se muestra entera unas dos veces y después se agrupa (Agrawala).
3. **Visibilidad:** cada pieza nueva se ve desde la cámara del paso y no tapa las que vienen (Agrawala, "quizás el principio más fuerte").
4. **Ritmo:** a un tramo difícil le sigue uno tranquilo (Berard). Al menos un momento de "esto es interesante": una técnica no obvia.
5. **La revelación al final** (I): el rasgo más llamativo se arma tarde, como plano de remate.
6. **Cada paso cambia la silueta de forma visible** (I). Es un indicador de dinamismo y se mide (métrica `cambioSilueta`).

## Calidad: tres capas

**Capa 1: puerta física.** O pasa o no pasa.
- El verificador sin errores.
- Todas las combinaciones pieza + color existen en algún set (Rebrickable).

**Capa 2: métricas automáticas.** Las calcula `taller metricas`. Informan; no deciden solas.
- **Economía:** piezas, colores, proporción de piezas no básicas y piezas por paso.
- **Forma:** alto y ancho en studs, y dimensión fractal de la silueta (en árboles y otras formas naturales se prefiere D ≈ 1,3–1,5; Spehar et al. 2003).
- **Armado:** cambio de silueta por paso y piezas por paso (máximo y media).

**Capa 3: juicio.** Comparaciones de a pares, nunca notas del 1 al 10.
- Lo que ve el juez: grillas de 4 vistas más la silueta a 64 px.
- Cómo compara: un criterio por vez, en **los dos órdenes** (una victoria cuenta solo si coinciden), escribiendo la justificación antes del veredicto.
- Criterios (LEGO Masters + reconocimiento):
  1. **Se reconoce** a 64 px y en 3/4.
  2. **Creatividad:** ¿tiene una idea, una técnica no obvia o un NPU?
  3. **Técnica:** proporción, paleta y terminación de todos lados.
  4. **Historia:** ¿cuenta algo o evoca algo?
- **Técnicamente impecable pero aburrido pierde** (Berard y Corbett).
- **El juez nunca es el agente que diseñó.** Si se puede, es de otra familia de modelos (autopreferencia, Panickssery et al. 2024). Si no, se calibra contra un humano (§Calibración).

**Calibración.** Cada tanto, el equipo juzga 20–50 pares y se mide el acuerdo con el juez (porcentaje, κ). Si el acuerdo baja del 70 %, se revisa el prompt del juez antes de seguir usándolo.

## Referencias: qué se mira y cuándo

| Qué | Cuándo | Por qué |
|---|---|---|
| Fotos y datos del objeto real | Paso 2 | Hechos antes que ideas |
| Técnicas genéricas (SNOT, bisagras, ángulos), sin importar el tema | Paso 6, desde la biblioteca de técnicas del taller | Técnica sin fijación temática |
| MOCs o sets del **mismo tema** | **Nunca** antes del paso 5. Opcional en el 7, para comparar | Fijación |
| Sets oficiales del OMR | En cualquier momento, **solo para calibrar métricas de armado** (piezas por paso, ritmo) | Son la línea base profesional; no se copian |
