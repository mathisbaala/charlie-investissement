#!/bin/bash
# geco-chain-20260525.sh — Chaîne GECO AMF (séquentiel, même API)
# inception_date → aum_eur → performance (perf3y)

set -e
cd "$(dirname "$0")/.."
mkdir -p logs

log() { echo "[$(date '+%H:%M:%S')] $*"; }

log "=== GECO Chain démarré ==="

log "1/3 geco-inception-enricher..."
python3 scripts/scrapers/geco-inception-enricher.py --apply > logs/geco-inception-20260525.log 2>&1 \
    && log "geco-inception OK" || log "geco-inception ERREUR"

log "2/3 geco-aum-enricher..."
python3 scripts/scrapers/geco-aum-enricher.py --apply > logs/geco-aum-20260525.log 2>&1 \
    && log "geco-aum OK" || log "geco-aum ERREUR"

log "3/3 geco-performance-enricher..."
python3 scripts/scrapers/geco-performance-enricher.py --apply > logs/geco-perf-20260525.log 2>&1 \
    && log "geco-performance OK" || log "geco-performance ERREUR"

log "=== GECO Chain terminé ==="
