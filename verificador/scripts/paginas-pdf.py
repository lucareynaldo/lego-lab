# Renderiza páginas de un PDF de instrucciones como PNG, para leerlas.
# Uso: python scripts/paginas-pdf.py <archivo.pdf> <desde> <hasta> [ancho=1000]
# Salida: <carpeta del pdf>/<nombre>/p<NNN>.png (páginas numeradas desde 1, como en el visor)
import sys
from pathlib import Path

import pymupdf

pdf, desde, hasta = Path(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
ancho = int(sys.argv[4]) if len(sys.argv) > 4 else 1000
doc = pymupdf.open(pdf)
salida = pdf.parent / pdf.stem
salida.mkdir(exist_ok=True)
for n in range(max(1, desde), min(hasta, doc.page_count) + 1):
    pagina = doc[n - 1]
    escala = ancho / pagina.rect.width
    pagina.get_pixmap(matrix=pymupdf.Matrix(escala, escala)).save(salida / f"p{n:03d}.png")
print(f"{doc.page_count} páginas en total; renderizadas {desde}-{min(hasta, doc.page_count)} en {salida}")
