# 02 — Cómo diseñar modelos originales (y cómo medir su calidad)

- **Fecha:** 2026-09-29.
- **Pregunta:** ya tenemos un verificador (¿se puede armar?) y un generador de manuales. Falta lo anterior: **¿cómo diseña Claude un modelo original bueno?** ¿Qué referencias, herramientas y proceso necesita? ¿Cómo medimos la calidad? Y, para el primer piloto (un árbol), ¿cómo medimos el efecto del **nivel de esfuerzo** (*effort*) de Opus 5.5?
- **Método:**
  - Siete investigaciones web en paralelo: diseño computacional LEGO, criterio de diseñadores expertos, agentes LLM que diseñan 3D con código, evaluación automática, hechos botánicos de árboles, metodología de experimentos con LLM y documentación oficial de *effort*.
  - Lectura del código de `verificador/`, `estudio/` y `manual/`.
  - Mediciones propias sobre `.cache/` (biblioteca LDraw, shadow library, CSV de Rebrickable).
- **Evidencia:** **fuerte / moderada / débil**, como en [01](01-viabilidad.md). **(I)** = inferencia propia. **[índice]** = el libro se vio solo por índice y reseña, sin texto de páginas.
- **Documentos que salen de acá:** [`diseno/proceso.md`](../diseno/proceso.md) (metodología), [`diseno/spec-taller.md`](../diseno/spec-taller.md) (herramientas), [`diseno/plan-taller.md`](../diseno/plan-taller.md) (plan de implementación) y [`diseno/experimentos/01-arbol-esfuerzo/`](../diseno/experimentos/01-arbol-esfuerzo/) (piloto).

## 1. Resumen ejecutivo

1. **Los LLM son buenos diseñando y malos en geometría exacta.**
   - Idear, descomponer y criticar un render: bien.
   - Escribir coordenadas y matrices de rotación a mano: mal. Un LLM general produce 2,4 % de estructuras válidas escribiendo ladrillos a mano (BrickGPT).
   - Los mejores modelos multimodales aciertan ~50 % de preguntas espaciales sobre LEGO, contra más del 90 % de los humanos (LEGO-Puzzles).
   - **Consecuencia:** la geometría la resuelven las herramientas. Claude diseña, y encastra piezas por nombre de conector, no por coordenadas.
2. **La validez sale de un chequeo externo paso a paso, con vuelta atrás.**
   - Así logra BrickGPT 100 % de validez: descarta la pieza inválida y, si una estructura queda inestable, vuelve a antes de la primera pieza inestable.
   - La autocrítica sin señal externa no mejora el resultado y puede empeorarlo (fuerte).
3. **Nadie mide "qué tan lindo" es un modelo LEGO ni "qué tan disfrutable" es armarlo.**
   - La literatura académica optimiza fidelidad de forma, estabilidad, conectividad y cantidad de piezas, y sus resultados se ven "voxelados".
   - El criterio estético está en los expertos (LEGO Masters: "historia, creatividad y técnica") y hay que operacionalizarlo nosotros.
4. **En un video, el armado es el producto.**
   - Los diseñadores de LEGO dicen que diseñan "la experiencia de armado y el producto final".
   - Hay reglas con respaldo experimental sobre pasos e instrucciones: una pieza significativa por paso y visibilidad (Agrawala 2003).
5. **Juez: comparaciones de a pares con varias vistas, nunca notas absolutas.**
   - Los VLM como jueces coinciden razonablemente con expertos en comparaciones de a pares (τ ≈ 0,71 en GPTEval3D).
   - Con notas absolutas son sesgados.
   - Además prefieren sus propias salidas, un problema porque todo lo generaría Claude.
6. **Más esfuerzo no garantiza mejor diseño.**
   - La documentación oficial dice que `max` "agrega costo significativo por ganancias de calidad relativamente chicas" y puede sobrepensar.
   - Hay evidencia de *inverse scaling* (más razonamiento, peor resultado) en algunas tareas.
   - En un agente, el esfuerzo cambia también **cuánto usa las herramientas**. Esto justifica el experimento del piloto.
7. **Los datos de piezas ya los tenemos (§10).** Falta un índice consultable que los junte: dimensiones, conectores, colores reales y frecuencia.

## 2. Qué hace bien y qué hace mal un LLM diseñando en 3D

| Hallazgo | Fuente | Evidencia |
|---|---|---|
| LLaMA-3.2-1B afinado en 47k estructuras llega a 100 % válido y 98,8 % estable con **rechazo pieza por pieza + vuelta atrás por física**. Un LLM general, con ejemplos en el prompt: 2,4 % válido y 1,2 % estable (ladrillos que se cruzan o flotan) | Pun et al., *BrickGPT*, ICCV 2025 (mejor paper), [arXiv 2505.05469](https://arxiv.org/abs/2505.05469) | Fuerte |
| Límites de BrickGPT: 8 ladrillos básicos, grilla de 20³, 21 categorías. Descarta LDraw porque **no trae dimensiones** de las piezas | Ídem | Fuerte |
| 20 LLM multimodales: el mejor ~50 % en preguntas espaciales de LEGO, humanos >90 %. Peor en rotación 3D, alineación y seguir el armado en varios pasos | Tang et al., *LEGO-Puzzles*, 2025, [arXiv 2503.19990](https://arxiv.org/abs/2503.19990) | Moderada |
| La autocrítica intrínseca (sin señal externa) no mejora de forma fiable y puede empeorar | Huang et al., ICLR 2024, [arXiv 2310.01798](https://arxiv.org/abs/2310.01798) | Fuerte |
| Con más acceso a herramientas (una vista → varias → cámara libre → interacción 3D), los VLM reconstruyen geometría como código bastante mejor | Liu et al., *3DHarnessBench*, sep 2026, [arXiv 2609.06535](https://arxiv.org/abs/2609.06535) | Débil-moderada (preprint reciente) |

**(I)** Las debilidades de Claude son justo lo que el código resuelve bien: rotaciones, encastres, colisiones. Sus fortalezas son lo que el código no hace: concepto, abstracción y criterio. Por eso las herramientas se diseñan para encastrar por **nombre de conector** ("esta pieza sobre el stud (2,1) de aquella") y no por coordenadas.

## 3. Diseño computacional LEGO (literatura académica)

| Trabajo | Qué optimiza | Límites | Evidencia |
|---|---|---|---|
| Testuz, Schwartzburg y Pauly, Eurographics 2013 ([EPFL](https://infoscience.epfl.ch/record/189856)) | Malla → vóxeles → ladrillos grandes que puentean las juntas de la capa de abajo | Esculturas de ladrillos básicos | Moderada |
| Luo et al., *Legolization*, SIGGRAPH Asia 2015 ([ACM](https://dl.acm.org/doi/10.1145/2816795.2818091)) | Fidelidad de color, cantidad de piezas, estabilidad por equilibrio de fuerzas (busca los ladrillos más débiles y rehace a su alrededor). Validado armando | Estilo vóxel | Fuerte |
| Kollsker y Stidsen, *Operations Research Forum* 2021 ([doi](https://doi.org/10.1007/s43069-021-00062-3)) | Búsqueda de vecindario grande + programación entera + equilibrio estático; hasta 77k posiciones | Ídem | Moderada |
| Liu et al., *StableLego*, IEEE RA-L 2024 ([arXiv](https://arxiv.org/abs/2402.10711)) | Análisis de estabilidad por fuerzas; dataset de 50k estructuras | Solo ladrillos básicos | Fuerte |
| Xu et al., *Computational LEGO Technic Design*, SIGGRAPH Asia 2019 ([arXiv](https://arxiv.org/abs/2007.02245)) | Parecido al boceto, simetría, simplicidad, solidez, que se pueda armar | Technic | Moderada (solo el resumen) |
| Ge, Zhou y Fu, *Learn to Create Simple LEGO Micro Buildings*, ACM TOG 2024 ([ACM](https://dl.acm.org/doi/10.1145/3687755)) | **Pocas piezas y tipos variados**; garantiza conectividad | Edificios micro. Es lo más cercano a un modelo estilizado | Moderada |
| *LegoACE*, SIGGRAPH Asia 2025 ([ACM](https://dl.acm.org/doi/10.1145/3757377.3763881)) | Transformer pieza por pieza sobre 9.314 tipos; conectividad 82 % | 18 % de salidas con piezas sueltas | Moderada |

**Conclusión (fuerte):** todos optimizan fidelidad, estabilidad, conectividad o cantidad de piezas. **Ninguno optimiza estética, experiencia de armado ni calidad de instrucciones.** Los métodos por vóxeles o ladrillos básicos se ven en bloque: pocas pendientes, pocos tiles, nada de SNOT.

## 4. Criterio experto

### 4.1 Principios de diseño

- **Primero la escala; el nivel de detalle sale de ahí.** Bedford ordena todo su libro por escala: minifig, miniland, jumbo, micro. *The Unofficial LEGO Builder's Guide* 2.ª ed. [índice]. Moderada.
- **En escala chica se abstrae: se conserva lo icónico y se saca el resto.**
  - Tom Alphin, para no pasar de 20 piezas, sacó las alas de un edificio y conservó "las columnas y la cúpula".
  - Según él, la micro requiere "uso creativo de piezas y un alto grado de abstracción", y las formas libres y curvas son las que peor se reducen.
  - [brickarchitect.com](https://brickarchitect.com/2015/nanoscale). Fuerte.
- **Textura, patrones, esculpido, composición y silueta son habilidades distintas.** Schwartz (exdiseñador de LEGO Creator) les da un capítulo a cada una. *The Art of LEGO Design*, No Starch [índice]. Moderada.
- **Studs a la vista o no.** Mark Stafford (LEGO): "LEGO está orgullosa de sus studs, y un modelo sin ninguno está mal visto". Agrega que sus modelos de fan ahora "usan menos elementos, se ven más limpios y son más estables". [Brothers Brick 2009](https://www.brothers-brick.com/). Fuerte.
- **NPU** (*nice part usage*, uso ingenioso de una pieza) es una de las razones principales por las que los blogs destacan un modelo. [Brothers Brick 2011](https://www.brothers-brick.com/2011/04/08/this-is-npu/). Moderada.
- **Color.**
  - Un esquema armónico (análogo, complementario o triádico) más neutros.
  - Acentos de alto contraste en pocas zonas, rodeados de zonas calmas, en posiciones asimétricas (tercios).
  - Oscar Cederwall, BrickNerd, 2024. Moderada.
- **Estabilidad y juego.** Stafford: "si un chico de siete años no lo puede armar con instrucciones y jugar con amigos sin que se rompa demasiado, no hice mi trabajo". Las técnicas ilegales, inestables o "que no se pueden explicar claramente en instrucciones" no entran en los sets. Fuerte.

### 4.2 La experiencia de armado

- **Ritmo.** Jamie Berard (LEGO): "diseñamos intencionalmente el armado para que a las partes difíciles les sigan momentos de calma y segmentos familiares". Valora los momentos de "esto es interesante", que salen de técnicas no obvias. [Brick Architect 2018](https://brickarchitect.com/2018/interview-lego-creator-expert-jamie-berard). Fuerte.
- **Se diseña el armado, no solo el modelo.** Carl Merriam (LEGO): "diseñás la experiencia de armado y el producto final". Mental Floss, *11 Secrets of LEGO Designers*. Fuerte (reportado).
- **Se mide el tiempo de búsqueda de piezas.** Mike Psiaki: en las pruebas de armado "medimos cuánto se tarda en encontrar ciertas piezas". [Brickset](https://brickset.com/article/43725). Fuerte. Los colores llamativos en el interior son deliberados para eso, según un exdiseñador. [Brickset](https://brickset.com/article/107900). Fuerte (de segunda mano).
- **Sorpresas para quien ya armó otros sets.** Psiaki sobre el ECTO-1: la construcción es distinta a la de autos anteriores "así que hay sorpresas". [Brickset](https://brickset.com/article/54887). Fuerte.
- **Las instrucciones las diseña un equipo aparte.** Ese equipo decide cuántas piezas por paso y el ángulo, y arma el modelo "muchas, muchas veces". [lego.com](https://www.lego.com/). Fuerte.
- **Hueco:** no hay fuente primaria sobre "evitar pasos repetitivos o espejados". Se cree en general, pero no está documentado. Débil.

### 4.3 Cómo juzgan los expertos

- **LEGO Masters** (Berard y Corbett): "lo dividimos en narración, creatividad y habilidad técnica". Y además: "podés ser técnicamente increíble y hacer modelos muy aburridos". Brothers Brick 2020; Brickset. Fuerte.
- **Concursos:** concepto, calidad (técnica, NPU) y presentación (composición, foto). BrickNerd. Moderada.
- **Convenciones:** composición, técnica y estética; detalle proporcional al tamaño; "prolijo de todos lados". BrickNerd 2025. Moderada.
- **Brickworld:** sin rúbrica numérica; premia detalle, originalidad y cohesión por categoría. [brickworld.com](https://brickworld.com/convention-awards). Fuerte.
- **LEGO Ideas:** jugabilidad, seguridad, estabilidad, que se pueda fabricar con piezas y colores existentes, originalidad. En la foto, el sujeto ocupa al menos el 80 % de la imagen. Fuerte/moderada.

### 4.4 Cómo trabajan los profesionales

- **Bocetan con ladrillos:** "casi todo empieza con ladrillos" (Psiaki). Hay "modelos boceto" y varios modelos de desarrollo, a veces de diseñadores distintos. Fuerte.
- **Primero las piezas existentes**, antes de pedir una nueva. Fuerte.
- **Presupuesto:** el costo de piezas no puede pasar el límite de precio (Stafford). Fuerte.
- **Revisiones:** pruebas de juego, "sesiones de sparring" y una revisión final pieza por pieza, en cantidad y orden exactos, que lleva de un día a una semana. Fuerte.

## 5. Instrucciones y orden de pasos

- **Jerarquía.** La gente ve un ensamble como un árbol de partes. Las piezas de un mismo grupo funcional (patas, ruedas) van juntas o seguidas, como sub-armados. Agrawala et al., SIGGRAPH 2003 ([ACM](https://dl.acm.org/doi/10.1145/1201775.882352)). Fuerte.
- **Una pieza significativa por paso**, más varias chicas. Una operación repetida se muestra entera unas dos veces y después se omite. Ídem. Fuerte.
- **Visibilidad, "quizás el principio más fuerte".**
  - Toda pieza nueva tiene que verse, y no debe tapar las que vienen.
  - Umbrales que funcionaron: la pieza nueva menos visible, ≥ 50 %; piezas anteriores, ≥ 10 %; futuras, ≥ 25 %.
  - Si la mejor visibilidad de una nueva cae bajo el 35 %, rotar la cámara.
  - Ídem. Moderada (los umbrales).
- **Resultado medido:** instrucciones hechas con estos principios bajaron un 35 % el tiempo de armado y un 50 % los errores frente a las de fábrica. Heiser et al., AVI 2004 ([ACM](https://dl.acm.org/doi/10.1145/989863.989917)). Fuerte (probado con muebles, no con LEGO).
- **Sin estudios LEGO específicos** que cuantifiquen el tamaño de paso o el "flujo". Débil.

## 6. Abstracción y reconocimiento

- **Reconocimiento por componentes.** Se reconoce un objeto por pocos volúmenes simples y cómo se conectan. Con 2–3 componentes correctos ya se lo reconoce, si se ven los bordes y uniones clave. Biederman 1987, *Psychological Review* ([doi](https://doi.org/10.1037/0033-295X.94.2.115)). Fuerte.
- **Vista canónica:** una vista típica de tres cuartos acelera el reconocimiento. Palmer, Rosch y Chase 1981. Fuerte.
- **Abstraer bien** conserva las curvas que definen el objeto y la silueta. Mehra et al., SIGGRAPH Asia 2009. Moderada. La abstracción correcta depende de qué distingue al objeto dentro de su categoría. Yumer y Kara 2012. Moderada.
- **Baja resolución.** La gente reconoce objetos a ~32×32 px si la forma general y el color están bien. Torralba, Fergus y Freeman 2008, IEEE TPAMI. Fuerte.
  - **(I)** Para un Short visto en un celular, es un test barato: si el modelo no se lee a 64 px, la forma general está mal.

## 7. Agentes LLM que diseñan en 3D con código

| Trabajo | Patrón | Evidencia |
|---|---|---|
| SceneCraft, ICML 2024 ([PMLR](https://proceedings.mlr.press/v235/hu24g.html)) | Primero un grafo de relaciones como plano; después restricciones numéricas en código; después refinar mirando renders. **Biblioteca de funciones** que crece sin reentrenar | Fuerte |
| BlenderAlchemy, ECCV 2024 ([arXiv](https://arxiv.org/abs/2404.17672)) | Editar es **buscar**: varias ediciones candidatas, un VLM compara los renders y se queda con la mejor rama (puede retroceder) | Fuerte |
| LL3M, 2025 ([arXiv](https://arxiv.org/abs/2508.08228)) | Planificador → recuperador de documentación → programador → crítico con **5 vistas** → verificador. Cada componente mejora la calidad. Sin contexto de código compartido, "refinar" regenera otro objeto. Las piezas desconectadas sobreviven al autorrefinado | Moderada |
| 3D-GPT, 2023 ([arXiv](https://arxiv.org/abs/2310.12945)) | El LLM llama una **biblioteca procedural con parámetros** en vez de escribir geometría | Moderada |
| CADCodeVerify, ICLR 2025 | El VLM se hace preguntas de verificación sobre el render, se las responde y corrige. Ganancias modestas (−7,3 % de distancia, +5 % de éxito) | Fuerte (método) |
| CAD-Recode, ICCV 2025 ([arXiv](https://arxiv.org/abs/2412.14042)) | El código bien estructurado es una representación 3D eficaz | Fuerte |

**Patrones que se repiten:**
- Descomponer primero.
- Construir con funciones o macros, no con coordenadas crudas.
- Validar en cada paso, con vuelta atrás.
- Criticar con varias vistas y con un verificador separado.
- Editar en el lugar, sin reescribir.
- Ramificar en vez de seguir una sola cadena.

## 8. Evaluación automática de calidad

- **GPTEval3D** (Wu et al., CVPR 2024, [arXiv 2401.04092](https://arxiv.org/abs/2401.04092)). Fuerte.
  - Método: GPT-4V compara dos objetos a partir de grillas de 4 o 9 vistas (color + normales), **un criterio por vez**, y las comparaciones alimentan un Elo.
  - Resultado: τ de Kendall con expertos 0,710, contra 0,628 de CLIP. Promediar sobre varias corridas, disposiciones y órdenes mejora la coincidencia.
  - Dato aparte: los evaluadores no expertos coinciden poco entre sí (κ ≈ 0,3, contra ≥ 0,53 los expertos).
- **MLLM-as-a-Judge** (Chen et al., ICML 2024, [arXiv 2402.04788](https://arxiv.org/abs/2402.04788)): coincide con humanos en **pares**, pero con **notas absolutas** es sesgado e inconsistente (notas amontonadas en 4–5/5, sesgo de posición). Fuerte.
- **Sesgo de posición:** GPT-4 fue consistente al invertir el orden solo en ~65 % de los casos. Solución: juzgar en los dos órdenes y contar victoria solo si coinciden. Zheng et al., NeurIPS 2023 ([arXiv](https://arxiv.org/abs/2306.05685)). Fuerte.
- **Autopreferencia:** los LLM reconocen y favorecen sus propias salidas. Panickssery, Bowman y Feng, NeurIPS 2024 ([arXiv](https://arxiv.org/abs/2404.13076)). Fuerte. **(I)** Juez de otra familia de modelos, o calibrado contra un humano.
- **CLIP no alcanza:** ignora la consistencia 3D. T3Bench, 2023. Moderada.
- **Bradley–Terry con IC por bootstrap** es más estable que el Elo en línea cuando hay pocas comparaciones. Chiang et al., *Chatbot Arena*, ICML 2024 ([arXiv](https://arxiv.org/abs/2403.04132)). Fuerte.

## 9. Proceso de diseño: fijación y prototipos en paralelo

- **Fijación.** Quien ve un ejemplo copia sus rasgos, incluso los marcados como defectuosos. Jansson y Smith 1991, *Design Studies*. Fuerte. Meta-análisis de más de 40 estudios: los ejemplos achican la búsqueda. Sio, Kotovsky y Cagan 2015. Fuerte.
- **Prototipos en paralelo.** Hacer varios prototipos en paralelo le ganó a hacerlos en serie en todas las medidas, con más diversidad y menos fijación. Dow et al., ACM TOCHI 2010 ([doi](https://dl.acm.org/doi/10.1145/1879831.1879836)). Fuerte. Replicado en diseño de ingeniería física por Murphy et al. 2022. Moderada.
- **(I)** Para un LLM:
  - Una sola cadena de refinamiento en un contexto es la versión serial, fijada en su primer borrador.
  - Las imágenes de MOCs del mismo tema en el contexto actúan como "ejemplos" y anclan la salida.
  - Por eso: hechos del objeto real sí; MOCs del tema, no (igual que en content-generator).

## 10. Datos de piezas: ¿los tenemos?

**Sí, los datos están. Lo que falta es un índice que los junte.** Medido el 2026-09-29 sobre `.cache/`:

| Dato | Dónde | Cifra | ¿Qué falta? |
|---|---|---|---|
| Geometría | `ldraw/parts/` | 24.735 archivos; **20.104 piezas usables** (sin alias `=`, `~`, `_` ni "Moved to") | Nada. `mallaDe()` del verificador ya calcula la caja envolvente |
| Conectores | Shadow library de LDCad | 2.927 piezas con archivo propio. El resto hereda por primitivas (`stud.dat`, etc.), así que la cobertura real es mayor | Resumirlos por pieza: studs arriba, anti-studs abajo, ejes, pines |
| Colores reales por pieza | `inventory_parts.csv` | 1,56 M líneas | Invertirlo: pieza → colores en que salió |
| Frecuencia de uso | Ídem | **615 piezas** aparecen ≥ 1.000 veces en sets; 554 tienen el mismo id en LDraw (90 %) | Ordenar la búsqueda por frecuencia: se prefieren las piezas comunes |
| Correspondencia de ids LDraw ↔ Rebrickable | `parts.csv` | De las 20.104 de LDraw, solo 5.153 coinciden textualmente (las impresas y las variantes difieren). En las comunes coincide el 90 % | El mapeo completo necesita la API de Rebrickable (`external_ids`). Para el piloto alcanza con las comunes |
| Correspondencia de colores | `colors.csv` vs `LDConfig.ldr` | Para los colores sólidos clásicos, el id de Rebrickable coincide con el código LDraw (I, a verificar pieza por pieza con el RGB) | El verificador hoy usa el código LDraw como si fuera el id de Rebrickable |

**Plantas y árboles en LDraw (relevante para el piloto):**
- **Árboles prefabricados de una pieza:** 2435, 3470, 3471, 3778, 52211 y la palmera 2518c01.
- **Hojas y follaje sueltos:** 2417 y 2423 (hojas 6×5 y 4×3), 6255, 10884, 30176, 15469, arbustos 6064b.
- **Flores de varios tipos.**
- **(I)** Los árboles prefabricados anulan el ejercicio de diseño. La consigna del piloto los prohíbe (ver el [preregistro](../diseno/experimentos/01-arbol-esfuerzo/preregistro.md)).

**Lo que no está en ningún lado:** la grilla de studs indexada por (i, j) y el encastre automático (ubicar una pieza a partir de un conector). El verificador tiene las piezas (`conectoresDe`, `transformarConector`, `conexiones`), pero no la función. Es la herramienta central del [spec del taller](../diseno/spec-taller.md).

## 11. Nivel de esfuerzo (effort) de Opus 5.5

**Documentación oficial** ([effort](https://platform.claude.com/docs/en/build-with-claude/effort), [CLI](https://code.claude.com/docs/en/cli-reference)):
- **Niveles:** `low`, `medium` (predeterminado en Opus 5.5), `high`, `xhigh`, `max`. Confirmado localmente con `claude --help` (v2.1.284).
- **Es una señal de comportamiento, no un presupuesto estricto de tokens.** Afecta el pensamiento (adaptativo, siempre activo en Opus 5.5), el texto **y las llamadas a herramientas**: con menos esfuerzo, menos llamadas y más escuetas.
- **Advertencia oficial:** en un modelo Opus anterior, `max` "agrega costo significativo por ganancias de calidad relativamente chicas" y "puede llevar a sobrepensar". Recomiendan barrer los niveles con evals propias.
- **Cómo se fija:**
  - En modo headless, `claude -p --effort <nivel>`.
  - Otras vías: la variable `CLAUDE_CODE_EFFORT_LEVEL`, la clave `effortLevel` en settings y, en el Agent SDK, la opción `effort`.
  - Los subagentes heredan el nivel salvo que su definición diga otro.
- **Aislar corridas:** `--bare` (sin hooks, plugins ni memoria automática), `--no-session-persistence`, `--setting-sources`, `--strict-mcp-config`, `--tools`, `--model`, `--max-budget-usd`.
- **Contabilidad por corrida:** `--output-format json` da `total_cost_usd`, `usage`, `num_turns` y `model_usage` (con `thinkingTokens`, incluidos en `outputTokens`). Hay que confirmar el esquema con una corrida real.

**Literatura:**
- En matemática, las ganancias por más cómputo son decrecientes y dependen de la dificultad. Snell et al., ICLR 2025 ([arXiv](https://arxiv.org/abs/2408.03314)). Fuerte (para matemática).
- ***Inverse scaling***: razonar más largo **bajó** la precisión en algunas tareas. Los modelos Claude, en particular, se distrajeron más con información irrelevante. Gema et al., TMLR 2025 ([arXiv](https://arxiv.org/abs/2507.14417)). Fuerte.
- **Sobrepensar:** el rendimiento sube y después baja con el largo del pensamiento, y el muestreo en paralelo le gana a una traza más larga con el mismo presupuesto. Ghosal et al., NeurIPS 2025 ([arXiv](https://arxiv.org/abs/2506.04210)). Fuerte.
- En escritura abierta, los modelos de razonamiento ganan mucho menos que en matemática. Liu et al. 2026 ([arXiv](https://arxiv.org/abs/2604.03004)). Débil/moderada.
- **(I)** Hipótesis a priori: validez creciente con el esfuerzo; calidad estética con retornos decrecientes o no monótona; costo creciente más que proporcional. En un agente, el efecto puede venir más de **cuánto usa el verificador y el render** que del largo del pensamiento.

## 12. Metodología de experimentos con LLM

- **Varianza entre corridas.** Tratar las evals como experimentos: media ± error estándar, IC 95 % y diseño pareado cuando se puede. Miller, *Adding Error Bars to Evals* (Anthropic), 2024 ([arXiv](https://arxiv.org/abs/2411.00640)). Moderada/fuerte.
- **Los agentes son inconsistentes entre intentos:** el éxito en todos los k intentos (pass^k) cae fuerte con k, así que una corrida por condición no sirve. Yao et al., τ-bench, 2024 ([arXiv](https://arxiv.org/abs/2406.12045)). Moderada.
- **Muestras chicas.** Con n ≈ 4–5 por grupo, solo efectos muy grandes (d ≳ 1,8) llegan a 80 % de potencia. Se reportan tamaños de efecto con IC por bootstrap o test de permutación, no tests t. Efron y Tibshirani 1993. Fuerte.
- **Comparación de a pares.**
  - Modelo: Bradley–Terry, con la extensión de Davidson (1970) para los empates. Fuerte.
  - Acuerdo juez–humano: κ de Cohen más el porcentaje crudo. Con 4–5 niveles, τ es muy grueso: un intercambio lo mueve entre 0,2 y 0,33.
- **Cegado y preregistro.**
  - Fijar hipótesis, métricas y análisis antes de ver resultados. Talleres de preregistro de NeurIPS, PMLR v148. Moderada.
  - Anonimizar las salidas (Chatbot Arena). Fuerte.
  - No repetir corridas malas.

## 13. Qué implica

1. **Metodología:** [`diseno/proceso.md`](../diseno/proceso.md). Ficha con rasgos icónicos → hechos del objeto real (sin MOCs del tema) → conceptos en paralelo → modelo boceto → pasada de elementos por sub-armado con validación y vuelta atrás → refinamiento con renders → diseño del armado → QA en tres capas.
2. **Herramientas:** [`diseno/spec-taller.md`](../diseno/spec-taller.md). Catálogo consultable, encastre por conector, construcción por script, render de varias vistas (incluida la de 64 px y la silueta), validación y métricas.
3. **Piloto:** [`diseno/experimentos/01-arbol-esfuerzo/`](../diseno/experimentos/01-arbol-esfuerzo/). Un árbol × 5 niveles de esfuerzo, preregistrado y a ciegas.

## Fuentes que no se pudieron leer completas

- Libros de Schwartz, Bedford, Doyle y Sariel: solo índice y reseña.
- Guías de LEGO Ideas: la página devolvió 403 y se tomaron de una retransmisión (Stonewars).
- Sommer y Summit (1995, 1996): citados por fuentes secundarias.
- Objetivo completo de Xu et al. 2019: solo el resumen.
- Jansson y Smith 1991: por fuentes secundarias.
