#!/usr/bin/env bash
# enrich-db-improvements.sh — Pipeline améliorations DB post-frontend
#
# PRÉREQUIS : appliquer les migrations SQL d'abord via Supabase Dashboard :
#   supabase/migrations/20260529000003_add_eligibility_columns.sql
#   supabase/migrations/20260529000004_add_fees_columns.sql
#   supabase/migrations/20260529000005_create_breakdown_tables.sql
#
# Phases :
#   1. Normalisation gestionnaires OPCVM
#   2. Enrichissement éligibilités (av_fr, pea_pme, cto)
#   3. Backfill frais KID (entry/exit/perf fee + durée détention)
#   3b. Rétrocession CGP (commission de distribution depuis KIDs)
#   4. Holdings / allocation sectorielle + géographique (Morningstar)
#   5. Recalcul complétude (formule différenciée par product_type)

set -uo pipefail

SCRIPTS="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="/tmp/charlie-db-improvements"
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

log "========================================================"
log "Pipeline améliorations DB — post-frontend"
log "========================================================"

# ── Phase 1 : Normalisation gestionnaires ─────────────────────────────────────
log "Phase 1 : Normalisation gestionnaires OPCVM"
run_script "normalize-mgmt" migrations/normalize-management-company.py

# ── Phase 2 : Éligibilités enveloppes ─────────────────────────────────────────
log "Phase 2 : Enrichissement éligibilités (av_fr, pea_pme, cto)"
run_script "enrich-eligibility" migrations/enrich-eligibility.py

# ── Phase 3 : Frais KID (parallèle GECO + reste) ──────────────────────────────
log "Phase 3 : Backfill frais KID (GECO — URLs AMF fiables)"
run_script "backfill-fees-geco" migrations/backfill-kid-fees.py --only-geco

log "Phase 3b : Backfill frais KID (autres URLs)"
run_script "backfill-fees-all" migrations/backfill-kid-fees.py

# ── Phase 3c : Rétrocession CGP ───────────────────────────────────────────────
log "Phase 3c : Rétrocession CGP (GECO — URLs AMF fiables)"
run_script "retrocession-cgp-geco" migrations/populate-retrocession-cgp.py --only-geco

log "Phase 3d : Rétrocession CGP (autres URLs)"
run_script "retrocession-cgp-all" migrations/populate-retrocession-cgp.py

# ── Phase 4 : Holdings / Allocation (Morningstar) ─────────────────────────────
log "Phase 4 : Holdings + allocation sectorielle/géographique (Morningstar)"
run_script "holdings-morningstar" scrapers/populate-holdings-morningstar.py --limit 500

# ── Phase 5 : Recalcul complétude ────────────────────────────────────────────
log "Phase 5 : Recalcul data_completeness"
run_script "recalc-completeness" migrations/recalc-completeness-v2.py --per-type

log "========================================================"
log "Pipeline terminé — vérifie /api/health"
log "========================================================"
