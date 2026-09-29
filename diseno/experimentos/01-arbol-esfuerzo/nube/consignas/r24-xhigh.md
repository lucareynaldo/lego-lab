# Encargo: diseñá un árbol original con ladrillos LEGO

Sos diseñador de modelos originales con ladrillos LEGO para videos cortos de armado (formato vertical, se ven en el celular). Diseñá **un árbol**. La especie y la forma las elegís vos. Buscamos un modelo que se reconozca al instante, que sea lindo y que tenga al menos una idea o técnica que sorprenda.

## Antes de empezar

Si en la raíz del repo no existe `.cache/ldraw`, corré primero `bash setup.sh` (baja los datos e instala todo; tarda unos minutos). Después creá la carpeta de trabajo `corrida/` en la raíz del repo.

## Restricciones

- **Tamaño:** entre 60 y 250 piezas. Base de 16 × 16 studs como máximo. Se sostiene solo sobre una mesa, y la base es parte del modelo.
- **Piezas:** solo las que salieron en algún set. `piezas buscar` las muestra por defecto. Solo colores en que cada pieza salió de verdad.
- **Prohibido:** las piezas de árbol prefabricadas de una sola pieza (2435, 3470, 3471, 3778, 52211, 2518c01 y cualquier otra cuyo título empiece con "Plant Tree"). Las hojas, plantas chicas y flores sueltas sí se permiten.
- **Tiene que pasar `validar` sin errores.**
- **Armado:** al menos 2 submodelos (sub-armados) y pasos pensados para un video (ver "Armado").
- **Trabajá solo dentro de `corrida/`.** No leas nada del repo fuera de esa carpeta salvo `taller/` (herramientas y su código) y `consigna/`. No busques en internet ni en otro lado modelos de árboles hechos por otros.

## Herramientas (taller)

Todas se usan con Bash desde `corrida/`: `node --no-warnings ../taller/src/cli.ts <comando>`.

| Comando | Para qué |
|---|---|
| `piezas buscar <texto>` | Buscar piezas (ordenadas por frecuencia de uso) |
| `piezas ver <id>` | Tamaño, grilla de studs y anti-studs, otros conectores y colores de una pieza |
| `construir diseno.ts` | Ejecutar tu script y generar `modelo.mpd` |
| `validar modelo.mpd [--sub <nombre>]` | Verificar que se pueda armar; los errores señalan la línea de tu script |
| `render modelo.mpd --salida renders/ [--vistas 34,frente,lado,arriba] [--lado 64] [--modo silueta] [--paso n] [--sub nombre]` | Imagen con varias vistas; abrila con Read |
| `metricas modelo.mpd` | Números del modelo |

El modelo se escribe como un script (`corrida/diseno.ts`) con la API de `../taller/src/dsl.ts`. Leé ese archivo primero: tiene la documentación y ejemplos. Tu script importa así, exactamente:

```ts
import {Modelo, grilla} from '../taller/src/dsl.ts';
```

**No escribas coordenadas ni matrices a mano si podés encastrar por conector** (`sobre` / `stud`, `debajo` / `antistud`, `conector` / `propio`).

## Proceso

1. **Ficha.** Leé `consigna/hechos-arbol.md` (hechos de árboles reales). Anotá en `corrida/ficha.md`:
   - la especie o forma elegida y por qué;
   - la escala;
   - los 2–3 rasgos que, si faltan, hacen que deje de leerse como ese árbol.
2. **Tres conceptos.** En `ficha.md`, tres ideas distintas en una o dos frases cada una: silueta, paleta, sub-armados y el momento "revelación" del armado. Elegí una y decí por qué.
3. **Boceto.** Armá primero la forma general con piezas simples. Validá y mirá el render en 4 vistas y a 64 px (`--lado 64 --modo silueta`). ¿Se lee como árbol?
4. **Pasada de elementos.** Sub-armado por sub-armado, reemplazá bloques por las piezas que den la forma: pendientes, curvas, placas en ángulo, SNOT, hojas. Buscá al menos un uso ingenioso de una pieza. **Validá cada sub-armado al cerrarlo (`--sub`).** Si se rompe, volvé al último estado válido.
5. **Refinamiento.** Mirá los renders con ojo crítico: proporción, paleta, terminación de todos lados, cómo se ve a 64 px. Corregí y repetí mientras mejore.
6. **Armado.** Ordená los pasos (ver abajo).
7. **Entrega.**

## Armado

- **Un sub-armado por parte** (base, tronco, copa…). Lo que va junto se arma junto.
- **Una pieza significativa por paso**, más piezas chicas. Un grupo repetido se muestra entero una o dos veces y después se agrupa.
- **Cada pieza nueva se ve** desde la vista 3/4 y no tapa lo que viene.
- **Ritmo:** después de un tramo difícil, uno tranquilo.
- **La revelación al final:** lo más llamativo se coloca tarde.
- **Cada paso cambia la silueta de forma visible.**

## Entrega

En `corrida/`:
- `diseno.ts` y `modelo.mpd` (el final, validado).
- `ficha.md`, que al final también incluye:
  - qué salió bien;
  - qué no te convence;
  - la forma de copa según la tabla de `consigna/hechos-arbol.md`.
- `renders/final.png`, con las vistas `34,frente,lado,34atras`.

Después subí tu trabajo a una rama propia (solo la carpeta `corrida/`, nunca `.cache`):

```sh
git checkout -b corrida/r24
git add corrida
git commit -m "corrida r24"
git push origin corrida/r24
```

Cuando termines, respondé solo con: `ENTREGADO` o `SIN ENTREGA: <motivo>`.
