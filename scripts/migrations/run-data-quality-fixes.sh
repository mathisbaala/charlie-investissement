#!/usr/bin/env bash
# ==========================================================================
# run-data-quality-fixes.sh — Pipeline de correction data-quality
# --------------------------------------------------------------------------
# Corrige les incohérences d'unités de investissement_funds, dans l'ORDRE
# imposé par docs/data-standards.md (corrections d'unités AVANT recalculs et
# AVANT le switch completeness v2, sinon les scores reflètent des données
# fausses).
#
# Par défaut : DRY-RUN total (aucune écriture). Les audits tournent quand même.
# Pour appliquer réellement :   APPLY=1 ./run-data-quality-fixes.sh
#
# Requiert un .env valide à la racine (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
# ==========================================================================
set -uo pipefail
cd "$(dirname "$0")/.."   # -> scripts/

FLAG=""
if [ "${APPLY:-0}" = "1" ]; then FLAG="--apply"; fi
MODE=$([ -n "$FLAG" ] && echo "APPLY" || echo "DRY-RUN")

run_if_exists() {
  local f="$1"; shift
  if [ -f "$f" ]; then
    echo ">> $f $*"
    python3 "$f" "$@"
  else
    echo "   (absent, ignoré : $f)"
  fi
}

echo "############################################################"
echo "#  Data-quality fixes — mode $MODE"
echo "############################################################"

echo; echo "== 1. Audit AVANT =="
run_if_exists migrations/audit-data-quality.py --json /tmp/audit-before.json

echo; echo "== 2. Corrections d'unités ($MODE) =="
run_if_exists migrations/fix-perf-decimal-all-types.py $FLAG
run_if_exists migrations/fix-vol-saturated.py $FLAG
run_if_exists migrations/fix-aum-currency-local.py $FLAG
run_if_exists migrations/fix-ter-mismatch.py $FLAG
run_if_exists migrations/fix-asset-class.py $FLAG
run_if_exists migrations/fix-html-entities.py $FLAG

if [ -n "$FLAG" ]; then
  echo; echo "== 3. Recalculs métier (après corrections) =="
  run_if_exists migrations/recalc-average-perf.py --apply
  run_if_exists migrations/recalc-track-record.py --apply

  echo; echo "== 4. Completeness v2 (uniquement une fois les unités corrigées) =="
  run_if_exists migrations/recalc-completeness-v2.py --per-type --apply
else
  echo; echo "== 3-4. Recalculs + completeness v2 : sautés en DRY-RUN =="
fi

echo; echo "== 5. Audit APRÈS =="
run_if_exists migrations/audit-data-quality.py --json /tmp/audit-after.json

echo
echo "Terminé ($MODE). Comparer /tmp/audit-before.json et /tmp/audit-after.json."
[ -z "$FLAG" ] && echo "Pour appliquer :  APPLY=1 $0"
