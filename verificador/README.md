# verificador

Comprueba si un modelo LDraw (`.ldr`/`.mpd`) se puede armar con piezas reales:
- que las piezas existan y estén conectadas;
- que ningún paso deje piezas en el aire;
- que cada pieza pueda entrar en su lugar en línea recta;
- que nada se atraviese;
- que el modelo terminado se sostenga.

Es Node + TypeScript: Node ≥ 23.6 ejecuta los `.ts` directamente. No necesita compilar.

## Uso

```sh
npm install
node --no-warnings src/cli.ts ../referencias/sets-test/modelos/40014-1.mpd [otro.mpd ...] [--json <carpeta>]
npm run tipos      # chequeo de tipos
node --no-warnings src/depurar.ts <modelo.mpd> <submodelo> <línea> [radio] [pieza.dat]   # conectores de una pieza y sus vecinas
node --no-warnings src/vista.ts <modelo.mpd> <reporte.json> <n° hallazgo> <salida.ldr> [radio]  # escena de un hallazgo
```

**Ver un hallazgo.** `vista.ts` arma un `.ldr` con el estado del sub-armado justo antes del paso: lo anterior en gris, la pieza señalada en rojo y la que la bloquea en azul, solo en la zona del problema. Se renderiza con el estudio:

```sh
node --no-warnings src/vista.ts modelo.mpd reporte.json 18 ../.cache/vista.ldr
cd ../estudio && node scripts/empaquetar.mjs ../.cache/vista.ldr public/modelos/vista.packed.mpd
npx remotion still src/index.ts test-40014-1 salida/vista.png --props='{"modelo":"modelos/vista.packed.mpd","cuadrosPorPaso":18,"cuadrosCaida":12}' --frame=107 --gl=angle
```

El código de salida es 1 si algún modelo tiene errores. Con `--json` escribe un reporte por modelo.

**Datos que necesita** (en `../.cache/`, fuera de git):
- La biblioteca LDraw (`ldraw/`). La descarga está explicada en `estudio/README.md`.
- La [shadow library de LDCad](https://github.com/RolandMelkert/LDCadShadowLibrary) (`LDCadShadowLibrary-main/`, CC BY-SA 4.0):
  ```sh
  curl -L -o ../.cache/shadow.zip https://github.com/RolandMelkert/LDCadShadowLibrary/archive/refs/heads/main.zip
  (cd ../.cache && unzip -q shadow.zip)
  ```
- Opcional: `rebrickable/inventory_parts.csv.gz` ([descargas de Rebrickable](https://rebrickable.com/downloads/)), para avisar cuando una combinación pieza + color nunca salió en un set.

## Modelo de armado

- **Sub-armados.** Cada submodelo es un sub-armado que se construye aparte, en su propio sistema de coordenadas, y se coloca entero en el paso del modelo padre que lo referencia.
- **Abajo.** Es +Y, la convención de LDraw. Un `ROTSTEP` que cambia qué es "abajo" se toma como que el constructor da vuelta el modelo.
- **Conexiones.** Salen de la shadow library, heredadas a través de las subpiezas y primitivas de cada pieza:
  - Cilindros macho/hembra (studs, anti-studs, ejes, pines y agujeros), con compatibilidad por sección y radio.
  - Clips con barras.
  - Dedos de bisagra, que se interpretan siempre centrados.
  - Conectores genéricos, cada uno con su zona de encastre.
- **Conexiones inferidas.** La shadow library tiene huecos (por ejemplo, el anti-stud de algunas cúpulas o el alojamiento de rótulas). Si la punta de un conector macho, o la bola de una rótula, queda dentro del volumen de otra pieza, se infiere que está encastrado.
- **Piezas sin datos de conexión.** Se suponen unidas a lo que tocan y se listan en el resumen.
- **Elementos flexibles.** Cordones y mangueras de LDCad (`!LDCAD CONTENT [type=path]`) cuentan como una sola pieza y no se chequean por colisión.
- **Camino de inserción.** Cada pieza (o sub-armado) nueva prueba las direcciones de sus encastres con lo ya colocado:
  - Una hembra llega desde el lado de su abertura; un macho, desde el lado opuesto; en un agujero pasante, desde los dos lados.
  - Tiene que poder recorrer en línea recta lo que penetra el encastre (4 LDU un stud, hasta 20 un pin) más 8 LDU de margen, sin atravesar lo colocado en pasos anteriores.
  - No cuentan como obstáculo: los socios que se sueltan en esa misma dirección, las piezas unidas por clip, bisagra o rótula, lo que ya se solapaba en la posición final (reportado como colisión o roce), los elementos flexibles y la goma (neumáticos, bandas).
  - Si la pieza solo tiene encastres sin eje (clips, bisagras), se prueba desde arriba, y un bloqueo es solo un aviso.

## Reglas

| Regla | Severidad | Qué detecta |
|---|---|---|
| `pieza-inexistente`, `color-inexistente` | error | Pieza o color que no existe en LDraw |
| `pieza-no-oficial`, `pieza-renombrada`, `combinacion-no-vista` | aviso | Pieza embebida o no oficial; alias o renombrada; pieza + color que no figura en ningún inventario de Rebrickable |
| `colision` | error | Dos piezas no conectadas se atraviesan ≥ 2,5 LDU (1 mm) |
| `superpuestas` | error | Dos piezas comparten volumen sin que sus triángulos se crucen (duplicadas, encimadas en la misma capa): caras coplanares mirando al mismo lado, con un ancho medio ≥ 2,5 LDU |
| `roce`, `engranaje` | aviso | Penetración menor (imprecisión de modelado), o de engranajes, orugas o cadenas, que encastran diente contra eslabón |
| `flotante` | error | En un paso, un grupo queda sin conexión con el resto y en el aire (no toca la mesa ni descansa sobre otras piezas), y no se une nunca |
| `sostener-un-paso` | aviso | Igual que el anterior, pero el paso siguiente lo une al resto: hay que sostenerlo con la mano |
| `suelto-varios-pasos` | aviso | Se une al resto recién varios pasos después: el modelo está bien, pero conviene colocarlo en ese paso |
| `giro-con-piezas-sueltas` | error | Se da vuelta el modelo con grupos sin unir: se caen |
| `subarmado-en-varias-partes` | error | Un sub-armado termina en varios grupos: al levantarlo se desarma |
| `submodelo-de-objetos-sueltos` | aviso | Un submodelo que solo agrupa objetos apoyados en la mesa (fardos, accesorios) |
| `flota` | error | En el modelo terminado, algo sin conexión flota sobre otras piezas (> 4 LDU) o sobre la mesa (> 12 LDU) |
| `apoyado-sin-conexion`, `mal-nivelado` | aviso | Carga suelta que descansa sobre otras piezas, u objeto aparte ubicado un poco por encima de la mesa |
| `sin-camino-recto` | error | Una pieza nueva no puede llegar a su lugar en línea recta por ninguna dirección de sus encastres, y tampoco sale al desarmar el modelo terminado (ni sola, ni en un grupo chico, ni partiendo sub-armados): no hay orden de armado que la deje entrar |
| `orden-sin-camino` | aviso | La pieza no entra en el orden de los pasos (lo ya colocado la bloquea), pero al desarmar el modelo terminado sí sale: existe otro orden. Es un problema de los pasos, no del modelo |
| `requiere-subarmado` | aviso | Pieza por pieza no hay orden, pero sí preparando aparte un grupo chico (una viga con sus pines, un par unido por un pin con collar) y colocándolo entero. El mensaje dice qué piezas |
| `subarmado-no-entra` | aviso | Un sub-armado declarado no se puede colocar entero (tiene piezas a los dos lados de algo ya puesto), pero el modelo se arma colocando sus piezas por separado |
| `camino-dudoso` | aviso | Igual, pero la pieza solo tiene encastres sin eje (clips, bisagras, rótulas): se probó solo desde arriba |
| `se-vuelca` / `queda-inclinado` | error / aviso | El objeto termina apoyado a más de 25° (se vuelca) o entre 5° y 25°. Se calcula con la cara de la envolvente convexa que queda debajo del centro de masa |

**Masa.** Se estima proporcional a la superficie de cada pieza, calibrada con el ladrillo 2×4 (2,32 g).

## Calibración con los sets de test (2026-09-27)

En los sets oficiales, un hallazgo sobre el **modelo terminado** es un falso positivo del verificador, porque el set existe y se arma. El **orden de pasos**, en cambio, lo definió quien modeló el archivo del OMR, y puede estar desprolijo.

| Set | Resultado | Hallazgos restantes y clasificación |
|---|---|---|
| 40014-1 Halloween Bat | OK | — |
| 40011-1 Thanksgiving Turkey | OK | — |
| 40271-1 Bunny | OK | Dos `camino-dudoso` (aviso) |
| 40425-1 Nutcracker | OK | 3 roces de ~2 LDU: sub-armado ubicado con imprecisión |
| 8259-1 Mini Bulldozer | 1 error | Solapes de engranajes con la oruga (aviso). **Orden del archivo:** un tornillo sin fin (4716) queda entre dos conectores ya puestos en el mismo eje |
| 4955-1 Big Rig | 2 errores | **Orden del archivo:** una placa cuelga de una pieza colocada antes y para subirla desde abajo hay otra placa en el camino (se revisó con `vista.ts`) |
| 3180-1 Tank Truck | 5 errores | **Real, del archivo.** El autor pone en el paso 1 dos piezas que recién se enganchan en el paso 22. De ahí salen también 3 bloqueos de inserción debajo de esas piezas |
| 42048-1 Race Kart | 5 errores | **Real, del archivo.** Una viga se ubica en el paso 21 y el pin que la fija entra varios pasos después. Además hay 3 bloqueos de inserción: la misma viga y los sub-armados del motor y la parte trasera (sin revisar uno por uno) |
| 7636-1 Combine Harvester | 7 errores | **Sin resolver:** la tapa de la tolva (placa 4×6) no tiene studs debajo y queda entre dos paredes; puede sostenerse por presión o ser un error del archivo, hay que compararla con las instrucciones oficiales. **Orden del archivo:** la rueda del molinete tiene que deslizarse por un eje que ya tiene un conector en la punta |
| 10226-1 Sopwith Camel | 15 errores | **Sin resolver:** (a) la raíz de las alas inferiores, rotadas 4,8°, se mete ~7 LDU en el fuselaje, probable concesión del modelado; (b) una viga con dos rótulas sostenida por una banda elástica, mecanismo que el verificador no modela; (c) 4 bloqueos de inserción de las alas y los estabilizadores, en la misma zona |

La reserva **10298-1 Vespa** (1103 piezas, 55 piezas personalizadas) todavía muestra decenas de hallazgos: es la próxima ronda de calibración.

**Lectura de la calibración.** En el modelo terminado, los únicos errores que quedan son los dos casos sin resolver. Casi todos los hallazgos de pasos e inserción se explican por cómo ordenó los pasos quien hizo el archivo del OMR, que no siempre coincide con un armado real. Los que se revisaron con `vista.ts` resultaron correctos.

Cada modelo tarda entre 0,1 s y 7 s en la laptop de referencia.

**Pruebas** (en `pruebas/`):
- `murcielago-roto.mpd`: el Halloween Bat con tres errores metidos a propósito (un ladrillo levantado 40 LDU, otro encimado sobre uno existente y una pieza inexistente). Se detectan los tres: `flotante`/`flota`, `colision` de 8 LDU y `pieza-inexistente`.
- `voladizo-mal-ordenado.ldr`: un ladrillo que se coloca debajo de una placa ya puesta. Como poniendo el ladrillo antes sí se arma, se detecta con el aviso `orden-sin-camino` y sin errores.
- `trabado.ldr`: dos pares de ladrillos Technic unidos con pines con collar, con ladrillos en el medio. El par de arriba solo baja entero: aviso `requiere-subarmado`. `trabado-con-subarmado.mpd` es el mismo modelo con ese par declarado como sub-armado, y pasa sin errores.
- `voladizo-bien.ldr`: el mismo modelo en el orden correcto. Pasa sin errores.

## Qué NO verifica todavía

- **Inserción con giro o flexión.** Solo prueba trayectorias rectas y piezas rígidas. Una pieza que en la realidad entra girando o doblando algo un poco puede aparecer como `sin-camino-recto`: por ejemplo, paneles Technic sujetos con pines en caras perpendiculares.
- **Sub-armados grandes.** El desarmado prueba grupos de hasta 8 unidades; un armado que necesite preparar aparte un grupo más grande, sin declararlo, aparece como error.
- **Espacio para los dedos.** No verifica que haya lugar para la mano al empujar.
- **Fuerza de agarre.** No calcula cuánto aprieta cada unión ni si un voladizo largo se sostiene: una pieza conectada por un solo stud cuenta igual que una conectada por ocho.
- **Estabilidad paso a paso.** El vuelco se evalúa solo en el modelo terminado.
- **Encastres por presión y mecanismos.** No modela piezas que se sostienen por fricción entre paredes, bandas elásticas ni movimiento.
