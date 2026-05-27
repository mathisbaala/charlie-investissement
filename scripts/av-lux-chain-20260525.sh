#!/bin/bash
# av-lux-chain-20260525.sh — Catalogues AV Lux non encore exécutés
# AG2R, Apicil OneLife, AXA Wealth Europe, LMEP EasyPack,
# opcvm360 (--all), Utmost, VitisLife, Cardif Lux Vie

set -e
cd "$(dirname "$0")/.."
mkdir -p logs

log() { echo "[$(date '+%H:%M:%S')] $*"; }

log "=== AV Lux Chain démarré ==="

log "1/8 AG2R La Mondiale..."
python3 scripts/scrapers/av-lux-ag2r-catalog.py --apply > logs/av-lux-ag2r-20260525.log 2>&1 \
    && log "AG2R OK" || log "AG2R ERREUR"

log "2/8 Apicil OneLife..."
python3 scripts/scrapers/av-lux-apicil-onelife-catalog.py --apply > logs/av-lux-apicil-20260525.log 2>&1 \
    && log "Apicil OK" || log "Apicil ERREUR"

log "3/8 AXA Wealth Europe..."
python3 scripts/scrapers/av-lux-axa-wealtheurope-catalog.py --apply > logs/av-lux-axa-we-20260525.log 2>&1 \
    && log "AXA WE OK" || log "AXA WE ERREUR"

log "4/8 LMEP EasyPack..."
python3 scripts/scrapers/av-lux-lmep-easypack.py --apply > logs/av-lux-lmep-20260525.log 2>&1 \
    && log "LMEP OK" || log "LMEP ERREUR"

log "5/8 opcvm360 (tous contrats)..."
python3 scripts/scrapers/av-lux-opcvm360-catalog.py --all --apply > logs/av-lux-opcvm360-20260525.log 2>&1 \
    && log "opcvm360 OK" || log "opcvm360 ERREUR"

log "6/8 Utmost..."
python3 scripts/scrapers/av-lux-utmost-catalog.py --apply > logs/av-lux-utmost-20260525.log 2>&1 \
    && log "Utmost OK" || log "Utmost ERREUR"

log "7/8 VitisLife..."
python3 scripts/scrapers/av-lux-vitislife-catalog.py --apply > logs/av-lux-vitislife-20260525.log 2>&1 \
    && log "VitisLife OK" || log "VitisLife ERREUR"

log "8/8 Cardif Lux Vie..."
python3 scripts/scrapers/av-lux-cardif-lux-vie-catalog.py --apply > logs/av-lux-cardif-lux-20260525.log 2>&1 \
    && log "Cardif Lux OK" || log "Cardif Lux ERREUR"

log "=== AV Lux Chain terminé ==="
