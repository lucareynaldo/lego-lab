# Sets de test (uso interno)

Modelos LDraw de sets oficiales, tomados del [OMR de LDraw](https://library.ldraw.org/omr/sets). Son la **verdad de referencia** del prototipo: sabemos que se pueden armar, así que cada herramienta (verificador, animación, manual, lista de piezas) tiene que dar resultados correctos sobre ellos.

**Nunca se publican.** LEGO tiene el copyright del diseño de sus sets y de sus instrucciones. La licencia CC BY de estos archivos cubre solo el trabajo de quien los modeló.

## Selección (2026-09-27)

El OMR tiene **1.470 sets** y 1.307 son de temas sin licencia de terceros. El catálogo completo está en [`../omr-catalogo.csv`](../omr-catalogo.csv).

**Criterio clave: que el archivo traiga pasos (`0 STEP`).** No todos los traen. De 27 candidatos revisados, 7 tenían 0 pasos (por ejemplo Eiffel Tower, Sydney Opera House, Adventure Vehicles) y dos tenían muy pocos: Metroliner, 7 pasos para 787 piezas, y Burj Khalifa, 10 pasos para 208.

Los **10 de base** cubren tamaños de 25 a 879 piezas y distintas técnicas:

| Set | Modelo | Piezas | Pasos | Qué pone a prueba |
|---|---|---|---|---|
| 40014-1 | Halloween Bat | 25 | 6 | Prueba de humo: el caso más simple |
| 40011-1 | Thanksgiving Turkey | 53 | 14 | Figura chica |
| 40271-1 | Bunny (BrickHeadz) | 126 | 39 | Personaje con piezas montadas de costado (SNOT) |
| 40425-1 | Nutcracker (BrickHeadz) | 180 | 71 | Figura alta: centro de masa, estabilidad |
| 8259-1 | Mini Bulldozer (Technic) | 165 | 43 | Pines y ejes |
| 3180-1 | Tank Truck | 222 | 55 | Vehículo City clásico |
| 7636-1 | Combine Harvester | 365 | 107 | Bisagras y piezas móviles |
| 42048-1 | Race Kart (Technic) | 345 | 55 | Technic mediano, con piezas embebidas |
| 4955-1 | Big Rig | 550 | 138 | Muchos sub-armados (33 submodelos) |
| 10226-1 | Sopwith Camel | 879 | 177 | Curvas y avión grande; escala |

Hay **2 de reserva** para pruebas de estrés:

| Set | Modelo | Piezas | Pasos | Por qué |
|---|---|---|---|---|
| 10298-1 | Vespa 125 | 1107 | 208 | SNOT complejo; 55 piezas personalizadas embebidas |
| 10270-1 | Bookshop | 2504 | 99 | Escala: rendimiento de render en la laptop |

Los datos por archivo (autor, licencia, submodelos, fuente) están en [`manifiesto.csv`](manifiesto.csv).

## Advertencias

- **Los pasos del OMR no siguen necesariamente el manual oficial.** Los define quien modeló el archivo, así que sirven para probar que *un* orden válido existe, no para copiar el oficial.
- **La cantidad de piezas del archivo puede diferir de la de Rebrickable** por piezas de repuesto, piezas embebidas (`0 FILE x.dat`) o partes flexibles.
- Si el verificador marca un error en un set oficial, lo primero es sospechar del verificador o del archivo, no del set.
