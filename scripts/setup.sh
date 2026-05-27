#!/usr/bin/env bash
# setup.sh — Installation locale du pipeline Charlie Investissement
# Usage : bash scripts/setup.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "========================================"
echo "  Charlie Investissement — Setup local"
echo "========================================"

# ── Vérifier Python 3.10+ ────────────────────────────────────────────────────
PY=$(python3 --version 2>&1 | grep -oE "[0-9]+\.[0-9]+")
PY_MAJOR=$(echo "$PY" | cut -d. -f1)
PY_MINOR=$(echo "$PY" | cut -d. -f2)
if [ "$PY_MAJOR" -lt 3 ] || { [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 10 ]; }; then
  echo "ERREUR : Python 3.10+ requis (trouvé: $PY)"
  exit 1
fi
echo "[1/4] Python $PY détecté ✓"

# ── Venv ──────────────────────────────────────────────────────────────────────
VENV="$PROJECT_DIR/.venv"
if [ ! -d "$VENV" ]; then
  python3 -m venv "$VENV"
  echo "[2/4] Virtualenv créé dans .venv ✓"
else
  echo "[2/4] Virtualenv existant ✓"
fi

# ── Dépendances ───────────────────────────────────────────────────────────────
echo "[3/4] Installation des packages..."
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet \
  supabase \
  pdfplumber \
  requests \
  anthropic \
  python-dotenv \
  yfinance \
  pandas \
  numpy

echo "  → Packages installés ✓"

# ── .env ─────────────────────────────────────────────────────────────────────
echo "[4/4] Configuration..."
if [ ! -f "$SCRIPT_DIR/.env" ]; then
  cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
  echo "  → .env créé depuis .env.example"
  echo "  ⚠️  Éditez scripts/.env et renseignez SUPABASE_SERVICE_ROLE_KEY"
else
  echo "  → .env existant conservé ✓"
fi

echo ""
echo "========================================"
echo "  ✓ Setup terminé !"
echo "========================================"
echo ""
echo "Commandes pour démarrer :"
echo "  source .venv/bin/activate"
echo "  # Dry-run AMF GECO (test 200 fonds) :"
echo "  python3 scripts/scrapers/amf-geco-full.py --limit 200"
echo "  # Dry-run JustETF :"
echo "  python3 scripts/scrapers/justetf-scraper.py --limit 50"
echo "  # Appliquer (écriture Supabase) :"
echo "  python3 scripts/scrapers/amf-geco-full.py --apply"
echo ""
