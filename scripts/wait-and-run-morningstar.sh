#!/bin/bash
# wait-and-run-morningstar.sh
# Attend la levée du blocage IP Morningstar, lance l'enrichisseur, puis le pipeline de nettoyage.
set -e
cd "$(dirname "$0")/.."

MS_TEST_URL="https://www.morningstar.fr/fr/util/SecuritySearch.ashx?q=FR0010321794&limit=1"
MS_HEADERS='-H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120" -H "Referer: https://www.morningstar.fr/fr/"'
LOG_FILE="/tmp/morningstar-lt-autorun.log"
mkdir -p logs

echo "$(date -u '+%H:%M UTC') Attente levée blocage Morningstar..."

while true; do
    RESPONSE=$(curl -s "$MS_TEST_URL" \
        -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120" \
        -H "Referer: https://www.morningstar.fr/fr/" \
        --max-time 10 2>/dev/null || echo "")
    LEN=${#RESPONSE}
    if [ "$LEN" -gt 10 ]; then
        echo "$(date -u '+%H:%M UTC') Morningstar débloqué (réponse: ${LEN} octets)"
        break
    fi
    echo "$(date -u '+%H:%M UTC') Encore bloqué (réponse vide). Prochaine vérif dans 10 min..."
    sleep 600
done

echo "$(date -u '+%H:%M UTC') Lancement morningstar-lt-enricher --apply ..."
python3 -u scripts/scrapers/morningstar-lt-enricher.py --apply > "$LOG_FILE" 2>&1
echo "$(date -u '+%H:%M UTC') morningstar-lt-enricher terminé."

# fix-ms-annualized-perf retiré : morningstar-lt-enricher effectue déjà la
# conversion annualisé→cumulatif en ligne (M36/M60). Relancer ce script après
# un enrichissement causerait une double conversion.

echo "$(date -u '+%H:%M UTC') recalc-average-perf..."
python3 scripts/migrations/recalc-average-perf.py --apply >> logs/recalc-avg-perf.log 2>&1

echo "$(date -u '+%H:%M UTC') recalc-completeness..."
python3 scripts/migrations/recalc-completeness.py --apply >> logs/recalc-completeness.log 2>&1

echo "$(date -u '+%H:%M UTC') Pipeline post-Morningstar TERMINÉ."
