# lego-lab

Videos cortos (TikTok / Reels / Shorts) de armados animados de **modelos originales** hechos con ladrillos LEGO: diseño → validación → animación paso a paso por código → manual de instrucciones → lista de piezas para quien quiera armarlo.

## Principios

- **Prototipo a costo $0.** Solo herramientas y datos abiertos o gratuitos. No se compran piezas y no hay armado físico.
- **Se publican solo creaciones originales.** Los sets oficiales se usan **únicamente de forma interna**, como banco de pruebas ([`referencias/sets-test/`](referencias/sets-test/)).
- **Calidad antes que volumen.** Cada video tiene su propia idea; no se hace el mismo armado con otro modelo.
- **Marca:** "LEGO" solo como adjetivo ("ladrillos LEGO"), nunca en el nombre de una cuenta, un dominio o un producto, y sin logo. En todo lo público va este aviso: *LEGO® es una marca registrada del Grupo LEGO, que no patrocina, autoriza ni respalda este proyecto.*

## Estructura

| Carpeta | Para qué es |
|---|---|
| [`investigaciones/`](investigaciones/) | Investigación con fuentes y evidencia graduada |
| [`diseno/`](diseno/) | Cómo se diseñan los modelos: proceso, spec del taller y experimentos |
| [`taller/`](taller/) | Herramientas de diseño: catálogo, encastre por conector, render de vistas, métricas |
| [`referencias/`](referencias/) | Datos de terceros: catálogo del OMR de LDraw y los modelos de sets oficiales para test (uso interno) |
| [`estudio/`](estudio/) | Motor de video: Remotion + three.js `LDrawLoader`; empaquetador de modelos |
| [`verificador/`](verificador/) | Verifica que un modelo se pueda armar: piezas reales, conexiones, pasos, inserción, colisiones y estabilidad |
| [`manual/`](manual/) | Genera el manual de instrucciones en PDF (estilo LEGO) a partir del modelo |

## Pipeline previsto

```
diseño (diseno/proceso.md) con el taller → diseno.ts
  └─ taller construir → modelo .mpd
modelo .mpd (LDraw, con 0 STEP)
  ├─ validar: piezas reales, conexiones, colisiones, orden de pasos con gravedad, centro de masa
  ├─ video: Remotion + three.js LDrawLoader (1080×1920)
  ├─ manual: imagen por paso + HTML → PDF
  └─ piezas: lista + wanted list + sugerencia de sets (CSV de Rebrickable)
```

Ver [`investigaciones/01-viabilidad.md`](investigaciones/01-viabilidad.md) §5.

## Créditos de datos

- Geometría de piezas: [biblioteca LDraw](https://library.ldraw.org/), CC BY 4.0 / 2.0.
- Modelos de sets oficiales: [LDraw Official Model Repository](https://library.ldraw.org/omr/sets). CC BY; los autores figuran en cada archivo y en el manifiesto.
- Catálogo de sets e inventarios: [Rebrickable](https://rebrickable.com/downloads/).
