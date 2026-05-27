#!/bin/bash
# monitor-and-trigger.sh — Monitore les PIDs en cours et déclenche les pipelines suivants
# Usage: bash scripts/monitor-and-trigger.sh <trigger_name>

set -e
cd "$(dirname "$0")/.."
LOG_DIR="logs"
mkdir -p "$LOG_DIR"

trigger_name="${1:-}"

yahoo_pid=3196
ter_pid=31044
justetf_pid=10847
quantalys_pid=37154

log() { echo "[$(date '+%H:%M:%S')] [monitor] $1"; }

# ─── Pipeline post-Yahoo ──────────────────────────────────────────────────────
trigger_post_yahoo() {
    log "Yahoo Finance terminé (PID $yahoo_pid). Lancement pipeline post-Yahoo..."

    log "→ compute-metrics (VL → performances, volatilité, Sharpe)"
    python3 -u scripts/enrichers/compute-metrics.py --apply \
        > "$LOG_DIR/compute-metrics-$(date +%Y%m%d-%H%M).log" 2>&1 \
        && log "✓ compute-metrics OK" || log "✗ compute-metrics ERREUR"

    log "→ recalc-average-perf"
    python3 scripts/migrations/recalc-average-perf.py --apply \
        > "$LOG_DIR/recalc-avg-post-yahoo-$(date +%Y%m%d-%H%M).log" 2>&1 \
        && log "✓ recalc-avg-perf OK" || log "✗ recalc-avg-perf ERREUR"

    log "→ fix-ms-annualized-perf"
    python3 scripts/migrations/fix-ms-annualized-perf.py --apply \
        > "$LOG_DIR/fix-ms-annualized-post-yahoo-$(date +%Y%m%d-%H%M).log" 2>&1 \
        && log "✓ fix-ms-annualized OK" || log "✗ fix-ms-annualized ERREUR"

    log "→ derive-srri-from-volatility"
    python3 scripts/migrations/derive-srri-from-volatility.py --apply \
        > "$LOG_DIR/derive-srri-post-yahoo-$(date +%Y%m%d-%H%M).log" 2>&1 \
        && log "✓ derive-srri OK" || log "✗ derive-srri ERREUR"

    log "→ yahoo-finance-aum"
    python3 scripts/scrapers/yahoo-finance-aum.py --apply \
        > "$LOG_DIR/yahoo-aum-post-fetch-$(date +%Y%m%d-%H%M).log" 2>&1 \
        && log "✓ yahoo-finance-aum OK" || log "✗ yahoo-finance-aum ERREUR"

    log "→ yahoo-finance-ter-fill"
    python3 scripts/scrapers/yahoo-finance-ter-fill.py --apply \
        > "$LOG_DIR/yahoo-ter-post-fetch-$(date +%Y%m%d-%H%M).log" 2>&1 \
        && log "✓ yahoo-finance-ter-fill OK" || log "✗ yahoo-finance-ter-fill ERREUR"

    log "→ etf-openfigi"
    python3 scripts/scrapers/etf-openfigi.py --apply \
        > "$LOG_DIR/etf-openfigi-post-yahoo-$(date +%Y%m%d-%H%M).log" 2>&1 \
        && log "✓ etf-openfigi OK" || log "✗ etf-openfigi ERREUR"

    log "→ recalc-track-record"
    python3 scripts/migrations/recalc-track-record.py --apply \
        > "$LOG_DIR/recalc-track-post-yahoo-$(date +%Y%m%d-%H%M).log" 2>&1 \
        && log "✓ recalc-track OK" || log "✗ recalc-track ERREUR"

    log "→ recalc-completeness-v2 (--per-type --apply)"
    python3 scripts/migrations/recalc-completeness-v2.py --per-type --apply \
        > "$LOG_DIR/recalc-completeness-post-yahoo-$(date +%Y%m%d-%H%M).log" 2>&1 \
        && log "✓ recalc-completeness OK" || log "✗ recalc-completeness ERREUR"

    log "Pipeline post-Yahoo terminé."
}

# ─── Pipeline post-TER/Boursorama ────────────────────────────────────────────
trigger_post_ter() {
    log "fetch-ter-fundinfo terminé (PID $ter_pid). Lancement boursorama-cffi-enricher..."

    python3 scripts/scrapers/boursorama-cffi-enricher.py --apply \
        > "$LOG_DIR/boursorama-cffi-post-ter-$(date +%Y%m%d-%H%M).log" 2>&1 \
        && log "✓ boursorama-cffi OK" || log "✗ boursorama-cffi ERREUR"

    log "→ geco-perf3y-top-up (après cffi, fonds avec perf_1y nouveaux)"
    # Attendre que geco-perf3y-top-up actuel finisse si encore en cours
    if kill -0 50641 2>/dev/null; then
        log "geco-perf3y-top-up encore en cours, attente..."
        while kill -0 50641 2>/dev/null; do sleep 30; done
        log "geco-perf3y-top-up terminé."
    fi
    python3 scripts/scrapers/geco-perf3y-top-up.py --apply \
        > "$LOG_DIR/geco-perf3y-post-cffi-$(date +%Y%m%d-%H%M).log" 2>&1 \
        && log "✓ geco-perf3y-top-up OK" || log "✗ geco-perf3y-top-up ERREUR"

    log "→ recalc-completeness-v2"
    python3 scripts/migrations/recalc-completeness-v2.py --per-type --apply \
        > "$LOG_DIR/recalc-completeness-post-ter-$(date +%Y%m%d-%H%M).log" 2>&1 \
        && log "✓ recalc-completeness OK" || log "✗ recalc-completeness ERREUR"

    log "Pipeline post-TER terminé."
}

# ─── Pipeline post-JustETF ────────────────────────────────────────────────────
trigger_post_justetf() {
    log "justetf-fields-enricher terminé (PID $justetf_pid). Lancement justetf-aum-fill + perf-fill..."

    python3 scripts/scrapers/justetf-aum-fill.py --apply \
        > "$LOG_DIR/justetf-aum-post-fields-$(date +%Y%m%d-%H%M).log" 2>&1 \
        && log "✓ justetf-aum-fill OK" || log "✗ justetf-aum-fill ERREUR"

    python3 scripts/scrapers/justetf-perf-fill.py --apply \
        > "$LOG_DIR/justetf-perf-post-fields-$(date +%Y%m%d-%H%M).log" 2>&1 \
        && log "✓ justetf-perf-fill OK" || log "✗ justetf-perf-fill ERREUR"

    log "Pipeline post-JustETF terminé."
}

# ─── Pipeline post-Quantalys sitemap ─────────────────────────────────────────
trigger_post_quantalys() {
    log "quantalys-sitemap-scanner terminé (PID $quantalys_pid). Re-run quantalys-enricher..."

    python3 scripts/scrapers/quantalys-enricher.py --apply \
        > "$LOG_DIR/quantalys-enricher-post-sitemap-$(date +%Y%m%d-%H%M).log" 2>&1 \
        && log "✓ quantalys-enricher OK" || log "✗ quantalys-enricher ERREUR"

    log "Pipeline post-Quantalys terminé."
}

# ─── Sélecteur ────────────────────────────────────────────────────────────────
case "$trigger_name" in
    yahoo)
        log "Monitoring Yahoo Finance PID $yahoo_pid..."
        until ! kill -0 $yahoo_pid 2>/dev/null; do sleep 60; done
        trigger_post_yahoo
        ;;
    ter)
        log "Monitoring fetch-ter-fundinfo PID $ter_pid..."
        until ! kill -0 $ter_pid 2>/dev/null; do sleep 60; done
        trigger_post_ter
        ;;
    justetf)
        log "Monitoring justetf-fields-enricher PID $justetf_pid..."
        until ! kill -0 $justetf_pid 2>/dev/null; do sleep 60; done
        trigger_post_justetf
        ;;
    quantalys)
        log "Monitoring quantalys-sitemap-scanner PID $quantalys_pid..."
        until ! kill -0 $quantalys_pid 2>/dev/null; do sleep 60; done
        trigger_post_quantalys
        ;;
    *)
        echo "Usage: $0 <yahoo|ter|justetf|quantalys>"
        exit 1
        ;;
esac

# ─── Pipeline post-Morningstar ────────────────────────────────────────────────
trigger_post_morningstar() {
    local ms_pid=27294
    log "morningstar-lt-enricher terminé (PID $ms_pid). Lancement pipeline post-Morningstar..."

    log "→ morningstar-ter-fill (TER depuis Morningstar pour fonds avec MS ID)"
    python3 scripts/scrapers/morningstar-ter-fill.py --apply \
        > "$LOG_DIR/morningstar-ter-post-lt-$(date +%Y%m%d-%H%M).log" 2>&1 \
        && log "✓ morningstar-ter-fill OK" || log "✗ morningstar-ter-fill ERREUR"

    log "→ backfill-inception-date (dates création depuis Morningstar)"
    python3 scripts/migrations/backfill-inception-date.py --apply \
        > "$LOG_DIR/backfill-inception-post-ms-$(date +%Y%m%d-%H%M).log" 2>&1 \
        && log "✓ backfill-inception-date OK" || log "✗ backfill-inception-date ERREUR"

    log "→ recalc-average-perf (post-Morningstar)"
    python3 scripts/migrations/recalc-average-perf.py --apply \
        > "$LOG_DIR/recalc-avg-post-ms-$(date +%Y%m%d-%H%M).log" 2>&1 \
        && log "✓ recalc-avg-perf OK" || log "✗ recalc-avg-perf ERREUR"

    log "→ derive-srri-from-volatility"
    python3 scripts/migrations/derive-srri-from-volatility.py --apply \
        > "$LOG_DIR/derive-srri-post-ms-$(date +%Y%m%d-%H%M).log" 2>&1 \
        && log "✓ derive-srri OK" || log "✗ derive-srri ERREUR"

    log "→ recalc-completeness-v2 (--per-type)"
    python3 scripts/migrations/recalc-completeness-v2.py --per-type --apply \
        > "$LOG_DIR/recalc-completeness-post-ms-$(date +%Y%m%d-%H%M).log" 2>&1 \
        && log "✓ recalc-completeness OK" || log "✗ recalc-completeness ERREUR"

    log "Pipeline post-Morningstar terminé."
}
