#!/usr/bin/env bash
# Preparación del entorno para las corridas de diseño.
# Baja los datos públicos (LDraw, shadow library de LDCad, CSV de Rebrickable), instala dependencias y
# Chromium, y arma el índice del catálogo. Es idempotente y tolerante: un paso que falla se informa y se
# sigue con el resto; al final dice qué falta. Uso: bash setup.sh
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
faltan=()
paso() { echo; echo "== $*"; }

paso "Node (hace falta >= 23.6 para ejecutar .ts sin compilar)"
node_ok() { node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>23||(a===23&&b>=6)?0:1)' 2>/dev/null; }
if ! node_ok; then
	SUDO=$(command -v sudo || true)
	{ $SUDO npm install -g n --no-audit --no-fund && $SUDO n 24 && hash -r; } >/dev/null 2>&1 || true
	if ! node_ok && [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" && nvm install 24 >/dev/null 2>&1 && nvm use 24 >/dev/null; fi
fi
node -v
node_ok || { echo "AVISO: Node < 23.6"; faltan+=("node>=23.6"); }

paso "Bibliotecas de sistema para Chromium"
if command -v apt-get >/dev/null; then
	SUDO=$(command -v sudo || true)
	$SUDO apt-get update -qq >/dev/null 2>&1
	$SUDO apt-get install -y -qq libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libxkbcommon0 \
		libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64 >/dev/null 2>&1 \
		|| echo "AVISO: no se pudieron instalar todas las bibliotecas (el render puede fallar)"
fi

paso "Datos (.cache)"
mkdir -p .cache/rebrickable
(
	cd .cache
	[ -d ldraw ] || { curl -fsSL -o complete.zip https://library.ldraw.org/library/updates/complete.zip && unzip -q complete.zip && rm -f complete.zip; } || echo "AVISO: falló la biblioteca LDraw"
	[ -d LDCadShadowLibrary-main ] || { curl -fsSL -o shadow.zip https://github.com/RolandMelkert/LDCadShadowLibrary/archive/refs/heads/main.zip && unzip -q shadow.zip && rm -f shadow.zip; } || echo "AVISO: falló la shadow library"
	for f in colors parts elements inventories inventory_parts sets; do
		[ -f "rebrickable/$f.csv.gz" ] || curl -fsSL -o "rebrickable/$f.csv.gz" "https://cdn.rebrickable.com/media/downloads/$f.csv.gz" || echo "AVISO: falló rebrickable/$f"
	done
)
[ -d .cache/ldraw/parts ] || faltan+=("biblioteca LDraw")
[ -d .cache/LDCadShadowLibrary-main ] || faltan+=("shadow library")
[ -f .cache/rebrickable/inventory_parts.csv.gz ] || faltan+=("CSV de Rebrickable")

paso "Dependencias npm"
for d in verificador taller estudio; do
	(cd "$d" && npm ci --no-audit --no-fund >/dev/null 2>&1) || { echo "AVISO: npm ci falló en $d"; faltan+=("npm $d"); }
done

paso "Chromium para el render"
(cd estudio && npx --yes remotion browser ensure >/dev/null 2>&1) || { echo "AVISO: no se pudo instalar Chromium"; faltan+=("chromium"); }

paso "Índice del catálogo"
(cd taller && node --no-warnings src/cli.ts piezas buscar "brick 2 x 4" --max 1 >/dev/null 2>&1) || { echo "AVISO: el catálogo no se pudo armar"; faltan+=("catálogo"); }

paso "Prueba de render"
(cd taller && node --no-warnings src/cli.ts render pruebas/fixtures/modelo-prueba.mpd --salida /tmp/prueba-render --vistas 34 --lado 128 >/dev/null 2>&1) \
	&& echo "render OK" || { echo "AVISO: el render de prueba falló"; faltan+=("render"); }

echo
if [ ${#faltan[@]} -eq 0 ]; then echo "entorno listo"; else echo "entorno incompleto, falta: ${faltan[*]}"; fi
exit 0
