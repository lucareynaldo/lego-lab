# manual

Genera un manual de instrucciones en PDF, estilo LEGO, a partir de un modelo LDraw (`.ldr`/`.mpd`):
- portada;
- una sección por sub-armado;
- pasos con la lista de piezas nuevas;
- flechas de inserción para lo que no entra desde arriba;
- recuadros ampliados cuando el cambio es chico;
- llamadas a sub-armados con referencia de página;
- inventario final con *element ID* de LEGO, color y número de pieza;
- página de verificación por computadora.

Costo $0: usa el estudio (Remotion + three.js) para las imágenes y Edge o Chrome headless, que ya vienen con Windows, para el PDF.

## Uso

```sh
npm install
node --no-warnings src/generar.ts ../referencias/sets-test/modelos/40271-1.mpd --uso-interno
# → ../estudio/salida/manual/40271-1/manual.pdf
```

`--uso-interno` marca el manual como prueba que no se distribuye: se usa con los sets oficiales, cuyo diseño es de LEGO.

Necesita lo mismo que el verificador en `../.cache/`: la biblioteca LDraw y, opcionalmente, los CSV de Rebrickable (`elements.csv.gz` para los *element ID*, `sets.csv.gz` para el nombre del set).

## Cómo funciona

1. **`planificar.ts`** lee el modelo y arma `plan.json`:
   - **Secciones.** Cada submodelo con pasos propios es una sección; primero los sub-armados, al final el modelo principal. Los "envoltorios" (un modelo que solo contiene otro) se saltean, y los elementos flexibles van como pieza.
   - **Pasos.** Cada uno lleva sus piezas nuevas agrupadas por pieza y color, los sub-armados que se colocan (con cantidad) y el `ROTSTEP`.
   - **Inventario.** Incluye el *element ID* de Rebrickable.
   - **Archivos planos.** Escribe un `.ldr` por sección, en sus propias coordenadas y con un `0 STEP` por paso, más `piezas.ldr` con una pieza por paso. Ambos incluyen las piezas personalizadas embebidas en el modelo original.
2. **`generar.ts`** empaqueta cada `.ldr` y lo renderiza con el estudio como secuencia de PNG:
   - **`manual-pasos`** (1200×900): un fotograma por paso.
     - Lo anterior va apenas más pálido (mezcla en sRGB) y las piezas nuevas llevan los bordes en naranja.
     - La cámara es ortográfica isométrica y encuadra lo visible, sin acercarse más de 2,2× respecto del modelo terminado.
     - Un fotograma extra muestra la sección terminada sin resaltar, para la portada y los íconos de sub-armado.
   - **`manual-piezas`** (300×300): un fotograma por pieza del inventario.
3. **`maquetar.ts`** arma `manual.html` (A4 apaisado, 4 pasos por página, 32 piezas por página de inventario) y lo imprime a PDF.

## Detalles de diseño

- **Flechas.** El planificador corre el verificador y toma, para cada pieza o sub-armado nuevo, la dirección libre de entrada que encontró. Si no es "desde arriba", el paso lleva una flecha roja que llega a la pieza desde esa dirección. En el Bunny son 30 de 89 inserciones.
- **Recuadro ampliado.** Un paso lo lleva si lo nuevo mide menos del 25 % de lo visible (y el modelo supera 80 LDU). El recuadro encuadra lo nuevo con aire alrededor y elige, entre las cuatro vistas isométricas, la que lo enfrenta: si la pieza va atrás, se ve desde atrás.
- **Índices.** Las flechas se refieren a la línea de pieza en el `.ldr` plano. En el estudio se mapean a los hijos directos del modelo cargado, no a la lista de piezas, porque las piezas compuestas (atajos) aportan varias piezas pero ocupan una sola línea.
- **Render.** `estudio/scripts/render-secuencias.mjs` recibe todos los trabajos, prepara el bundle de Remotion una vez y abre el navegador una vez. Antes se invocaba `remotion render` por sección, con ~7 s de arranque cada vez.

## Tiempos (laptop i3 sin GPU)

| Modelo | Piezas | Pasos | Secciones | Páginas | Antes | Ahora |
|---|---|---|---|---|---|---|
| 40271-1 Bunny | 126 | 47 | 8 | 19 | 75 s | 40 s (con flechas y recuadros) |
| 4955-1 Big Rig | 548 | 170 | 32 | 61 | 288 s | sin medir todavía |

## Pendiente

- En la vista principal, los pasos cuyas piezas quedan atrás del modelo no se ven (solo el recuadro gira). Los manuales de LEGO dan vuelta el modelo con un ícono de giro.
- Las flechas son finas en modelos grandes y pueden taparse con otras piezas.
- Con `ROTSTEP`, la vista del recuadro se elige sin tener en cuenta el giro.
