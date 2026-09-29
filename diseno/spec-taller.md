# Spec: taller de diseño

> 2026-09-29. Estado: **implementado** (v1, 2026-09-29). Las razones de cada herramienta están en [investigaciones/02](../investigaciones/02-diseno-de-modelos.md). El plan de implementación es [plan-taller.md](plan-taller.md).

## Para qué

Darle a Claude (u otro agente) lo necesario para diseñar un modelo LDraw **sin escribir coordenadas ni matrices a mano**, verlo desde varias vistas, validarlo y medirlo. Todo se usa desde la terminal. Así un agente en modo headless (`claude -p`) lo usa con Bash y ve las imágenes con Read.

## Ubicación y convenciones

- Carpeta nueva `taller/`, igual que `verificador/`: Node ≥ 23.6 ejecuta los `.ts` directamente, TypeScript estricto, código y mensajes en español, tabs.
- **Reutiliza el verificador importando sus módulos** (`../../verificador/src/*.ts`), sin copiarlos: `Biblioteca`, `conectoresDe`, `transformarConector`, `conexiones`, `mallaDe`, `verificar`.
- **Renderiza con `estudio/`**: una composición nueva de Remotion y `scripts/render-secuencias.mjs`.
- Datos en `.cache/`, como el resto. El índice del catálogo va a `.cache/taller/`.
- Punto de entrada único: `node --no-warnings taller/src/cli.ts <comando> …`

## Comandos

### `piezas buscar <texto> [--categoria <c>] [--max <n>] [--todas]`

Busca en el título de las piezas LDraw usables (sin alias `=`, `~`, `_` ni "Moved to").
- Por defecto solo piezas que salieron en algún set (Rebrickable), **ordenadas por frecuencia de uso**. `--todas` quita el filtro.
- Salida: JSON, un objeto por pieza.

```json
{"id": "3004", "titulo": "Brick  1 x  2", "categoria": "Brick", "frecuencia": 412345, "colores": [0, 1, 4, 14, 15, 70, 71, 72]}
```

### `piezas ver <id>`

Ficha de una pieza.
- **Caja envolvente** en LDU y en unidades LEGO: studs en X y Z, placas en Y.
- **Grilla de studs y de anti-studs**, cada uno con su índice (i, j).
- **Lista numerada del resto de los conectores** (pines, ejes, agujeros, clips, barras, bisagras) con tipo, género, posición y eje.
- **Colores en que salió.** Nombre LDraw más código, solo cuando el RGB de LDraw coincide con el de Rebrickable (ver [02 §10](../investigaciones/02-diseno-de-modelos.md#10-datos-de-piezas-los-tenemos)).

### `construir <diseno.ts> [--salida <modelo.mpd>]`

Ejecuta el script de diseño (API abajo) y escribe:
- el `.mpd`, con un `0 FILE` por submodelo y un `0 STEP` por paso;
- `<modelo>.mapa.json`, que dice qué línea del `.mpd` salió de qué línea del script.

Si el script lanza un error (color inexistente, stud fuera de rango, pieza inexistente), el mensaje dice la línea del script.

### `validar <modelo.mpd> [--sub <nombre>]`

Corre el verificador. Salida:

```json
{
  "ok": false, "piezas": 42, "pasos": 9,
  "errores": [{"regla": "flotante", "mensaje": "…", "submodelo": "copa", "paso": 3, "donde": ["diseno.ts:57 (hoja-izq)"]}],
  "avisos": [...]
}
```

- `donde` traduce `"submodelo:línea"` del verificador a la línea del script, usando el mapa.
- `--sub` valida un solo submodelo como si fuera el modelo entero. Es para validar al cerrar cada sub-armado.
- Código de salida: 1 si hay errores.

### `render <modelo.mpd> --salida <carpeta> [--vistas 34,frente,lado,arriba] [--lado <px>] [--modo color|silueta] [--paso <n>] [--sub <nombre>]`

Una sola imagen PNG: grilla con las vistas pedidas, en proyección ortográfica, encuadradas en el modelo.

| Vista | Desde dónde mira |
|---|---|
| `34` | Adelante-izquierda-arriba (la del manual) |
| `34atras` | Atrás-derecha-arriba |
| `frente` | De frente (−Z en LDraw) |
| `lado` | Desde la derecha (+X en LDraw) |
| `arriba` | Desde arriba |

- `--lado 64` da la prueba de reconocimiento a 64 px.
- `--modo silueta`: negro sobre blanco, sin bordes.
- `--paso n`: solo lo colocado hasta el paso n.
- `--sub`: aísla un submodelo.
- Se imprime la ruta del PNG, para que el agente lo abra con Read.

### `metricas <modelo.mpd>`

JSON con:

| Métrica | Definición |
|---|---|
| `piezas`, `pasos`, `submodelos` | Del verificador |
| `valido` | Sin errores del verificador |
| `colores` | Colores distintos |
| `noBasicas` | Proporción de piezas que no son ladrillo, placa ni baldosa rectangular lisa (título `Brick/Plate/Tile N x M [x K]`). Aproxima "salir del look vóxel" |
| `piezasPorPaso` | `{media, max}` |
| `studs` | `{ancho, fondo, alto}`: caja del modelo en studs y ladrillos |
| `fractal` | Dimensión fractal por conteo de cajas de la silueta de frente, a 512 px |
| `cambioSilueta` | Por paso: fracción de píxeles de la silueta de frente que cambian respecto del paso anterior, sobre el área final. Se reportan `{media, min, pasosInvisibles}`, donde un paso invisible cambia menos del 1 % |

## API del script de diseño (`taller/src/dsl.ts`)

```ts
import {Modelo} from '../../taller/src/dsl.ts'; // ruta absoluta en la consigna

const m = new Modelo('arbol');
const tronco = m.sub('tronco');                    // un submodelo = un sub-armado

// Primera pieza: en el origen del submodelo.
const base = tronco.poner('3005', 'Reddish_Brown', {nombre: 'base'});

// Encastrada: su anti-stud (0,0) sobre el stud (0,0) de `base`, girada 90° en vertical.
const b2 = tronco.poner('3005', 'Reddish_Brown', {sobre: base, stud: [0, 0], giro: 90});

// Colgada por debajo: su stud (0,0) dentro del anti-stud (1,0) de `b2`.
tronco.poner('3024', 'Green', {debajo: b2, antistud: [1, 0]});

// Cualquier conector: el conector 3 de la nueva en el conector 7 de `b2` (índices de `piezas ver`).
tronco.poner('4274', 'Light_Bluish_Grey', {conector: {de: b2, n: 7}, propio: 3});

// Libre, para lo que no encastra por conector (bisagras en ángulo, hojas): posición en LDU y rotación por ejes.
tronco.poner('2417', 'Green', {en: [0, -72, 10], rot: 'X90 Y45'});

tronco.paso();                                     // cierra el paso actual

m.raiz.colocar(tronco, {en: [0, 0, 0]});           // el submodelo entra entero en un paso del padre
m.raiz.paso();
m.guardar('arbol.mpd');                            // escribe .mpd y .mapa.json
```

**Reglas:**
- **Colores:** nombre de `LDConfig.ldr` (sin distinguir mayúsculas) o código numérico. Un color inexistente es un error.
- **Stud (i, j):** i crece en +X y j en +Z, desde la esquina de menor X y menor Z. Lo mismo para anti-studs.
- **`giro`:** 0, 90, 180 o 270 grados alrededor del eje del conector.
- **Qué encastra en v1:** solo conectores cilíndricos (studs, anti-studs, pines, ejes, agujeros, barras). Clips y bisagras van por `en` + `rot` y el verificador confirma que conectan.
- **`rot`:** secuencia de giros por eje, en grados, aplicada de izquierda a derecha en el sistema del submodelo. Por ejemplo `'X90 Y45'`.
- **`en`:** en LDU (1 stud = 20; 1 placa = 8; un ladrillo = 24; **−Y es arriba**). Ayudante: `grilla(x, capas, z)` = `[20x, −8·capas, 20z]`.
- Cada `poner` guarda la línea del script que lo llamó, para el mapa.

## Qué no entra en v1

| Qué | Por qué no | Cuándo |
|---|---|---|
| Servidor de render persistente | Cada `render` pagaba el arranque (~10–20 s) | adelantado: implementado el 2026-09-29 (el render era cuello de botella: 34 s → 3–5 s) |
| Métrica de visibilidad por paso (Agrawala) | Necesita un buffer de ids por pieza; es más trabajo | Después del piloto |
| Encastre de clips y bisagras | Tienen geometría de conexión distinta; se cubren con `en`/`rot` | v2 |
| Mapeo completo de ids LDraw ↔ Rebrickable | Necesita la API; las piezas comunes coinciden en 90 % | Cuando se haga la lista de compras |
| Biblioteca de técnicas como código | En el experimento contaminaría las corridas entre sí | Después del piloto, con lo aprendido |
| Juez VLM y corredor del experimento | Es otro subsistema | Plan aparte, después del taller ([preregistro](experimentos/01-arbol-esfuerzo/preregistro.md)) |

## Criterios de aceptación

1. Un script con dos `3001` encastrados da un `.mpd` que el verificador aprueba sin errores ni avisos.
2. `piezas ver 3001` lista 8 studs en una grilla de 2×4 y 8 anti-studs.
3. `render` de un set de prueba (`40014-1`) produce una grilla de 4 vistas legible, y en `--modo silueta` produce solo negro y blanco.
4. `validar` de un modelo roto a propósito señala la línea del script en `donde`.
5. `metricas` da `fractal` entre 1 y 2 y `cambioSilueta.media` > 0 en un set de prueba.
6. El conjunto de pruebas (`npm test` en `taller/`) pasa, y el del verificador sigue pasando.
