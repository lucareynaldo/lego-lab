# estudio

Motor de video de lego-lab: Remotion + three.js `LDrawLoader`. Anima un modelo LDraw paso a paso (según sus `0 STEP`) en formato vertical 1080×1920.

## Preparación (una sola vez)

```sh
# Biblioteca oficial de piezas LDraw (CC BY 4.0), ~145 MB → ../.cache/ldraw
mkdir -p ../.cache && curl -L -o ../.cache/complete.zip https://library.ldraw.org/library/updates/complete.zip
(cd ../.cache && unzip -q complete.zip)
npm install
```

## Uso

```sh
# 1. Empaquetar: modelo + todas sus piezas en un solo .mpd → public/modelos/
node scripts/empaquetar.mjs ../referencias/sets-test/modelos/40014-1.mpd

# 2. (opcional) Comprobar que carga en Node, sin navegador
node scripts/probar-carga.mjs public/modelos/40014-1.packed.mpd

# 3. Previsualizar o renderizar
npm run studio
npx remotion render src/index.ts test-40014-1 salida/test-40014-1.mp4 --gl=angle --concurrency=2
```

Los modelos grandes tardan en cargar (el Bookshop, 2.504 piezas, tarda ~3 min en Node). Para esos casos hay que pasar `--timeout=600000` a `render`/`still`.

## Cómo funciona

- **`scripts/empaquetar.mjs`** resuelve recursivamente cada referencia (`parts/`, `p/`, `models/`) y agrega las definiciones de color de `LDConfig.ldr`.
  - Nombra los archivos embebidos como los busca el loader: `s/…` → `parts/s/…` y `48/…` → `p/48/…`.
  - Convierte `ROTSTEP` en `STEP`.
- **`src/armado/cargarModelo.ts`** carga el modelo una vez por pestaña.
  - Para cada pieza guarda su paso (`userData.buildingStep`), su posición de reposo y la dirección "arriba" del mundo expresada en el espacio de su padre.
  - Así una pieza que está dentro de un sub-armado rotado igual cae verticalmente.
- **`src/armado/Armado.tsx`** anima el armado:
  - Las piezas de pasos anteriores quedan en su lugar.
  - Las del paso actual caen 160 LDU con easing de salida.
  - La cámara orbita y encuadra la esfera que envuelve el modelo completo.
  - La duración sale de `calculateMetadata`: intro + pasos × cuadros por paso + final.

## Mediciones (2026-09-27, laptop i3-1115G4, sin GPU, `--gl=angle`, concurrency 2)

| Modelo | Piezas | Pasos | Carga | Render |
|---|---|---|---|---|
| 40014-1 Halloween Bat | 25 | 7 | < 1 s | 216 cuadros en 31 s (~7 cuadros/s) |
| 10226-1 Sopwith Camel | 879 | 173 | ~20 s por pestaña | 90 cuadros en 39 s (~2,3 cuadros/s) |

Los 12 sets de test se empaquetan sin piezas faltantes. Tiempos de carga en Node (`probar-carga.mjs`): de 0,1 s (Bat) a 7,5 s (Sopwith Camel); Vespa 6,4 s; Bookshop 176 s.

**Pendiente:** el conteo de piezas del loader no coincide con el de Rebrickable (Tank Truck: 326 contra 222; Bat: 28 contra 25). Probablemente se deba a piezas compuestas (atajos que contienen varias piezas), piezas flexibles o repuestos. Hay que resolverlo en el verificador antes de usar el conteo para la lista de piezas.
