#!/bin/bash
# watch-morningstar-then-cleanup.sh
# Attend la fin du morningstar-lt-enricher v2, puis lance le pipeline de nettoyage

set -e
cd "$(dirname "$0")/.."

MS_PID=87151
LOG_DIR="logs"

echo "$(date '+%H:%M:%S') Monitoring morningstar-lt-enricher (PID $MS_PID)..."

until ! kill -0 $MS_PID 2>/dev/null; do
    sleep 60
done

echo "$(date '+%H:%M:%S') Morningstar-lt terminé. Lancement fix-ms-annualized-perf..."
python3 scripts/migrations/fix-ms-annualized-perf.py --apply >> "$LOG_DIR/fix-ms-annualized-20260524.log" 2>&1
echo "$(date '+%H:%M:%S') fix-ms-annualized-perf terminé."

echo "$(date '+%H:%M:%S') Recalcul average_performance..."
python3 scripts/migrations/recalc-average-perf.py --apply >> "$LOG_DIR/recalc-avg-perf-20260524.log" 2>&1
echo "$(date '+%H:%M:%S') average_performance recalculé."

echo "$(date '+%H:%M:%S') Recalcul data_completeness (per-type)..."
python3 scripts/migrations/recalc-completeness-v2.py --per-type --apply >> "$LOG_DIR/recalc-completeness-20260524.log" 2>&1
echo "$(date '+%H:%M:%S') data_completeness recalculé."

echo "$(date '+%H:%M:%S') Pipeline post-Morningstar terminé."
