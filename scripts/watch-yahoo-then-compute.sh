#!/bin/bash
# watch-yahoo-then-compute.sh — Attend la fin du scraper Yahoo Finance
# puis relance compute-metrics, recalc-average-perf et recalc-completeness

set -e
cd "$(dirname "$0")/.."

YAHOO_PID=59600
LOG_DIR="logs"

echo "$(date '+%H:%M:%S') Monitoring Yahoo Finance (PID $YAHOO_PID)..."

until ! kill -0 $YAHOO_PID 2>/dev/null; do
    sleep 60
done

echo "$(date '+%H:%M:%S') Yahoo Finance terminé. Lancement compute-metrics..."
python3 -u scripts/enrichers/compute-metrics.py --apply >> "$LOG_DIR/compute-metrics-2.log" 2>&1
echo "$(date '+%H:%M:%S') compute-metrics terminé."

echo "$(date '+%H:%M:%S') Recalcul average_performance..."
python3 scripts/migrations/recalc-average-perf.py --apply >> "$LOG_DIR/recalc-avg-perf-2.log" 2>&1

echo "$(date '+%H:%M:%S') Fix Morningstar annualisé (fonds sans price history)..."
python3 scripts/migrations/fix-ms-annualized-perf.py --apply >> "$LOG_DIR/fix-ms-annualized-3.log" 2>&1
echo "$(date '+%H:%M:%S') fix-ms-annualized terminé."

echo "$(date '+%H:%M:%S') Dérivation SRRI depuis volatilité..."
python3 scripts/migrations/derive-srri-from-volatility.py --apply >> "$LOG_DIR/derive-srri-2.log" 2>&1
echo "$(date '+%H:%M:%S') SRRI dérivés."

echo "$(date '+%H:%M:%S') Marquage kid_parsed_at (kid_url + TER/SRRI)..."
python3 scripts/migrations/set-kid-parsed-at.py --apply --all-data >> "$LOG_DIR/set-kid-parsed-at-2.log" 2>&1
echo "$(date '+%H:%M:%S') kid_parsed_at marqués."

echo "$(date '+%H:%M:%S') Recalcul track_record_years..."
python3 scripts/migrations/recalc-track-record.py --apply >> "$LOG_DIR/recalc-track-record-2.log" 2>&1

echo "$(date '+%H:%M:%S') Recalcul data_completeness (final)..."
python3 scripts/migrations/recalc-completeness.py --apply >> "$LOG_DIR/recalc-completeness-2.log" 2>&1

echo "$(date '+%H:%M:%S') Pipeline post-Yahoo terminé."
