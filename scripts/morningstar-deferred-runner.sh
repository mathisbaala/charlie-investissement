#!/bin/bash
# morningstar-deferred-runner.sh
# Tente une fois Morningstar. Si débloqué, lance le pipeline complet.
# Sinon, log et exit (sera réessayé par launchd).
# Idempotent : un fichier marker évite la double exécution.

set -e
cd "$(dirname "$0")/.."

MARKER_FILE="logs/morningstar-deferred-DONE.marker"
LOG_FILE="logs/morningstar-deferred.log"
MS_TEST_URL="https://www.morningstar.fr/fr/util/SecuritySearch.ashx?q=FR0010321794&limit=1"

mkdir -p logs

log() {
    echo "$(date -u '+%Y-%m-%d %H:%M:%S UTC') $*" | tee -a "$LOG_FILE"
}

# 1. Skip si déjà fait
if [ -f "$MARKER_FILE" ]; then
    log "✓ Pipeline déjà exécuté ($(cat "$MARKER_FILE")). Skip."
    exit 0
fi

log "▶ Tentative Morningstar..."

# 2. Test Morningstar
RESPONSE=$(curl -s "$MS_TEST_URL" \
    -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120" \
    -H "Referer: https://www.morningstar.fr/fr/" \
    --max-time 15 2>/dev/null || echo "")
LEN=${#RESPONSE}

if [ "$LEN" -lt 10 ]; then
    log "❌ Toujours bloqué (réponse vide, size=$LEN). Réessai au prochain trigger."
    exit 0
fi

# 3. DÉBLOQUÉ — lancer le pipeline complet
log "🎉 Morningstar débloqué (size=$LEN) ! Lancement pipeline complet..."

# 3a. Morningstar enricher
log "  [1/5] morningstar-lt-enricher --apply..."
python3 -u scripts/scrapers/morningstar-lt-enricher.py --apply \
    >> logs/morningstar-lt-deferred.log 2>&1 || log "  ⚠️ morningstar-lt-enricher exit=$?"

# 3b. Recalc avg perf
log "  [2/5] recalc-average-perf..."
python3 -u scripts/migrations/recalc-average-perf.py --apply \
    >> logs/recalc-avg-perf.log 2>&1 || log "  ⚠️ recalc-average-perf exit=$?"

# 3c. KID bulk parser
log "  [3/5] kid-bulk-parser --apply (nouveaux kid_url Morningstar)..."
python3 -u scripts/scrapers/kid-bulk-parser.py --apply --min-aum 0 \
    >> logs/kid-parser-deferred.log 2>&1 || log "  ⚠️ kid-bulk-parser exit=$?"

# 3d. Set kid_parsed_at sur SRRI+TER
log "  [4/5] set-kid-parsed-at --all-data --apply..."
python3 -u scripts/migrations/set-kid-parsed-at.py --all-data --apply \
    >> logs/set-kid-parsed-at.log 2>&1 || log "  ⚠️ set-kid-parsed-at exit=$?"

# 3e. Recalc completeness v2 (la nouvelle formule par type)
log "  [5/5] recalc-completeness-v2 --per-type --apply..."
python3 -u scripts/migrations/recalc-completeness-v2.py --per-type --apply \
    >> logs/recalc-completeness-v2.log 2>&1 || log "  ⚠️ recalc-completeness-v2 exit=$?"

# 4. Marquer comme terminé
echo "$(date -u '+%Y-%m-%d %H:%M:%S UTC')" > "$MARKER_FILE"
log "✅ Pipeline post-Morningstar TERMINÉ. Marker créé."
