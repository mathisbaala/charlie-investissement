#!/bin/bash
# post-morningstar-pipeline.sh
# À lancer après wait-and-run-morningstar.sh pour parser les nouveaux KIDs.
# Usage : bash scripts/post-morningstar-pipeline.sh [WATCHER_PID]
set -e
cd "$(dirname "$0")/.."
mkdir -p logs

WATCHER_PID=${1:-0}

if [ "$WATCHER_PID" -gt 0 ]; then
    echo "$(date -u '+%H:%M UTC') Attente de la fin du watcher (PID $WATCHER_PID)..."
    while kill -0 "$WATCHER_PID" 2>/dev/null; do
        sleep 30
    done
    echo "$(date -u '+%H:%M UTC') Watcher terminé."
fi

echo "$(date -u '+%H:%M UTC') kid-bulk-parser --apply (nouveaux kid_url Morningstar)..."
python3 -u scripts/scrapers/kid-bulk-parser.py --apply --min-aum 0 \
    >> logs/kid-parser-post-ms.log 2>&1
echo "$(date -u '+%H:%M UTC') kid-bulk-parser terminé."

echo "$(date -u '+%H:%M UTC') set-kid-parsed-at --all-data..."
python3 scripts/migrations/set-kid-parsed-at.py --all-data --apply \
    >> logs/set-kid-parsed-at.log 2>&1

echo "$(date -u '+%H:%M UTC') recalc-completeness final..."
python3 scripts/migrations/recalc-completeness.py --apply \
    >> logs/recalc-completeness.log 2>&1

echo "$(date -u '+%H:%M UTC') recalc-average-perf final..."
python3 scripts/migrations/recalc-average-perf.py --apply \
    >> logs/recalc-avg-perf.log 2>&1

echo "$(date -u '+%H:%M UTC') Pipeline post-Morningstar (KID+completeness) TERMINÉ."
