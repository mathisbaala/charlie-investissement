#!/usr/bin/env bash
# enrich-opcvm-pipeline.sh — Pipeline d'enrichissement OPCVM
# Objectif : passer le maximum d'OPCVM au-dessus du seuil de complétude 60%
#
# Phase 1 (parallèle) : TER bulk Morningstar EMEA + Perf 3Y GECO
# Phase 2 (séquentiel GECO) : refresh kid_url + parse KIDs FR
# Phase 3 : TER fallback FundInfo/Boursorama
# Phase 4 : Recalcul complétude

set -uo pipefail

SCRIPTS="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="/tmp/charlie-enrich"
mkdir -p "$LOG_DIR"

ts()  { date '+%H:%M:%S'; }
log() { echo "[$(ts)] $*" | tee -a "$LOG_DIR/pipeline.log"; }

run_script() {
  local name="$1"
  local script="$2"
  shift 2
  local logfile="$LOG_DIR/${name}.log"
  log "▶  $name — début"
  if python3 "$SCRIPTS/$script" --apply "$@" > "$logfile" 2>&1; then
    log "✓  $name — OK (voir $logfile)"
  else
    log "⚠  $name — erreur code $? (voir $logfile)"
  fi
}

log "========================================"
log "Pipeline enrichissement OPCVM"
log "========================================"

# ── Phase 1 : TER Morningstar EMEA + Perf GECO (parallèle) ──────────────────
log "Phase 1 : TER Morningstar EMEA + Perf GECO (parallèle)"

run_script "ms-emea-ter-aum" scrapers/ms-emea-ter-aum-enricher.py &
PID_MS=$!

run_script "geco-perf" scrapers/geco-performance-enricher.py &
PID_GECO_PERF=$!

wait $PID_MS
wait $PID_GECO_PERF
log "Phase 1 terminée"

# ── Phase 2 : Refresh kid_url GECO → parse KIDs FR ──────────────────────────
log "Phase 2 : Refresh kid_url GECO (OPCVM FR agréés AMF)"
run_script "geco-kid-finder" scrapers/geco-kid-finder.py

log "Phase 2b : Parse KIDs depuis GECO (URLs fraîches, min-aum 0)"
run_script "kid-bulk-parser-geco" scrapers/kid-bulk-parser.py \
  --geco-only --min-aum 0 --force

# ── Phase 3 : TER fallback FundInfo / Boursorama ────────────────────────────
log "Phase 3 : TER FundInfo / Boursorama (LU/IE restants)"
run_script "fetch-ter-fundinfo" scrapers/fetch-ter-fundinfo.py

# ── Phase 4 : Recalcul complétude ───────────────────────────────────────────
log "Phase 4 : Recalcul complétude"
run_script "recalc-completeness" migrations/recalc-completeness-v2.py

log "========================================"
log "Pipeline terminé — vérifie /api/health"
log "========================================"
