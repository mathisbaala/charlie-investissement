#!/usr/bin/env bash
# autopilot-nuit.sh — Pipeline autonome nocturne
# Enchaîne fetch-nav-yahoo + compute-metrics + classify + bilan en boucle.
# Vraies données seulement, jamais d'invention.

set -u
PROJECT_DIR="/Users/mathisbaala/Projects/charlie financial advisor/charlie-investissement"
cd "$PROJECT_DIR"

LOG="logs/autopilot-nuit.log"
BILANS_DIR="docs/bilans"
mkdir -p "$BILANS_DIR" logs

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"
}

run_round() {
    local round=$1
    log "═══════════════════════════════════════════════════════"
    log "  CYCLE #$round — début"
    log "═══════════════════════════════════════════════════════"

    log "[1/4] fetch-nav-yahoo limit 5000…"
    python3 -u scripts/scrapers/fetch-nav-yahoo.py --apply --limit 5000 >> "$LOG" 2>&1
    local nav_status=$?
    log "  ↳ exit=$nav_status"

    log "[2/4] compute-metrics global…"
    python3 -u scripts/enrichers/compute-metrics.py --apply >> "$LOG" 2>&1
    log "  ↳ exit=$?"

    log "[3/4] classify-from-name…"
    python3 -u scripts/enrichers/classify-from-name.py --apply >> "$LOG" 2>&1
    log "  ↳ exit=$?"

    log "[4/4] bilan…"
    local stamp=$(date +%FT%H%M)
    python3 scripts/bilan-daily.py > "$BILANS_DIR/bilan-$stamp.md" 2>>"$LOG"
    log "  ↳ bilan : $BILANS_DIR/bilan-$stamp.md"

    log "  Cycle #$round terminé."
    log ""
}

log "════════════════════════════════════════════════════"
log "  AUTOPILOT NUIT — démarre"
log "  Modes : APPLY (vraies données seulement)"
log "════════════════════════════════════════════════════"

for round in 1 2 3 4 5; do
    run_round "$round"
done

# Audit qualité final
log "[FINAL] audit-data-quality-extended…"
python3 -u scripts/migrations/audit-data-quality-extended.py --no-base > logs/audit-final-nuit.log 2>&1
log "  ↳ audit : logs/audit-final-nuit.log"

log "════════════════════════════════════════════════════"
log "  AUTOPILOT NUIT — terminé"
log "════════════════════════════════════════════════════"
