# Correr el experimento 01 en la nube (claude.ai/code)

Cada corrida es una sesión de Claude Code en la nube: una máquina con 16 GB de RAM, independiente de la laptop. Los diseñadores trabajan sobre un **repo aparte**, `lego-lab-disenadores`, que tiene solo el taller, el verificador y el estudio. No tiene los documentos del experimento, el código del juez ni los sets oficiales, y viene con un solo commit, sin historia.

## 1. Repo de los diseñadores (una vez)

1. En GitHub, creá un repo **público y vacío**, sin README ni licencia, llamado `lego-lab-disenadores`.
2. Avisale a Claude: sube la instantánea que ya está preparada en `C:\Users\User\Documents\github\lego-lab-disenadores`.

## 2. Entorno en claude.ai/code (una vez)

Creá un entorno nuevo, por ejemplo **lego-lab-diseno**:

- **Repo:** `lucareynaldo/lego-lab-disenadores`.
- **Red:** acceso "Trusted", o "Custom" con lo de Trusted, **más** estos dominios:
  ```
  library.ldraw.org
  cdn.rebrickable.com
  nodejs.org
  storage.googleapis.com
  remotion.dev
  www.remotion.dev
  archive.ubuntu.com
  security.ubuntu.com
  ```
- **Setup script:** dejalo **vacío**. El script del entorno corre fuera de la carpeta del repo y no encuentra `setup.sh`; la preparación la hace el agente al empezar, como indica la consigna.
  ```sh
  (dejalo vacío)
  ```
  El script está en la raíz del repo: baja los datos, instala dependencias y Chromium, y arma el índice de piezas. Si tarda más de lo que el entorno permite, no importa: la consigna le indica al agente que lo corra él mismo si falta `.cache/ldraw`.

## 3. Corrida de prueba (antes de las 25)

1. Abrí una sesión con ese entorno, modelo **Claude Opus 5.5** y esfuerzo **low**. Si la web no tiene selector de esfuerzo, mandá primero el mensaje `/effort low`.
2. Pegá como mensaje el contenido de [`consignas/prueba-low.md`](consignas/prueba-low.md).
3. Cuando termine, avisale a Claude, que va a revisar la rama `corrida/prueba` del repo de diseñadores. Si algo del entorno falla (el render, las descargas), se ajusta antes de lanzar el resto.

## 4. Las 25 corridas

Para cada fila: una sesión nueva con el entorno lego-lab-diseno, modelo **Claude Opus 5.5**, el **esfuerzo** de la tabla (selector o `/effort <nivel>` como primer mensaje) y el contenido del archivo como consigna.

- Se pueden abrir varias a la vez. Recomendado: tandas de 5 en el orden de la tabla, que es el orden aleatorio del preregistro.
- No respondas nada en las sesiones. Si una pregunta algo, contestá solo "seguí según la consigna".

| Orden | Corrida | Esfuerzo | Consigna |
|---|---|---|---|
| 1 | r01 | max | [consignas/r01-max.md](consignas/r01-max.md) |
| 2 | r02 | low | [consignas/r02-low.md](consignas/r02-low.md) |
| 3 | r03 | xhigh | [consignas/r03-xhigh.md](consignas/r03-xhigh.md) |
| 4 | r04 | low | [consignas/r04-low.md](consignas/r04-low.md) |
| 5 | r05 | high | [consignas/r05-high.md](consignas/r05-high.md) |
| 6 | r06 | low | [consignas/r06-low.md](consignas/r06-low.md) |
| 7 | r07 | xhigh | [consignas/r07-xhigh.md](consignas/r07-xhigh.md) |
| 8 | r08 | xhigh | [consignas/r08-xhigh.md](consignas/r08-xhigh.md) |
| 9 | r09 | max | [consignas/r09-max.md](consignas/r09-max.md) |
| 10 | r10 | xhigh | [consignas/r10-xhigh.md](consignas/r10-xhigh.md) |
| 11 | r11 | max | [consignas/r11-max.md](consignas/r11-max.md) |
| 12 | r12 | max | [consignas/r12-max.md](consignas/r12-max.md) |
| 13 | r13 | medium | [consignas/r13-medium.md](consignas/r13-medium.md) |
| 14 | r14 | high | [consignas/r14-high.md](consignas/r14-high.md) |
| 15 | r15 | medium | [consignas/r15-medium.md](consignas/r15-medium.md) |
| 16 | r16 | low | [consignas/r16-low.md](consignas/r16-low.md) |
| 17 | r17 | high | [consignas/r17-high.md](consignas/r17-high.md) |
| 18 | r18 | low | [consignas/r18-low.md](consignas/r18-low.md) |
| 19 | r19 | high | [consignas/r19-high.md](consignas/r19-high.md) |
| 20 | r20 | max | [consignas/r20-max.md](consignas/r20-max.md) |
| 21 | r21 | high | [consignas/r21-high.md](consignas/r21-high.md) |
| 22 | r22 | medium | [consignas/r22-medium.md](consignas/r22-medium.md) |
| 23 | r23 | medium | [consignas/r23-medium.md](consignas/r23-medium.md) |
| 24 | r24 | xhigh | [consignas/r24-xhigh.md](consignas/r24-xhigh.md) |
| 25 | r25 | medium | [consignas/r25-medium.md](consignas/r25-medium.md) |

## 5. Después

Claude baja las ramas `corrida/rNN`, copia cada entrega a `.cache/experimentos/01/corridas/rNN/`, corre la auditoría del modelo (validez, piezas prohibidas, métricas), la prueba de selección del juez y el juicio a ciegas, y arma la página para el juez humano.

**Qué se pierde respecto del plan:** los transcripts quedan en la nube. Por eso no hay medición automática de tokens, costo ni uso de herramientas por corrida (hipótesis H3 y H4), ni auditoría de lecturas. Si la web muestra el uso de cada sesión, anotalo a mano en la tabla y se incorpora al análisis.
