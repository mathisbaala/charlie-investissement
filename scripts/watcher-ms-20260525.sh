#!/bin/bash
# watcher-ms-20260525.sh — Cascade post-Morningstar (PID 40439)
# Lance fix-ter-residual → recalc-completeness-v2 per-type → recalc-average-perf
# NE PAS inclure fix-ms-annualized-perf.py (cascade bug confirmé)

set -e
cd "$(dirname "$0")/.."
mkdir -p logs

MS_PID=40439
LOG="logs/watcher-ms-20260525.log"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

log "Monitoring morningstar-lt-enricher (PID $MS_PID)..."
while kill -0 $MS_PID 2>/dev/null; do
    sleep 60
done
log "Morningstar terminé."

log "fix-ter-residual (TER fraction → %)..."
python3 scripts/db-fixes/fix-ter-residual.py --apply >> logs/fix-ter-residual-20260525.log 2>&1 && log "fix-ter-residual OK" || log "fix-ter-residual ERREUR"

log "derive-srri-from-volatility..."
python3 scripts/migrations/derive-srri-from-volatility.py --apply >> logs/derive-srri-20260525.log 2>&1 && log "derive-srri OK" || log "derive-srri ERREUR"

log "recalc-completeness-v2 per-type (tous types)..."
python3 scripts/migrations/recalc-completeness-v2.py --per-type --apply >> logs/recalc-completeness-20260525.log 2>&1 && log "recalc-completeness OK" || log "recalc-completeness ERREUR"

log "recalc-average-perf..."
python3 scripts/migrations/recalc-average-perf.py --apply >> logs/recalc-avg-perf-20260525.log 2>&1 && log "recalc-average-perf OK" || log "recalc-average-perf ERREUR"

log "Pipeline post-Morningstar TERMINÉ."
