# 01 — LEGO: animar armados, validar, generar manuales y vender

- **Fecha:** 2026-09-27. Catálogos, políticas, precios y actividad de repos consultados ese día. **Cambian seguido.**
- **Pregunta:** ¿es viable un canal de Shorts/Reels/TikTok con armados LEGO animados en 3D? El plan tiene seis pasos: (1) diseñar modelos, (2) validarlos (piezas reales, físicamente posibles), (3) colocar las piezas paso a paso por script, (4) generar el manual, (5) vender o "dropshippear" las piezas o los sets y (6) arrancar con un piloto de **sets oficiales**. Preguntas concretas: ¿qué datos hay?, ¿qué ya está construido?, ¿qué hay de cierto en el hilo que lo disparó?
- **Método:**
  - Análisis del hilo de X y de su video (fotogramas extraídos).
  - Descarga y lectura del manual publicado por el autor (141 páginas).
  - Tres investigaciones web en paralelo: datos, herramientas, legal/negocio.
  - Descargas de verificación: CSV de Rebrickable, `complete.zip` de LDraw y conteo del OMR página por página.
- **Evidencia:** **fuerte / moderada / débil**, como en el resto de la carpeta.
  - **[nv]** = no verificado: la fuente no abrió (403 o login) y el dato sale de un fragmento indexado.
  - **(I)** = inferencia propia.
  - ⚖ = tema legal a confirmar con un abogado.
- **Nota de alcance:** escrito originalmente en el repo `content-generator` (Shorts de ciencias naturales), donde era el documento 16; se movió acá cuando se decidió que LEGO es un proyecto aparte. Las decisiones que tomó el usuario después de leerlo están en §9.

## 1. Resumen ejecutivo

**Lo técnico ya está casi resuelto y es barato. El piloto propuesto (sets oficiales) es la parte débil, por razones legales y comerciales, no técnicas.**

**Lo técnico:**
- Todo el pipeline existe como piezas abiertas y scriptables:
  - geometría de piezas: LDraw, CC BY 4.0;
  - catálogo e inventarios: CSV de Rebrickable, uso comercial con atribución, actualizados a diario;
  - conectividad: shadow library de LDCad + pyldraw3;
  - render web: three.js `LDrawLoader`, que encaja con Remotion vía `@remotion/three`;
  - manuales: LPub3D headless o HTML → PDF.
- En septiembre de 2026 aparecieron varios clones abiertos del experimento del hilo (brickify, ai-lego, legolizer) que ya muestran el método.

**Las piedras en el camino:**
1. **Modelos 3D de sets oficiales recientes casi no existen.**
   - El repositorio oficial de modelos de LDraw (OMR) tiene 1.470 sets, pero solo 6 son de 2023–2025.
   - El 10350 no está en el OMR (hay uno de fans en el foro de LDraw).
   - Habría que **modelarlos a mano** desde el PDF.
2. **LEGO tiene el copyright de las instrucciones y de los diseños de sus sets.**
   - Su política *Fair Play* solo tolera usos **no comerciales** y "extractos limitados".
   - Una animación completa paso a paso de un set oficial, en un canal monetizado, es en la práctica un manual en otro formato. **No está autorizada.** ⚖
3. **Desde el 31-01-2026 el Marketplace de BrickLink no está disponible en Argentina** (ni para comprar ni para vender).
   - El courier argentino es solo para **uso personal**.
   - El dropshipping de LEGO genuino no deja margen.
   - Para una audiencia argentina, el mejor ingreso es **Mercado Libre Afiliados** (hasta 15 %, lanzado en marzo de 2026).
4. **YouTube aclaró en julio de 2026 que excluye del YPP el contenido "genérico, repetitivo o de plantilla"** hecho con CGI o IA.
   - Un canal de armados 3D automatizados sobre una misma plantilla cae de lleno en ese riesgo.

**Recomendación (I):**
- Usar los sets oficiales como **banco de pruebas interno** (verdad de referencia para validar las herramientas), **no como contenido publicado**.
- Publicar **modelos originales**, con un aporte de diseño humano documentado.
- Detalle en §7.

## 2. El hilo: qué hizo y qué hay de cierto

**Fuente.** Tuit de Victor Mustar (Head of Product de Hugging Face), 24-09-2026: [x.com/victormustar/status/2103110908444631120](https://x.com/victormustar/status/2103110908444631120). Tuvo 1,3 M de vistas.

**Lo que afirma.** Claude Opus 5.5 (esfuerzo "xhigh") diseñó a escala 1:1 el **Microduck**, un robot bípedo open source de Pollen Robotics. Según el tuit, logró:
- 1113 piezas reales;
- "3.204 conexiones, 0 colisiones, cada paso construible, centro de masa dentro de los pies";
- un manual de 141 páginas y 237 pasos;
- precios de cada pieza y pedidos preparados en BrickLink.

**Lo que se pudo verificar descargando el manual** ([bucket de HF](https://huggingface.co/buckets/victor/microduck-lego-booklet/tree/microduck_booklet.pdf)):
- El PDF existe y coincide con lo que dice el tuit: 141 páginas, 237 pasos en 13 secciones, 1113 piezas en 6 colores y 123 líneas de pieza/color. Cada línea trae el *element ID* de LEGO y el número de BrickLink.
- Tiene estilo LEGO real: lista de piezas por paso, contorno amarillo en las piezas nuevas, flechas y avisos de "dar vuelta" y "sub-armado".
- Se generó con **Chromium (HTML → PDF)**.
- Página 141, fuentes:
  - forma tomada del **CAD del robot** ([pollen-robotics/microduck_rl](https://github.com/pollen-robotics/microduck_rl), Apache-2.0);
  - piezas de la **biblioteca LDraw** (CC BY 4.0);
  - piezas y colores de **Rebrickable**.
- Archivos que menciona: `model/microduck.mpd` (LDraw), `parts_list.csv`, `bricklink_wanted.xml` y `tools/booklet.py`. **No están publicados**: el bucket solo contiene los PDF. No hay repo ni Space públicos.
- La portada dice textualmente: **"Not physically build-tested"** (no probado con piezas reales).

**Lo que desmiente o matiza el propio hilo:**
- **@timothykrell** mostró, en los pasos 1–2 del tronco, piezas "flotando" y otras "no trabadas entre sí". El autor lo reconoció: "your findings seem legit".
- Una segunda pasada de Opus admitió que **4 secciones no se pueden armar en el orden impreso**. En el tronco, 16 piezas se caen al dar vuelta el sub-armado en el paso 5.
  - La solución fue reordenar los pasos sin cambiar las piezas.
  - Opus reconoció que su verificador **no simula gravedad**: comprueba que cada pieza tenga un camino de entrada libre y quede conectada, pero no si se cae al girar el modelo.
- Otro usuario que lo intentó con BrickLink Studio reportó "no tanta suerte con la continuidad real del armado".
- **Compra:** tres tiendas de BrickLink, 126 lotes, **~95,55 €**. El autor dijo que lo va a armar con sus hijos. A la fecha no hay reporte del armado físico.

**Veredicto:**
- **Las cifras son reales:** el modelo, el conteo de piezas, el manual y el pedido existen.
- **"Every step buildable" es exagerado:** fue verificado solo en computadora, con un verificador que no modela la gravedad ni lo que pasa al dar vuelta el modelo, y ya se encontraron errores de orden.
- **Método:** no es magia de un solo prompt. Es un LLM que escribe **herramientas propias** (modelo LDraw + verificador + generador de manual) sobre datos abiertos. Es exactamente la arquitectura que conviene replicar (§5).
- **Evidencia:** moderada. Es el artefacto primario, pero sin código ni prueba física.

## 3. Datos disponibles

| Dato | ¿Hay? | Fuente | Licencia | Utilidad | Evidencia |
|---|---|---|---|---|---|
| Geometría de piezas | Sí: 17.116 piezas, `complete.zip` de 145 MB (versión 2026-08), sale casi cada mes | [LDraw](https://library.ldraw.org/updates) | CC BY 4.0, permite uso comercial ([art. 349](https://www.ldraw.org/article/349.html)) | **Alta** | Fuerte (descargado) |
| Sets, piezas, colores, elementos | Sí: 28.401 sets (1.454 de 2026), 64.675 piezas, 275 colores, 114.315 elementos | [CSV de Rebrickable](https://rebrickable.com/downloads/), regenerados a diario | Uso comercial con atribución; automatizar ≤ 1 vez/día **[nv]** | **Alta** | Fuerte (descargado y contado) |
| Inventario por set | Sí: 1,56 M líneas; incluye el 10350 (3.266 piezas) | `inventory_parts.csv` | Ídem | **Alta** | Fuerte |
| Mapeo de IDs LDraw ↔ BrickLink ↔ LEGO | Parcial en CSV; completo en la API (`external_ids`) | [API v3 de Rebrickable](https://rebrickable.com/api/v3/docs/), 1 petición/s | Uso comercial permitido | Alta (hay que cachear) | Moderada |
| Sustituciones de piezas | Sí: 37.438 relaciones (impresa, par, molde, alternativa…) | `part_relationships.csv` | Ídem | Media-alta | Fuerte |
| Modelos 3D de sets oficiales con pasos | **Parcial:** 1.470 sets; más del 90 % de 1975–2019; **solo 6 de 2023–2025** | [OMR de LDraw](https://library.ldraw.org/omr/sets/) + foro | CC BY 4.0 (sobre el archivo, **no** sobre el diseño de LEGO) | Calidad alta, **cobertura reciente casi nula** | Fuerte (59 páginas contadas) |
| Instrucciones oficiales (PDF) | Sí, una por una; sin API pública (hay un endpoint interno no documentado) | lego.com; `getInstructions` de Brickset | © LEGO; solo extractos no comerciales | Solo como **referencia** para modelar | Fuerte ([Fair Play](https://www.lego.com/en-us/legal/notices-and-policies/fair-play)) |
| Instrucciones 3D oficiales | No accesibles | App LEGO Builder | Propietaria | Nula | Moderada |
| Conectividad (studs, ejes, pines…) | Parcial, activa | [Shadow library de LDCad](https://github.com/RolandMelkert/LDCadShadowLibrary) | CC BY-SA 4.0 (derivados bajo la misma licencia) | **Media-alta**; es la clave para validar | Fuerte |
| Peso por pieza | Sí, poco fiable (lo cargan usuarios) | API de BrickLink | Sin redistribución | Media-baja; mejor volumen × 1,05 g/cm³ (ABS) | Moderada |
| Agarre entre piezas (*clutch*) | No hay datos por pieza | Divulgación (~3–5 N); StableLego y BrickGPT usan valores supuestos | — | Baja | Débil |
| Precios | Sí | Guía de precios de BrickLink (API, 5.000 llamadas/día); precio de lista de Brickset | Sin redistribución | Media | Moderada **[nv]** |
| "¿Qué sets compro para este modelo?" | Solo en la web ("Build" de Rebrickable) | — | — | **Hay que implementarlo** con los CSV (set cover con costos) | Moderada |
| Datasets de ML | StableText2Brick (MIT, ladrillos simples en grilla de 20³); BrickNet (+100 k modelos humanos, **solo investigación**); MEPNet, LTRON | HF / GitHub | Variable | Baja-media | Fuerte (papers) |

**Faltantes y advertencias:**
- **Cláusula de Rebrickable [nv]:** un fragmento indexado de sus términos dice que ningún contenido de Rebrickable puede usarse para entrenar modelos de IA. Consultar datos no es entrenar, pero hay que leer los términos a mano antes de usarlos en cualquier cosa de ML. ⚖
- **La API de Rebrickable no expone MOCs ni modelos alternativos**, y el scraping está prohibido.
- **La galería de Studio** considera infracción subir copias de sets oficiales ([IP Guidance](https://studiohelp.bricklink.com/hc/en-us/articles/6610276581015-IP-Guidance-Statement)). No es una fuente válida.

**Conclusión:** para el paso (6) con sets **recientes** los datos no están. Hay inventario (qué piezas) pero no posiciones ni pasos. Habría que modelar cada set a mano, entre decenas y cientos de horas por set grande (I).

## 4. Qué ya está construido

Numeración de pasos: 1 = diseñar, 2 = validar, 3 = orden de pasos, 4 = manual, 5 = render o animación, 6 = compra.

| Herramienta | Pasos | ¿Scriptable? | Licencia | Estado |
|---|---|---|---|---|
| **three.js LDrawLoader** ([docs](https://threejs.org/docs/pages/LDrawLoader.html)) | 5 | Sí (Node/Chromium; **Remotion vía `@remotion/three`**) | MIT | Maduro |
| **LeoCAD CLI** ([docs](https://www.leocad.org/docs/cli.html)) | 4, 5 (imagen por paso `--from/--to`, `--highlight`) | Sí | GPL | v26.09 (sep 2026) |
| **LPub3D** ([repo](https://github.com/trevorsandy/lpub3d)) | 4, 6 (lista de piezas, XML de BrickLink) | Sí, headless | GPLv3 | Es el estándar abierto de manuales |
| **LDView** | 5 | Sí, CLI | GPL-2.0 | v4.7 (2026) |
| Blender + **ImportLDraw** + **AssemblMe** | 5 (calidad fotorrealista, animación por `STEP`) | Parcial (`blender -b`) | GPL | Activo |
| **pyldraw3** ([repo](https://github.com/hbmartin/pyldraw3)) | 2 (grafo de conexiones), 3, 4 | Sí, CLI + librería | GPL-3.0+ | v1.7.0 (ago 2026); **no detecta colisiones** |
| **ldraw-verify** ([repo](https://github.com/MagicIndustries/ldraw-verify)) | 2 (reglas de BrickLink) | Sí, CLI Node | Sin licencia visible | Joven |
| StableLego / estabilidad de BrickGPT | 2 (fuerzas) | Python (Gurobi opcional) | MIT | Académico; solo ladrillos simples |
| BrickLink Studio | 2, 3, 4, 5, 6 (estabilidad, colisión, animación, lista de compra) | **No** (solo interfaz gráfica) | Gratis, cerrado | Maduro |
| **brickify** ([repo](https://github.com/hamnaanaa/brickify)) | 1, 2, 5, 6 | Sí | MIT | Sep 2026; **inspirado en el Microduck** |
| **ai-lego** ([repo](https://github.com/adityasudhakar/ai-lego)) | 2–6 | Scripts de ejemplo | Sin licencia verificada | Documenta costo: **6–7,5 USD y 2–4,5 h por modelo** |
| **legolizer** ([repo](https://github.com/LunarSphere/legolizer)) | 1, 2, 3, 4 (un LLM escribe primitivas → voxeles → solver de ladrillos con juntas alternadas → LPub3D) | Sí | **Sin licencia** (no reutilizable tal cual) | Sep 2026; es la referencia de diseño más completa |
| BrickGPT / LegoACE / BrickNet / STABLE | 1 (texto o imagen → LDraw) | Python + GPU | MIT (datos de BrickNet no comerciales) | Académicos, estilo voxel |
| Servidores MCP: brick-mcp, ldraw-mcp, bricks-mcp | 1 (edición por el agente), 5 (el agente "ve" el render), 6 | Sí | Varias | Jóvenes |
| "Build" de Rebrickable / Easy Buy de BrickLink / Brickonomics | 6 | No (web) | — | Maduros, sin API de optimización |

**Huecos reales, lo que habría que escribir:**
- **Colisiones malla contra malla sobre LDraw.** No hay una librería abierta. Se puede hacer con cajas envolventes o con mallas en three.js o trimesh.
- **Verificador de orden de pasos con gravedad.** Cada sub-armado tiene que quedar conexo **en la orientación en que se sostiene**, y al darlo vuelta no se puede caer nada. Es justo el error del Microduck.
- **Optimizador "qué sets comprar"** (set cover con costos, sustituciones y colores). No hay nada maduro. Sale con los CSV de Rebrickable + OR-Tools/PuLP.

**Conclusión:** el paso (3) es tan algorítmico como supone el plan. Con un modelo LDraw que ya tiene `0 STEP`, la colocación y la animación son **puro código y no gastan tokens**. Los tokens se van en **diseñar** (1) y en **escribir el verificador** una sola vez.

## 5. Arquitectura que se desprende (I)

La que usan el Microduck y sus clones, adaptada a nuestro `estudio/` en Remotion:

```
modelo .mpd (LDraw, con 0 STEP)  ← diseño (LLM + solver) o OMR
      │
      ├─ validar: pyldraw3 (conexiones) + colisión propia + orden de pasos con gravedad + centro de masa
      ├─ video: Remotion + @remotion/three + LDrawLoader (visibilidad por paso, 1080×1920)
      ├─ manual: LeoCAD CLI (imagen por paso) + HTML → PDF, o LPub3D
      └─ compra: CSV de Rebrickable → lista de piezas → XML de wanted list / optimizador de sets
```

- Todo corre en Windows sin GPU (I). Hay que medirlo: los modelos grandes (más de 1000 piezas) en three.js pueden ser pesados para el i3; en ese caso conviene cargar en el visor solo lo necesario (lección del render en Remotion del proyecto `content-generator`).

## 6. Legal y negocio

**Sets oficiales.**
- LEGO tiene el copyright de las instrucciones ([Fair Play](https://www.lego.com/en-us/legal/notices-and-policies/fair-play)). **Fuerte.**
- BrickLink Studio, que es de LEGO, dice que "los sets y sus temas siempre tienen copyright de LEGO" y pide no usar números de set en los títulos. **Fuerte.**
- La Ley 11.723 de Argentina protege las obras aplicadas a la industria. **Fuerte.**
- Caso Lepin: condena penal en China por copiar sets e instrucciones. **Fuerte.**
- En 2025 LEGO cerró un fan game que antes había tolerado. **Débil.**
- La CC BY del OMR cubre el archivo, **no** el diseño del set.
- Los temas con licencia (Star Wars, Harry Potter, Marvel) suman un segundo titular, más agresivo.
- Los canales de *speed-build* físico existen hace años sin problemas, pero muestran el producto. Un paso a paso 3D completo **reemplaza el manual** y compite con la app oficial LEGO Builder (I). ⚖

**Marca.**
- "LEGO" solo se puede usar como adjetivo ("ladrillos LEGO").
- Nunca en el nombre del canal ni en un dominio. Nunca el logo.
- Aviso obligatorio de no afiliación. **Fuerte.**

**Modelos diseñados con IA.**
- La Oficina de Copyright de EE. UU. (ene-2025) no protege lo generado solo por prompts. **Fuerte.**
- Rebrickable: un admin dijo (ene-2026) *"if AI designed it, you are not the designer"*, así que no se pueden vender esas instrucciones allí. **Moderada.**
- LEGO Ideas rechaza propuestas hechas con IA. **Fuerte.**
- En consecuencia, hace falta un **aporte humano documentado**, o vender por un canal propio.

**Monetización para una audiencia argentina:**

| Vía | Viable | Por qué |
|---|---|---|
| **Mercado Libre Afiliados** | **Sí, la mejor** | Hasta 15 % (juguetes probablemente 4–8 % **[nv]**); lanzado en todo el país el 10-03-2026 ([La Nación](https://www.lanacion.com.ar/economia/negocios/mercado-libre-lanza-el-programa-de-afiliados-y-creadores-nid10032026/)) |
| Afiliado de LEGO (Rakuten) / Amazon | Solo para audiencia de EE. UU. o Europa | ~2,4–3 % **[nv]**; LEGO US no envía a Argentina |
| Dropshipping de sets genuinos | No | Amazon restringe la marca; margen minorista bajo; posventa y aduana a cargo propio |
| Kits de piezas vía BrickLink | **No desde Argentina** | Marketplace cerrado para AR, BR, CL, CO, PE, EC y CR desde el 31-01-2026 ([aviso](https://www.bricklink.com/help.asp?helpID=2687)); el courier es solo para uso personal ([ARCA](https://www.afip.gob.ar/envios-internacionales/puerta-a-puerta/monto.asp)) |
| Vender instrucciones de modelos originales | Sí, con condiciones | Rebrickable cobra 10 % pero excluye los diseños de IA; alternativa: canal propio (Gumroad o similar) **[nv]** |
| Kits con piezas "clon" de un modelo **original** | Legal (I) | Solo sin la palabra LEGO, sin minifiguras y sin copiar sets. Con un set **oficial** sería el caso Lepin |

**Plataforma.**
- YouTube (aclaración del 16-07-2026) excluye del YPP el contenido de IA o CGI "genérico, repetitivo o de plantilla" ([TechCrunch](https://techcrunch.com/2026/07/20/youtube-clarifies-policies-around-ai-slop-and-upsetting-videos/)). **Moderada.**
- Además, la estética "LEGO hecho con IA" viene manchada por la propaganda iraní de 2026 (145 M de vistas, canal cerrado por YouTube). **Moderada.**
- Mercado: hay cuentas de LEGO en TikTok con 1–2 M de seguidores (Bricksiej, Epikbricks, TheAwesomerBricks). **Débil** (rankings de terceros). No hay cifras de cuentas de armado 3D animado específicamente.

## 7. Qué cambia del plan original (I)

| Paso del plan | Evaluación | Propuesta |
|---|---|---|
| (6) Piloto con sets oficiales | Técnicamente útil; **publicarlo es el mayor riesgo legal**, y los sets recientes no tienen modelo 3D | Usar sets del OMR (CC BY, de temas **sin licencia**) como **banco de pruebas interno**: validar el verificador, el render y el generador de manuales contra algo que sabemos que se puede armar. **No publicarlos**; como mucho fragmentos o "reveals" con aviso |
| (1) Diseñar | Es donde está el valor y la diferenciación | Modelos originales de objetos o personajes propios (el Microduck funcionó porque el robot es **open source**; ojo con la IP ajena). El diseño humano guía y corrige, y queda documentado |
| (2) Validar | Hay piezas, falta ensamblarlas | pyldraw3 + colisión propia + **orden de pasos con gravedad** (el error del Microduck) |
| (3) Colocar | Algorítmico, sin tokens | Remotion + LDrawLoader leyendo `0 STEP` |
| (4) Manual | Resuelto | LeoCAD CLI / LPub3D, o HTML → PDF como el Microduck |
| (5) Venta | BrickLink no sirve desde Argentina; dropshipping no | Afiliados de Mercado Libre para sets **oficiales relacionados**; instrucciones propias por canal propio; lista de piezas + "sets sugeridos" como servicio gratuito (atrae audiencia) |
| Formato | Riesgo de "plantilla" en YouTube | Cada video necesita una idea (el objeto, el reto, el truco de diseño), no solo el armado |

**Validación física.** Ningún verificador reemplaza armar el primer modelo con piezas reales. Un video del armado real (el modelo diseñado → las piezas → la prueba) es además el mejor contenido y la mejor defensa contra "esto es slop".

## 8. Pendientes

- ⚖ Leer a mano los términos de Rebrickable (cláusula de IA) y la política *Fair Play* aplicada a video monetizado.
- **[nv]** Confirmar la tasa de Mercado Libre Afiliados para juguetes y si lego.com/es-ar vende online.
- Confirmar el catálogo de piezas de los fabricantes compatibles (Gobricks y similares) y si alguna tienda de AliExpress arma kits a pedido en modo dropshipping.

## 9. Decisiones posteriores (2026-09-27)

Tomadas por el usuario después de leer este documento:

- **Repo propio** (`lego-lab`): el tema, el enfoque y las herramientas son distintos de los de `content-generator`. Solo comparten el formato de video vertical.
- **Prototipo a costo $0:** sin herramientas ni APIs pagas, sin comprar piezas y **sin armado físico**. Por eso la calidad del verificador (sobre todo el orden de pasos con gravedad) pasa a ser crítica.
- **No se usan brickify ni legolizer.**
- **Sets oficiales solo de uso interno**, como banco de pruebas: mínimo 10 modelos del OMR. Nunca se publican.
- **Se publican solo creaciones originales.** La web de bundles (dropshipping, posiblemente con piezas compatibles vía AliExpress y no solo para Argentina) es un negocio aparte, que se evalúa después.
- **YouTube:** el criterio no es "hecho con código", es que cada video tenga una idea propia y calidad. Es el norte del proyecto.
