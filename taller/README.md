# taller

Herramientas para que un agente (o una persona) diseñe modelos LDraw sin escribir coordenadas: buscar piezas, encastrarlas por conector desde un script, construir el `.mpd`, validarlo, verlo desde varias vistas y medirlo. Spec: [`diseno/spec-taller.md`](../diseno/spec-taller.md).

Node ≥ 23.6 ejecuta los `.ts` directamente. Reutiliza `verificador/` (importa sus módulos) y renderiza con `estudio/`.

## Uso

    npm install
    node --no-warnings src/cli.ts piezas buscar slope 45 --max 10
    node --no-warnings src/cli.ts piezas ver 3040
    node --no-warnings src/cli.ts construir diseno.ts --salida modelo.mpd
    node --no-warnings src/cli.ts validar modelo.mpd [--sub copa]
    node --no-warnings src/cli.ts render modelo.mpd --salida renders/ --vistas 34,frente,lado,34atras [--lado 64 --modo silueta] [--paso 3] [--sub copa]
    node --no-warnings src/cli.ts metricas modelo.mpd

`--paso` cuenta pasos globales, en el orden en que `LDrawLoader` los numera: primero los pasos de los sub-armados y después los del modelo principal.

## API del script de diseño

Está documentada al principio de [`src/dsl.ts`](src/dsl.ts). Resumen de los conectores:

- `{sobre: pieza, stud: [i, j]}`: el anti-stud propio (0,0, o el de `con`) queda sobre el stud `(i, j)` de `pieza`.
- `{debajo: pieza, antistud: [i, j]}`: el stud propio queda dentro del anti-stud `(i, j)` de `pieza`.
- `{conector: {de: pieza, n}, propio}`: encastra por índice de conector, tal como los lista `piezas ver` (sirve para pines, ejes, barras y agujeros).
- `{en: grilla(x, capas, z), rot: 'X90 Y45'}`: colocación libre; `en` en LDU y `rot` como giros por eje en grados. Se usa para clips y bisagras.
- `giro`: con `sobre` y `debajo` vale 0, 90, 180 o 270; con `conector` admite cualquier ángulo.

## Servidor de render persistente

Cada render sin servidor paga el empaquetado y el arranque de Remotion (~30 s). Con un servidor vivo baja a ~3–5 s:

    npm run servidor-render

- Puerto: variable `TALLER_RENDER_PUERTO` (7654 por defecto).
- El bundle se guarda en `../.cache/taller/bundle`, o en `TALLER_BUNDLE_DIR` si está definida.
- `render` prueba primero el servidor; si no responde, renderiza directo sin él (más lento, mismo resultado).

## Experimentos

`src/experimento/` tiene los scripts del corredor del experimento 01 (plan y tareas en [`diseno/plan-corredor.md`](../diseno/plan-corredor.md)):

- `azar.ts`: generador con semilla, mezcla e ids anónimos.
- `plan.ts`: reparte las 25 corridas entre los niveles de esfuerzo, con orden aleatorio.
- `correr.ts`: lanza cada corrida de Claude Code en su carpeta aislada.
- `transcript.ts`: resume el transcript de una corrida (costo, turnos, tokens, comandos del taller, rutas leídas).
- `auditar.ts`: valida el modelo entregado, calcula métricas y detecta contaminación y piezas prohibidas.
- `degradar.ts`: degrada modelos a propósito (quitar piezas, recolorear, tosco) para la prueba del juez.
- `imagenes.ts`: imágenes estándar para los jueces (grilla de 4 vistas y silueta a 64 px).
- `juez.ts`: prompt y llamada al juez VLM, con los dos órdenes A/B.
- `seleccion-juez.ts`: prueba de selección del juez con modelos degradados.
- `juicio.ts`: anonimiza los modelos y corre el juicio a ciegas de todos los pares.
- `pagina-humano.ts`: página HTML para que una persona juzgue los pares a ciegas.
- `bt.ts`: ajuste Bradley–Terry con empates a partir de las comparaciones.
- `analizar.ts`: tablas y gráfico de resultados (previsto en el plan; puede no estar escrito todavía).

## Pruebas

    npm test             # rápidas
    npm run test:render  # renderizan con Remotion (minutos)

## Datos

Los mismos que el verificador, en `../.cache/`: biblioteca LDraw, shadow library y CSV de Rebrickable (`inventory_parts`, `colors`). El índice del catálogo se guarda en `../.cache/taller/catalogo.json` (`piezas reindexar` lo rehace).
