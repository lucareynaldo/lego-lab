#!/usr/bin/env bash
# Preparación del entorno de nube (claude.ai/code) para las corridas de diseño de lego-lab.
# Se pega como "setup script" del entorno. Corre en la raíz del repo de diseñadores antes de cada sesión.
# Baja los datos públicos (LDraw, shadow library de LDCad, CSV de Rebrickable), instala dependencias y
# Chromium, y arma el índice del catálogo. Es idempotente: lo que ya está no se vuelve a bajar.
set -euo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Node >= 23.6: ejecuta los .ts sin compilar.
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>23||(a===23&&b>=6)?0:1)' 2>/dev/null; then
	npm install -g n --no-audit --no-fund >/dev/null
	n 24 >/dev/null
	hash -r
fi
echo "node $(node -v)"

# Bibliotecas del sistema que necesita Chromium sin pantalla (Ubuntu 24.04).
if command -v apt-get >/dev/null; then
	SUDO=$(command -v sudo || true)
	$SUDO apt-get update -qq >/dev/null 2>&1 || true
	$SUDO apt-get install -y -qq libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libxkbcommon0 \
		libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64 >/dev/null 2>&1 || true
fi

mkdir -p .cache/rebrickable
(
	cd .cache
	[ -d ldraw ] || { curl -fsSL -o complete.zip https://library.ldraw.org/library/updates/complete.zip && unzip -q complete.zip && rm complete.zip; }
	[ -d LDCadShadowLibrary-main ] || { curl -fsSL -o shadow.zip https://github.com/RolandMelkert/LDCadShadowLibrary/archive/refs/heads/main.zip && unzip -q shadow.zip && rm shadow.zip; }
	for f in colors parts elements inventories inventory_parts sets; do
		[ -f "rebrickable/$f.csv.gz" ] || curl -fsSL -o "rebrickable/$f.csv.gz" "https://cdn.rebrickable.com/media/downloads/$f.csv.gz"
	done
)

(cd verificador && npm ci --no-audit --no-fund >/dev/null)
(cd taller && npm ci --no-audit --no-fund >/dev/null)
(cd estudio && npm ci --no-audit --no-fund >/dev/null && npx --yes remotion browser ensure >/dev/null)

# Índice del catálogo de piezas (la primera vez tarda ~40 s).
(cd taller && node --no-warnings src/cli.ts piezas buscar "brick 2 x 4" --max 1 >/dev/null)
echo "entorno listo"
