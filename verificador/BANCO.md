# Banco de pruebas

Cómo medimos si el verificador (y el plan del manual) funcionan en general, no solo en los 10 sets con los que empezamos.

## Método

- **Datos.** Los modelos del [OMR de LDraw](https://library.ldraw.org/omr/sets): 1.421 descargados de 1.470; los otros 49 tienen otro nombre de archivo. Son sets oficiales, así que el **modelo terminado** existe y se arma: cualquier error sobre el estado final es, en principio, un falso positivo nuestro. El **orden de pasos** lo definió quien modeló cada archivo y puede estar desprolijo, así que ahí los hallazgos pueden ser reales.
- **Partición fija** (`referencias/particion.csv`), por hash FNV-1a del número de set:
  - **Calibración** (~80 %, 1.166 sets): sobre estos se ajusta el código.
  - **Test** (~20 %, 304 sets): no se miran para ajustar; se usan al final para medir si las mejoras generalizan. Excepción conocida: el 10270-1 Bookshop cae en test pero se vio durante el desarrollo (era de reserva), así que se excluye de las métricas de test.
- **Pruebas que no deben romperse:**
  - `pruebas/unitarias.ts`: casos mínimos de conexión, incluido cuándo un agujero es pasante (un pin con collar no lo es).
  - `pruebas/murcielago-roto.mpd`: errores a propósito que se tienen que detectar (`pieza-inexistente`, `colision`, `flotante`).
  - `pruebas/voladizo-mal-ordenado.ldr`: el orden del archivo no sirve pero otro sí (aviso `orden-sin-camino`, sin errores).
  - `pruebas/trabado.ldr`: pieza por pieza no se arma; con un sub-armado sí (aviso `requiere-subarmado`, sin errores).
  - `pruebas/voladizo-bien.ldr` y `pruebas/trabado-con-subarmado.mpd`: tienen que pasar sin errores.
  - `pruebas/apoyado.ldr`: un ladrillo apoyado sobre una baldosa lisa. Sin errores (no está en el aire), con el aviso `apoyado-sin-conexion`.
  - Se corren con `npm test`.
- **Ciclo de trabajo:**
  1. Corrida completa de calibración.
  2. Se elige la regla con más falsos positivos.
  3. Se arma una **muestra fija** estratificada por tamaño (30-40 modelos) y se revisan los casos con `depurar.ts` y `vista.ts`.
  4. Se corrige la causa de fondo.
  5. Se mide sobre la muestra antes y después, junto con las pruebas.
  6. Cada tanto, una corrida completa.

## Uso

```sh
# todo el grupo de calibración, un proceso (la laptop tiene 7,8 GB), con el plan del manual
node --no-warnings src/lote.ts ../.cache/omr --grupo calibracion --paralelo 1 --memoria 2560 --con-manual --salida ../.cache/lote/calibracion-N
# retomar una corrida cortada
node --no-warnings src/lote.ts ... --salida <misma carpeta> --reanudar
```

Los modelos se reparten entre **trabajadores persistentes** (`trabajador.ts`, uno por proceso), del más grande al más chico:
- Cada trabajador procesa muchos modelos y conserva entre ellos los cachés de la biblioteca: geometría, conectores y archivos LDraw ya leídos.
- Si un modelo excede el tiempo, se mata ese trabajador y se levanta otro; si su memoria pasa el 70 % del límite, se recicla.
- Un cuelgue o una caída queda registrado y no frena la corrida. El resultado queda en `resumen.md` y `resultados.jsonl`, este último con tiempos, hallazgos por regla y características de cada modelo.

## Historial (grupo calibración)

| Corrida | Fecha | Modelos | Fallas del programa | Sin errores | `colision` | `flota` | `subarmado…` | `sin-camino` | `flotante` | `se-vuelca` |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 (parcial, versiones mezcladas) | 27-09 | 461 | 7 timeouts | 44 % | 27 % | 31 % | 34 % | 25 % | 45 % | 8 % |
| 2 | 28-09 | 1.128 | **0** | 37,4 % | 37,7 % | 21,5 % | 34,0 % | 31,0 % | 46,8 % | 2,7 % |
| 3 | 28-09 | 1.128 | **0** | **41,4 %** | 31,7 % | 16,7 % | 26,5 % | 30,6 % | 40,6 % | 2,1 % |
| 4 (1 proceso, optimizada: 20 min) | 28-09 | 1.128 | **0** | 41,4 % | = | = | = | = | = | = |
| 5 (3 procesos, memoria optimizada: 12,8 min) | 28-09 | 1.128 | **0** | 41,4 % | = | = | = | = | = | = |
| 6 (camino de inserción nuevo: 19 min) | 28-09 | 1.128 | **0** | **47,5 %** | 31,7 % | 16,7 % | 26,5 % | **3,0 %** | 40,5 % | 2,1 % |
| 7 (flotantes, conexiones; búsqueda de grupos optimizada: 15 min) | 28-09 | 1.128 | **0** | **50,7 %** | 31,9 % | 17,3 % | 27,1 % | 2,9 % | **33,3 %** | 2,1 % |

| 8 (`superpuestas`, corrección de alias y LSynth: 19 min) | 29-09 | 1.128 | **0** | 47,4 % | **28,9 %** | 17,1 % | 26,6 % | 3,2 % | 32,9 % | 2,1 % |

En la corrida 8, `superpuestas` (regla nueva) aparece en el 25,8 % de los modelos (1.402 casos). No se sabe todavía qué parte son errores reales de los archivos y qué parte falsos positivos: la muestra revisada tiene de las dos cosas. Es lo primero que hay que medir con las instrucciones oficiales. Grupo test, tercera corrida: 45,1 % sin errores, `superpuestas` 27,0 %, `colision` 28,7 %.

**Grupo test, segunda corrida** (mismo código que la 7): 0 fallas, **50,2 % sin errores**, `flotante` 35,2 % (antes 39,9 %), `colision` 32,8 %, `subarmado…` 30,4 %, `flota` 21,2 %, `sin-camino-recto` 3,4 %. Las subas chicas de `colision`, `flota` y `subarmado…` entre la 6 y la 7 vienen de las dos correcciones de conexiones: piezas encimadas que antes contaban como encastradas.

**Grupo test, primera corrida** (28-09, mismo código que la 6; 293 modelos, el 10270-1 no está descargado): 0 fallas del programa, **49,1 % sin errores**, `sin-camino-recto` en el 3,4 % de los modelos, `colision` 31,7 %, `flotante` 39,9 %, `subarmado…` 29,7 %, `flota` 20,8 %, `se-vuelca` 1,7 %. Los porcentajes son parecidos a los de calibración: las mejoras no dependen de los sets con que se ajustaron.

Después de la corrida 6 se optimizó la búsqueda de grupos del desarmado, sin cambiar resultados (las tres muestras dan idéntico). El 42083-1 pasó de 106 s a 72 s de CPU:
- una búsqueda fallida no se repite hasta que sale alguna pieza de la que dependía (socios encastrados o lo que bloqueó);
- partir un sub-armado ya no invalida todo;
- los obstáculos se arman solo si la prueba pasa los encastres.

## Cambios entre corridas, y por qué

**Entre la 1 y la 2:**
- **Rendimiento.** El 42069 bajó de 85 s a 11 s: la estabilidad usa las esquinas de las cajas en vez de todos los vértices, las colisiones ya no crean objetos por triángulo y los triángulos pasaron a `Float32`. Con eso desaparecieron los timeouts y las caídas por memoria de los modelos gigantes (UCS, Coliseo, Titanic, Technic de más de 4.000 piezas).
- **Objetos aparte a otra altura, sin nada debajo:** pasan a ser aviso.
- **Inferencia de encastre con 3 LDU de holgura:** cubre piezas redondas 1×1 entre cuatro studs.
- **Encastre parcial:** si el macho queda justo al correrlo hasta 3 LDU, cuenta como conectado.
- **Carga suelta:** grupos de hasta 3 piezas apoyados o guardados, dentro de un sub-armado, son aviso.
- **Vuelco de accesorios:** un objeto de hasta 3 piezas que "se vuelca" es aviso.
- **Regresión encontrada por las pruebas negativas:** una conexión inferida eximía de colisión a dos piezas encimadas. Ahora solo eximen las conexiones declaradas.

**Entre la 2 y la 3:**
- **Colisiones con conexión inferida.** Eran el 53 % de las colisiones de la muestra. Ahora se toleran hasta 5 LDU (un stud). Muestra de colisiones: de 318 a 224 casos.
- **Bug de bordes entre secciones (introducido en el refactor del encastre parcial).** Una muestra en el borde collar/eje de un pin caía en el collar y descartaba la conexión, así que bujes y engranajes sobre pines-eje quedaban "sueltos". En las muestras: colisión, errores totales de 1.450 a 973; `flota`, casos de 101 a 65. Quedó cubierto por una prueba unitaria.

## Optimizaciones de las corridas (28-09)

La corrida 3 tardó 81 min con un proceso nuevo por modelo. La 4, con los mismos resultados, tardó **20 min** con un solo proceso. Cambios:

1. **El plan del manual reutiliza el reporte del verificador.** Antes se verificaba dos veces, y eso era la mitad del tiempo.
2. **Trabajadores persistentes con cachés compartidos.** La biblioteca LDraw y la shadow library se leen una vez por proceso. Los cachés de geometría y conectores usan como clave el modelo dueño de las piezas embebidas, para que dos modelos con una pieza embebida del mismo nombre no se mezclen (era un bug latente).
3. **Los más grandes primero:** con varios trabajadores, el final queda más parejo.
4. **En la regla de flotantes por paso,** el punto más bajo de cada pieza se guarda en caché en vez de recalcularse en cada paso.

Efecto medido: en los 12 sets de prueba, la mediana pasó de 7,4 s a 0,8 s y el máximo de 24,6 s a 3,7 s. El 42131 (6.771 piezas) pasó de 131 s a 19 s.

## Memoria (28-09)

La laptop tiene 7,8 GB. Se auditó qué queda retenido entre modelos (`estadisticasGeometria`, `estadisticasConectores` y `estadisticasArchivos`, midiendo después de forzar el recolector) y qué se usa realmente.

**Hallazgos y correcciones:**

| Qué | Antes | Después | Cómo |
|---|---|---|---|
| Fuga: piezas embebidas de modelos ya terminados en los cachés globales | 154 entradas tras 60 modelos, sin límite | 0 | `liberarModelo(bib)` al terminar cada modelo |
| Geometría de sub-archivos intermedios (sub-piezas) guardada además de la pieza completa | 112 MB tras 60 modelos | 3,9 MB | Solo se guardan las primitivas; las sub-piezas se recalculan |
| Triángulos de todas las piezas distintas vistas en la corrida | Crecían sin límite (~80 MB cada 60 modelos) | Acotados a 600 piezas | De cada pieza queda siempre caja y superficie; los triángulos van a un LRU |
| Texto de cada archivo LDraw leído | ~53 MB tras 60 modelos | 0 | Se guarda título y tipo; las líneas se leen del disco bajo demanda |
| Triángulos en el mundo de todas las piezas del modelo (pasos, colisiones) | Todo el modelo | LRU de 400 piezas | Las vecinas se repiten seguido |
| Memoria que V8 reserva y no devuelve | ~530 MB con ~90 MB en uso | ~340 MB | `--max-semi-space-size=4`, sin costo de tiempo |

**Pico por proceso** con los dos modelos más grandes (Titanic, 9.168 piezas, y 42131, 6.771): 646 MB antes; **352 MB** ahora. Con `--ahorro` (`--optimize-for-size`) baja a 249 MB, a cambio de ~15 % más de tiempo. `lote.ts` usa por defecto 3 procesos con 1 GB de límite cada uno. Detalle a cuidar: los cachés que duran toda la corrida no deben guardar referencias a la `Biblioteca` de un modelo, porque la retendrían entera.

## Camino de inserción (28-09)

La regla `sin-camino-recto` se rehízo en tres partes. Todo se midió sobre las tres muestras fijas (camino, colisión, flota: 100 modelos) y con las pruebas.

**1. ¿Existe otro orden? (desarmado).** Una pieza que no entra en el orden del archivo puede entrar en otro. Se desarma el modelo terminado sacando en línea recta todo lo que pueda salir; si sale, el problema es de los pasos (aviso `orden-sin-camino`), no del modelo. Cuando ya no sale nada suelto:
- se prueban **grupos chicos** que se traban entre sí (una viga con sus pines, dos piezas unidas por un pin con collar), hasta 8 unidades. El grupo tiene que poder armarse aparte (se lo desarma solo). Si hace falta, el aviso es `requiere-subarmado`.
- se **parte un sub-armado declarado** que no entra entero (tiene piezas a los dos lados de algo ya colocado). Si con sus piezas por separado sale, el aviso es `subarmado-no-entra`.

Solo lo que no sale de ninguna de esas formas queda como error.

**2. Cinemática de los encastres.** La geometría sola no ve bien las superficies curvas: un pin que se mueve de costado dentro de su agujero, o un stud dentro del ladrillo de arriba, solo se solapan en tiras finas, por debajo de la tolerancia de roce. Ahora:
- un encastre cilíndrico declarado (stud, pin, eje) solo deja mover a lo largo de su eje, y en el sentido en que se suelta;
- un agujero abierto de los dos lados es **pasante solo si el perfil del macho pasa**: un pin con collar no sigue de largo (antes, todo agujero abierto era pasante);
- las **conexiones inferidas** (una punta dentro de la caja de otra pieza) no traban: son una suposición, y aparecen también cuando dos piezas están encimadas por error.

**3. Correcciones de solidez** (encontradas revisando el desarmado):
- los obstáculos de cada pieza se buscaban a 24 LDU, pero un eje largo recorre más: ahora se usa lo que realmente puede recorrer (encastre más profundo + 8 LDU);
- una pieza sin encastres con lo presente salía "libre" sin mirar si estaba encerrada: ahora se prueba en las seis direcciones.

**Resultados en las muestras** (hallazgos de inserción, las tres muestras juntas):

| Versión | `sin-camino-recto` (error) | `orden-sin-camino` | `requiere-subarmado` | `subarmado-no-entra` | Tiempo |
|---|---|---|---|---|---|
| v6 (antes) | 593 | — | — | — | ~4 min |
| v8: desarmado | 29 | 564 | — | — | 5,5 min |
| v9: cinemática estricta | 1.657 | 885 | — | — | 3,6 min |
| v10: las inferidas no traban | 243 | 570 | — | — | 3,6 min |
| v11: grupos | 165 | 629 | 19 | — | 5,5 min |
| v13: sub-armados partidos | **80** | 671 | 28 | 63 | 5 min |

La v8 daba pocos errores porque era permisiva: dejaba pasar pines de costado y collares por los agujeros. La v13 da más que la v8, pero cada traba tiene una causa física.

**Tiempos.** El desarmado hizo que las muestras pasaran de ~4 a 28 min. Se bajaron sin cambiar resultados (verificado modelo por modelo):
- el recorrido contra cada obstáculo se guarda por (unidad, dirección, pieza); alcanza con encontrar un obstáculo que choque;
- la prueba de triángulos ordena por el eje más largo de la zona común y separa los triángulos largos;
- se descartan los triángulos que no pueden penetrar el umbral: si la diagonal de su caja mide menos del doble del umbral, no pueden atravesar un plano esa profundidad por los dos lados (exacto);
- un índice de cajas por bloques de 32 triángulos por pieza, y el desplazamiento se pasa como parámetro en vez de copiar triángulos;
- el solape inicial se guarda por par de piezas, y los triángulos de lo que se mueve se calculan solo si hacen falta;
- el test de agujero pasante no recorre nada si ninguna sección del macho puede chocar con la hembra (un stud).

El 42055-1 (3.928 piezas) pasó de 184 s a ~27 s.

**Lo que queda** (80 casos en las muestras) se concentra en sets Technic (8275, 42000, 10271, 7632). El patrón típico: paneles grandes (64782, 64393) o vigas sujetas con pines en caras perpendiculares, que en la realidad entran porque el plástico **flexiona**. El verificador no modela flexión y no se eximen piezas por nombre.

## Flotantes y conexiones (28-09)

**Flotante por paso.** En la muestra de flota eran 734 casos, la mayoría en el paso 1 de un submodelo. Dos cambios con causa física:
- **Apoyado no es flotante.** Un grupo que descansa sobre otras piezas (a lo sumo 4 LDU por encima de lo que tiene debajo, medido según el "abajo" de cada paso) no está en el aire: lo sostiene su peso. Es el mismo criterio que ya usaba el estado final: si nunca se encastra, lo reporta el modelo terminado (`apoyado-sin-conexion`, o `flota` si queda un hueco). Casos típicos: accesorios, una nave sobre su soporte, un árbol sobre su base.
- **Se une más adelante.** Si el grupo se une al resto en un paso posterior (se busca por bisección, porque una vez unido queda unido), el modelo está bien y lo que falla es el orden: aviso `suelto-varios-pasos` ("colocarlas en el paso N"). El caso de un solo paso ya era `sostener-un-paso`. Solo queda error si no se une nunca.

Resultado en las tres muestras: `flotante` de 734 a 428.

**Dos correcciones de conexiones** que salieron de la prueba del murciélago roto (el ladrillo levantado dejó de detectarse al agregar la regla anterior):
- **Stud metido de más.** El anti-stud de un ladrillo está declarado como un cilindro de 20 LDU (todo el hueco), y un stud contaba como encastrado a cualquier profundidad. Ahora un macho con base (caps=one, como un stud) no puede tener la base más de 3 LDU adentro de la hembra, la misma tolerancia del encastre parcial. Si la tiene, el cuerpo de su pieza también está adentro, así que las piezas están encimadas, no encastradas. Con eso el ladrillo levantado vuelve a detectarse como suelto (y el sub-armado, como partido en dos). Prueba unitaria nueva.
- **Inferida entre piezas encimadas.** Si dos piezas se atraviesan más que la altura de un stud (5 LDU), no se infiere una conexión entre ellas: la punta está adentro porque están encimadas.

Efecto en las muestras: 4 colisiones nuevas (revisadas: solapes reales de los archivos) y 1 sub-armado partido.

**Intento descartado.** Exigir que la punta de un macho entre al menos 1 LDU para inferir una conexión: un stud que apenas toca la cara de abajo de otra pieza se toma hoy como encastrado. En sets oficiales subió `flotante` de 428 a 656, así que rompía conexiones reales (el sentido del eje o la posición de la base en los datos de la shadow library no siempre es el supuesto). Se revirtió; queda como limitación.

## Banco de mutaciones: medir si detecta (29-09)

El banco de sets oficiales mide un solo lado: cuántas veces el verificador marca algo que está bien. No dice cuántos errores deja pasar, que es lo que importa para validar modelos originales. `src/mutaciones.ts` toma modelos oficiales de calibración que hoy pasan sin errores (50-600 piezas, elegidos por hash) y les mete defectos con respuesta conocida. Un mutante cuenta como detectado si algún hallazgo apunta a la pieza tocada.

```sh
node --no-warnings src/mutaciones.ts --modelos 40 --por-tipo 3 --salida ../.cache/mutaciones/<nombre>
```

| Mutación | m1 (antes) | m2/m3 (con `superpuestas`) |
|---|---|---|
| duplicado-exacto (misma pieza en el mismo lugar) | 0 % | **98 %** |
| encimado (copia corrida 6 LDU) | 34 % (+25 % solo aviso) | **91 %** |
| levantada (24 LDU, un ladrillo) | 70 % | **84 %** |
| corrida (medio stud de costado) | 32 % | 48 % |
| adelantada (al paso 1: orden, informativa) | 72 % como aviso | 68 % como aviso |

**Lo que mostró m1:** la prueba de colisión solo ve triángulos que se cruzan. Dos piezas en la misma capa que se pisan no tienen ninguno: sus caras coinciden en los mismos planos. Por eso un duplicado exacto, dos placas encimadas o un ladrillo subido justo a la capa de arriba pasaban sin detectarse. Es el error de diseño más común.

**Regla nueva `superpuestas`** (error). Cuando dos piezas solo se tocan, las caras que coinciden miran en sentidos opuestos (la de arriba de una contra la de abajo de la otra). Cuando se pisan, miran para el mismo lado. Se mide el área que comparten caras coplanares con la misma normal:
- La orientación sale de BFC (sentido de los polígonos, INVERTNEXT, matrices espejo). El 100 % de la biblioteca oficial está certificada (`parts`, `p` y `parts/s`).
- Para no marcar imprecisiones del modelado (0,5 LDU a lo largo de un borde), se exige un ancho medio (área / mayor extensión) de al menos 2,5 LDU, el mismo umbral que `colision`, y un área mínima de 10 LDU².
- Se excluyen las piezas flexibles y los engranajes.

**Dos correcciones de datos** que salieron al revisar los falsos positivos:
- **Alias 32531 y 32532** (Technic Brick 4×6 y 6×8 con centro abierto): desde la actualización 2023-03 de LDraw son "~Moved to …a" con una rotación de 90° que no coincide con cómo están modelados los archivos del OMR (el ladrillo sobresale un stud por lado). Referenciando la pieza nueva sin la rotación, los errores bajan en los 34 modelos del OMR que los usan y no suben en ninguno (76161: de 206 colisiones y superposiciones a 7). Se corrige al leer (`CORRECCIONES` en `ldraw.ts`). No encontré documentación del cambio; habría que reportarlo a LDraw.
- **Mangueras de LSynth:** los segmentos (piezas con `!KEYWORDS LSynth`) se superponen a propósito. Ahora cuentan como un elemento flexible (por submodelo).

**Efecto en las muestras oficiales:** `superpuestas` da 188 casos en 47 modelos (antes de las correcciones, 580). `colision` bajó mucho por la corrección de los alias (muestra camino: de 266 a 60). En la revisión visual de una hoja de 12 casos hay de las dos cosas:
- errores reales de los archivos: una baldosa 2×4 duplicada en el 10258, una placa 1×2 metida en la capa de una 8×16 en el 21045;
- casos dudosos: una minifigura sentada con las piernas dentro del asiento (aproximación de las poses en LDraw), un brazo de grúa telescópico, una puerta en su marco.

Los dudosos se van a resolver con las instrucciones oficiales.

**Costo:** los modelos grandes tardan el doble (10294: de 18 a 40 s). La prueba nueva recorre todos los pares candidatos.

**Pendiente, la mutación "corrida" (49 %):** una placa corrida medio stud apoya sus studs donde la pieza de arriba tiene material (postes de las placas 1×N, paredes de los tubos). Son dos volúmenes curvos que chocan y ninguna de las dos pruebas lo ve.

**Intento descartado: sonda de conectores.** Para cada stud o pin que entra en otra pieza sin encastrar, se sondeaban segmentos dentro del cilindro del macho (el eje y cuatro paralelas) y se miraba si cruzaban triángulos de la otra pieza. Resultado:
- detección de "corrida" de 48 % a 49 %: el stud quedaba coaxial con el poste de la placa y los segmentos corrían enteros dentro del material, sin cruzar ninguna superficie;
- **342 colisiones nuevas en sets oficiales**, casi todas bisagras (2430) y pines Technic en vigas, encastres donde la geometría del macho y del hueco se solapan por diseño.

La suposición de base ("un macho encastrado está en un hueco limpio") no se cumple en piezas reales. Se revirtió.

## Casos límite conocidos (no resueltos)

- Inferencia generosa: una pieza apoyada con la cara de abajo sobre las puntas de los studs, sin encastrar, puede contar como conectada (ver "Intento descartado").

- Paneles y vigas Technic que entran flexionando (ver arriba).

- Vidrios de ventana con la bisagra fuera de lugar (4554: corrida 6 LDU, o en el medio del marco): el solape de 4 LDU es real en el archivo.
- Colisiones: en la muestra, la mayoría de los casos revisados son solapes reales de los archivos del OMR. Ejemplos: el 10258 tiene un ladrillo Technic 6×8 ocupando el lugar de dos 1×16; el radiador del 10185 tiene vigas finas encajadas con un corrimiento de 3 LDU; hay accesorios y figuras superpuestos. No se ablandó la regla sin una razón física.
- Baldosas sujetas de costado con un clip que abraza el borde: es fricción, no un conector.
- Eje corrido 6 LDU del agujero que lo sostiene (10277): ¿imprecisión del archivo?
- Tapa de tolva entre dos paredes, sin studs (7636): ¿fricción o error del archivo?
- Errores reales encontrados en archivos del OMR: una baldosa 1×8 metida dentro de una placa 6×8 (10190), y piezas colocadas pasos antes de tener soporte (3180, 42048).
