#!/usr/bin/env python3
"""
kid-url-finder.py — Trouver les URLs KID/DICI depuis les sources officielles
=============================================================================
Pour chaque fonds dans investissement_funds sans kid_url,
cherche l'URL du KID dans 4 sources :
  1. AMF GECO (lien officiel publié par l'AMF)
  2. Amundi (amundi.com — ~500 fonds, site très structuré)
  3. Carmignac (carmignac.com)
  4. Google Scholar / DuckDuckGo (fallback général)

Met à jour investissement_funds.kid_url + kid_hash si trouvé.

Usage :
    python3 scripts/scrapers/kid-url-finder.py [--apply] [--limit N] [--sgp amundi]

--sgp : restreindre à une SGP spécifique (ex: amundi, carmignac, bnp, natixis)
"""

import re
import sys
import time
import json
import argparse
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urljoin, urlparse

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_fund, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

RATE_LIMIT_SEC = 0.8
TIMEOUT        = 15

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

# ─── Source 1 : AMF GECO ──────────────────────────────────────────────────────

def find_kid_amf_geco(session: FetcherSession, isin: str) -> str | None:
    """Cherche l'URL KID dans la fiche GECO du fonds."""
    url = f"https://geco.amf-france.org/Bio/rech_part.aspx?CodeISIN={isin}"
    try:
        page = session.get(url, stealthy_headers=True, timeout=TIMEOUT)
        if page.status != 200:
            return None
        # Chercher un lien PDF contenant "kid", "dici", "kiid"
        matches = re.findall(
            r'href=["\']([^"\']*(?:kid|dici|kiid|key.information)[^"\']*\.pdf)["\']',
            page.body.decode("utf-8"), re.IGNORECASE
        )
        if matches:
            url_found = matches[0]
            if url_found.startswith("http"):
                return url_found
            return urljoin("https://geco.amf-france.org", url_found)
    except Exception:
        pass
    return None


# ─── Source 2 : Amundi ────────────────────────────────────────────────────────

def find_kid_amundi(session: FetcherSession, isin: str) -> str | None:
    """Cherche le KID dans le moteur de recherche Amundi par ISIN."""
    # Amundi a une API de recherche de fonds
    try:
        search_url = f"https://www.amundi.fr/fr_FR/particulier/ajax/funds?isin={isin}&lang=fr"
        page = session.get(search_url, headers={**HEADERS, "Accept": "application/json"}, timeout=TIMEOUT)
        if page.status == 200:
            data = json.loads(page.body.decode("utf-8"))
            funds = data if isinstance(data, list) else data.get("funds", data.get("results", []))
            for fund in funds:
                for key in ("kidUrl", "kid_url", "dici", "documentKID", "url"):
                    if fund.get(key) and ".pdf" in str(fund[key]).lower():
                        return fund[key]
    except (Exception, ValueError, KeyError):
        pass

    # Fallback : page fonds Amundi
    try:
        page_url = f"https://www.amundi.fr/fr_FR/particulier/fund/{isin}"
        page = session.get(page_url, stealthy_headers=True, timeout=TIMEOUT)
        if page.status == 200:
            matches = re.findall(
                r'href=["\']([^"\']*(?:kid|dici|kiid)[^"\']*\.pdf)["\']',
                page.body.decode("utf-8"), re.IGNORECASE
            )
            if matches:
                return matches[0] if matches[0].startswith("http") else urljoin("https://www.amundi.fr", matches[0])
    except Exception:
        pass

    return None


# ─── Source 3 : Carmignac ─────────────────────────────────────────────────────

def find_kid_carmignac(session: FetcherSession, isin: str) -> str | None:
    try:
        url = f"https://www.carmignac.fr/fr_FR/fund-corner?search={isin}"
        page = session.get(url, stealthy_headers=True, timeout=TIMEOUT)
        if page.status == 200:
            matches = re.findall(
                r'href=["\']([^"\']*(?:kid|dici|kiid)[^"\']*\.pdf)["\']',
                page.body.decode("utf-8"), re.IGNORECASE
            )
            if matches:
                m = matches[0]
                return m if m.startswith("http") else urljoin("https://www.carmignac.fr", m)
    except Exception:
        pass
    return None


# ─── Source 4 : BNP Paribas AM ────────────────────────────────────────────────

def find_kid_bnp(session: FetcherSession, isin: str) -> str | None:
    try:
        url = f"https://www.bnpparibas-am.com/fr-fr/fund-corner/?isin={isin}"
        page = session.get(url, stealthy_headers=True, timeout=TIMEOUT)
        if page.status == 200:
            matches = re.findall(
                r'"([^"]*(?:kid|dici|kiid)[^"]*\.pdf)"',
                page.body.decode("utf-8"), re.IGNORECASE
            )
            if matches:
                m = matches[0]
                return m if m.startswith("http") else urljoin("https://www.bnpparibas-am.com", m)
    except Exception:
        pass
    return None


# ─── Source 5 : Natixis IM ────────────────────────────────────────────────────

def find_kid_natixis(session: FetcherSession, isin: str) -> str | None:
    try:
        api_url = f"https://www.im.natixis.com/fr-fr/research/fonds/{isin}/documents"
        page = session.get(api_url, headers={**HEADERS, "Accept": "application/json"}, timeout=TIMEOUT)
        if page.status == 200:
            data = json.loads(page.body.decode("utf-8"))
            docs = data if isinstance(data, list) else data.get("documents", [])
            for doc in docs:
                doc_type = str(doc.get("type", "") or doc.get("category", "")).lower()
                if "kid" in doc_type or "dici" in doc_type:
                    for key in ("url", "link", "href", "downloadUrl"):
                        if doc.get(key):
                            return doc[key]
    except (Exception, ValueError):
        pass
    return None


# ─── Source 6 : La Française ─────────────────────────────────────────────────

def find_kid_lafrancaise(session: FetcherSession, isin: str) -> str | None:
    try:
        url = f"https://www.lafrancaise-group.com/fr/fonds/{isin}"
        page = session.get(url, stealthy_headers=True, timeout=TIMEOUT)
        if page.status == 200:
            matches = re.findall(
                r'href=["\']([^"\']*(?:kid|dici|kiid)[^"\']*\.pdf)["\']',
                page.body.decode("utf-8"), re.IGNORECASE
            )
            if matches:
                m = matches[0]
                return m if m.startswith("http") else urljoin("https://www.lafrancaise-group.com", m)
    except Exception:
        pass
    return None


# ─── Source 8 : CPR Asset Management ─────────────────────────────────────────

def find_kid_cpr(session: FetcherSession, isin: str) -> str | None:
    """CPR Asset Management (groupe Amundi)."""
    for url in [
        f"https://www.cpr-am.fr/particuliers/fonds/{isin}/documents",
        f"https://www.cpr-am.fr/fr/funds/{isin}",
        f"https://www.cpr-am.fr/fr/fonds/{isin}",
    ]:
        try:
            r = session.get(url, stealthy_headers=True, timeout=TIMEOUT, allow_redirects=True)
            if r.status == 200:
                m = re.findall(r'href=["\']([^"\']*(?:kid|dici|kiid)[^"\']*\.pdf)["\']', r.body.decode("utf-8"), re.IGNORECASE)
                if m:
                    return m[0] if m[0].startswith("http") else urljoin("https://www.cpr-am.fr", m[0])
        except Exception:
            continue
    return None


# ─── Source 9 : Fédéris Gestion d'Actifs ─────────────────────────────────────

def find_kid_federis(session: FetcherSession, isin: str) -> str | None:
    try:
        r = session.get(f"https://www.federis.fr/fr/fonds/{isin}", stealthy_headers=True, timeout=TIMEOUT)
        if r.status == 200:
            m = re.findall(r'href=["\']([^"\']*(?:kid|dici|kiid)[^"\']*\.pdf)["\']', r.body.decode("utf-8"), re.IGNORECASE)
            if m:
                return m[0] if m[0].startswith("http") else urljoin("https://www.federis.fr", m[0])
    except Exception:
        pass
    return None


# ─── Source 10 : La Banque Postale AM ────────────────────────────────────────

def find_kid_postale_am(session: FetcherSession, isin: str) -> str | None:
    for base in ["https://www.labanquepostale-am.fr/fr/fonds", "https://www.labanquepostale-am.fr/nos-fonds"]:
        try:
            r = session.get(f"{base}/{isin}", stealthy_headers=True, timeout=TIMEOUT)
            if r.status == 200:
                m = re.findall(r'href=["\']([^"\']*(?:kid|dici|kiid)[^"\']*\.pdf)["\']', r.body.decode("utf-8"), re.IGNORECASE)
                if m:
                    return m[0] if m[0].startswith("http") else urljoin("https://www.labanquepostale-am.fr", m[0])
        except Exception:
            continue
    return None


# ─── Source 11 : AXA Investment Managers ─────────────────────────────────────

def find_kid_axa_im(session: FetcherSession, isin: str) -> str | None:
    for url in [
        f"https://www.axa-im.fr/fr/produits-fonds/fonds/{isin}/overview",
        f"https://www.axa-im.fr/fr/produits-fonds/fonds/{isin}",
    ]:
        try:
            r = session.get(url, stealthy_headers=True, timeout=TIMEOUT)
            if r.status == 200:
                m = re.findall(r'href=["\']([^"\']*(?:kid|dici|kiid)[^"\']*\.pdf)["\']', r.body.decode("utf-8"), re.IGNORECASE)
                if m:
                    return m[0] if m[0].startswith("http") else urljoin("https://www.axa-im.fr", m[0])
        except Exception:
            continue
    return None


# ─── Source 12 : Groupama Asset Management ───────────────────────────────────

def find_kid_groupama_am(session: FetcherSession, isin: str) -> str | None:
    for url in [
        f"https://www.groupama-am.com/fr/fonds/{isin}/",
        f"https://www.groupama-am.com/fr/fonds/{isin}",
    ]:
        try:
            r = session.get(url, stealthy_headers=True, timeout=TIMEOUT)
            if r.status == 200:
                m = re.findall(r'href=["\']([^"\']*(?:kid|dici|kiid)[^"\']*\.pdf)["\']', r.body.decode("utf-8"), re.IGNORECASE)
                if m:
                    return m[0] if m[0].startswith("http") else urljoin("https://www.groupama-am.com", m[0])
        except Exception:
            continue
    return None


# ─── Source 13 : Candriam ────────────────────────────────────────────────────

def find_kid_candriam(session: FetcherSession, isin: str) -> str | None:
    for url in [
        f"https://www.candriam.com/fr/fund/{isin}/",
        f"https://www.candriam.com/fr/professional/market-and-research/fund/{isin}",
    ]:
        try:
            r = session.get(url, stealthy_headers=True, timeout=TIMEOUT)
            if r.status == 200:
                m = re.findall(r'href=["\']([^"\']*(?:kid|dici|kiid)[^"\']*\.pdf)["\']', r.body.decode("utf-8"), re.IGNORECASE)
                if m:
                    return m[0] if m[0].startswith("http") else urljoin("https://www.candriam.com", m[0])
        except Exception:
            continue
    return None


# ─── Source 14 : DNCA Finance ────────────────────────────────────────────────

def find_kid_dnca(session: FetcherSession, isin: str) -> str | None:
    try:
        r = session.get(f"https://www.dnca-investments.com/fr/nos-fonds/{isin}", stealthy_headers=True, timeout=TIMEOUT)
        if r.status == 200:
            m = re.findall(r'href=["\']([^"\']*(?:kid|dici|kiid)[^"\']*\.pdf)["\']', r.body.decode("utf-8"), re.IGNORECASE)
            if m:
                return m[0] if m[0].startswith("http") else urljoin("https://www.dnca-investments.com", m[0])
    except Exception:
        pass
    return None


# ─── Source 15 : Oddo BHF AM ─────────────────────────────────────────────────

def find_kid_oddo_bhf(session: FetcherSession, isin: str) -> str | None:
    for url in [
        f"https://am.oddo-bhf.com/fr/nos-fonds/{isin}",
        f"https://am.oddo-bhf.com/fr/fonds/{isin}",
    ]:
        try:
            r = session.get(url, stealthy_headers=True, timeout=TIMEOUT)
            if r.status == 200:
                m = re.findall(r'href=["\']([^"\']*(?:kid|dici|kiid)[^"\']*\.pdf)["\']', r.body.decode("utf-8"), re.IGNORECASE)
                if m:
                    return m[0] if m[0].startswith("http") else urljoin("https://am.oddo-bhf.com", m[0])
        except Exception:
            continue
    return None


# ─── Source 16 : Edmond de Rothschild AM ─────────────────────────────────────

def find_kid_edmond_rothschild(session: FetcherSession, isin: str) -> str | None:
    for url in [
        f"https://www.edmond-de-rothschild.com/fr-fr/asset-management/fonds/{isin}",
        f"https://am.edmond-de-rothschild.com/fr-fr/fonds/{isin}",
    ]:
        try:
            r = session.get(url, stealthy_headers=True, timeout=TIMEOUT)
            if r.status == 200:
                m = re.findall(r'href=["\']([^"\']*(?:kid|dici|kiid)[^"\']*\.pdf)["\']', r.body.decode("utf-8"), re.IGNORECASE)
                if m:
                    return m[0] if m[0].startswith("http") else urljoin("https://www.edmond-de-rothschild.com", m[0])
        except Exception:
            continue
    return None


# ─── Source 17 : Swiss Life AM ───────────────────────────────────────────────

def find_kid_swiss_life(session: FetcherSession, isin: str) -> str | None:
    for url in [
        f"https://www.swisslifeam.fr/nos-fonds/{isin}",
        f"https://www.swisslifeam.fr/fonds/{isin}",
    ]:
        try:
            r = session.get(url, stealthy_headers=True, timeout=TIMEOUT)
            if r.status == 200:
                m = re.findall(r'href=["\']([^"\']*(?:kid|dici|kiid)[^"\']*\.pdf)["\']', r.body.decode("utf-8"), re.IGNORECASE)
                if m:
                    return m[0] if m[0].startswith("http") else urljoin("https://www.swisslifeam.fr", m[0])
        except Exception:
            continue
    return None


# ─── Source 18 : Ostrum AM (Natixis) ─────────────────────────────────────────

def find_kid_ostrum(session: FetcherSession, isin: str) -> str | None:
    try:
        r = session.get(f"https://www.ostrum.com/fr/nos-fonds/{isin}", stealthy_headers=True, timeout=TIMEOUT)
        if r.status == 200:
            m = re.findall(r'href=["\']([^"\']*(?:kid|dici|kiid)[^"\']*\.pdf)["\']', r.body.decode("utf-8"), re.IGNORECASE)
            if m:
                return m[0] if m[0].startswith("http") else urljoin("https://www.ostrum.com", m[0])
    except Exception:
        pass
    return None


# ─── Source 19 : Lazard Frères Gestion ───────────────────────────────────────

def find_kid_lazard(session: FetcherSession, isin: str) -> str | None:
    try:
        r = session.get(f"https://www.lazardfreresgestion.fr/fonds/{isin}", stealthy_headers=True, timeout=TIMEOUT)
        if r.status == 200:
            m = re.findall(r'href=["\']([^"\']*(?:kid|dici|kiid)[^"\']*\.pdf)["\']', r.body.decode("utf-8"), re.IGNORECASE)
            if m:
                return m[0] if m[0].startswith("http") else urljoin("https://www.lazardfreresgestion.fr", m[0])
    except Exception:
        pass
    return None


# ─── Source 20 : Comgest ─────────────────────────────────────────────────────

def find_kid_comgest(session: FetcherSession, isin: str) -> str | None:
    for url in [
        f"https://www.comgest.com/fr/fr/funds/fund-detail/{isin}",
        f"https://www.comgest.com/fr/fr/funds/{isin}",
    ]:
        try:
            r = session.get(url, stealthy_headers=True, timeout=TIMEOUT)
            if r.status == 200:
                m = re.findall(r'href=["\']([^"\']*(?:kid|dici|kiid)[^"\']*\.pdf)["\']', r.body.decode("utf-8"), re.IGNORECASE)
                if m:
                    return m[0] if m[0].startswith("http") else urljoin("https://www.comgest.com", m[0])
        except Exception:
            continue
    return None


# ─── Source 21 : Sycomore AM ─────────────────────────────────────────────────

def find_kid_sycomore(session: FetcherSession, isin: str) -> str | None:
    try:
        r = session.get(f"https://www.sycomore-am.com/fr/nos-fonds/{isin}", stealthy_headers=True, timeout=TIMEOUT)
        if r.status == 200:
            m = re.findall(r'href=["\']([^"\']*(?:kid|dici|kiid)[^"\']*\.pdf)["\']', r.body.decode("utf-8"), re.IGNORECASE)
            if m:
                return m[0] if m[0].startswith("http") else urljoin("https://www.sycomore-am.com", m[0])
    except Exception:
        pass
    return None


# ─── Source 22 : Federal Finance Gestion ─────────────────────────────────────

def find_kid_federal_finance(session: FetcherSession, isin: str) -> str | None:
    for url in [
        f"https://www.federalfinance.fr/fr/nos-fonds/{isin}",
        f"https://www.federalfinance.fr/nos-fonds/{isin}",
    ]:
        try:
            r = session.get(url, stealthy_headers=True, timeout=TIMEOUT)
            if r.status == 200:
                m = re.findall(r'href=["\']([^"\']*(?:kid|dici|kiid)[^"\']*\.pdf)["\']', r.body.decode("utf-8"), re.IGNORECASE)
                if m:
                    return m[0] if m[0].startswith("http") else urljoin("https://www.federalfinance.fr", m[0])
        except Exception:
            continue
    return None


# ─── Source 23 : ESMA PRIIPS Central Register ────────────────────────────────

def find_kid_esma(session: FetcherSession, isin: str) -> str | None:
    """
    Registre européen officiel des KIDs PRIIPs (ESMA).
    API publique : https://www.priipscentral.esma.europa.eu/
    """
    base = "https://www.priipscentral.esma.europa.eu"
    esma_hdrs = {**HEADERS, "Accept": "application/json", "Origin": base, "Referer": base + "/"}
    endpoints = [
        f"{base}/priips-search-api/PRIIPS/kiddocs/search?isin={isin}&country=FR&locale=fr_FR&page=0&size=5",
        f"{base}/priips-search-api/PRIIPS/kiddocs/search?isin={isin}&page=0&size=5",
    ]
    for api_url in endpoints:
        try:
            page = session.get(api_url, headers=esma_hdrs, timeout=TIMEOUT)
            if page.status != 200:
                continue
            data = json.loads(page.body.decode("utf-8"))
            docs = data if isinstance(data, list) else data.get("content", data.get("documents", data.get("results", [])))
            if not isinstance(docs, list) or not docs:
                continue
            # Prioriser documents FR récents
            docs_sorted = sorted(docs, key=lambda d: (
                d.get("country", "") == "FR",
                d.get("language", d.get("locale", "")) in ("fr", "fr_FR", "fr-FR"),
                d.get("depositDate", d.get("date", "")),
            ), reverse=True)
            for doc in docs_sorted:
                for key in ("documentUrl", "url", "pdfUrl", "href", "downloadUrl"):
                    url = doc.get(key)
                    if url and isinstance(url, str) and (".pdf" in url.lower() or "download" in url.lower()):
                        return url if url.startswith("http") else urljoin(base, url)
                doc_id = doc.get("documentId") or doc.get("id") or doc.get("kiddocId")
                if doc_id:
                    candidate = f"{base}/priips-search-api/PRIIPS/kiddocs/{doc_id}/download"
                    try:
                        r2 = session.head(candidate, stealthy_headers=True, timeout=TIMEOUT, allow_redirects=True)
                        if r2.status_code == 200:
                            return candidate
                    except Exception:
                        pass
        except (Exception, ValueError):
            continue
    return None


# ─── Source 24 : Quantalys ───────────────────────────────────────────────────

def find_kid_quantalys(session: FetcherSession, isin: str) -> str | None:
    """Quantalys — agrégateur français de fonds, souvent avec lien KID direct."""
    try:
        url = f"https://www.quantalys.com/fonds/{isin}"
        r = session.get(url, stealthy_headers=True, timeout=TIMEOUT)
        if r.status == 200:
            m = re.findall(
                r'href=["\']([^"\']*(?:kid|dici|kiid|key.information)[^"\']*\.pdf)["\']',
                r.body.decode("utf-8"), re.IGNORECASE
            )
            if m:
                return m[0] if m[0].startswith("http") else urljoin("https://www.quantalys.com", m[0])
    except Exception:
        pass
    return None


# ─── Source 7 : Generateur URL standard (pattern commun) ──────────────────────

def find_kid_fundinfo(session: FetcherSession, isin: str) -> str | None:
    """
    FundInfo héberge les KIDs de nombreuses SGPs européennes.
    URL pattern : https://doc.fundinfo.com/doc/{isin}/kid_{isin}_fr.pdf
    """
    patterns = [
        f"https://doc.fundinfo.com/doc/{isin}/kid_{isin}_fr.pdf",
        f"https://doc.fundinfo.com/doc/{isin}/dici_{isin}_fr.pdf",
        f"https://doc.fundinfo.com/doc/{isin}/kiid_{isin}_fr.pdf",
    ]
    for url in patterns:
        try:
            resp = session.head(url, stealthy_headers=True, timeout=TIMEOUT, allow_redirects=True)
            if page.status == 200:
                content_type = resp.headers.get("Content-Type", "")
                if "pdf" in content_type or resp.headers.get("Content-Disposition", ""):
                    return url
        except Exception:
            pass
    return None


# ─── Dispatcher : choisir le bon finder selon la SGP ─────────────────────────

SGP_FINDERS = {
    "amundi":                find_kid_amundi,
    "carmignac":             find_kid_carmignac,
    "bnp":                   find_kid_bnp,
    "natixis":               find_kid_natixis,
    "la française":          find_kid_lafrancaise,
    "lafrancaise":           find_kid_lafrancaise,
    # Groupe Amundi
    "cpr":                   find_kid_cpr,
    "crédit mutuel amundi":  find_kid_cpr,
    "credit mutuel amundi":  find_kid_cpr,
    # Banques / assureurs
    "fédéris":               find_kid_federis,
    "federis":               find_kid_federis,
    "la banque postale":     find_kid_postale_am,
    "banque postale":        find_kid_postale_am,
    "axa":                   find_kid_axa_im,
    "groupama":              find_kid_groupama_am,
    "swiss life":            find_kid_swiss_life,
    "federal finance":       find_kid_federal_finance,
    # Boutiques / indépendants
    "candriam":              find_kid_candriam,
    "dnca":                  find_kid_dnca,
    "oddo":                  find_kid_oddo_bhf,
    "edmond de rothschild":  find_kid_edmond_rothschild,
    "edmond-de-rothschild":  find_kid_edmond_rothschild,
    "ostrum":                find_kid_ostrum,
    "lazard":                find_kid_lazard,
    "lazard frères":         find_kid_lazard,
    "comgest":               find_kid_comgest,
    "sycomore":              find_kid_sycomore,
}

GENERIC_FINDERS = [
    ("amf-geco",    find_kid_amf_geco),
    # esma : priipscentral.esma.europa.eu ne résout pas → désactivé
    # fundinfo doc : doc.fundinfo.com ne résout pas → désactivé
    # quantalys : nécessite JavaScript → désactivé
]


def find_kid_url(session: FetcherSession, isin: str, sgp: str) -> tuple[str | None, str]:
    """Essaie les sources dans l'ordre et retourne (url, source)."""
    sgp_lower = (sgp or "").lower()

    # 1. Source spécifique SGP en premier (matching sur le nom de la société de gestion)
    for key, finder in SGP_FINDERS.items():
        if key in sgp_lower:
            url = finder(session, isin)
            if url:
                return url, key
            break  # Un seul finder SGP par fonds, ne pas essayer tous

    # 2. Sources génériques (AMF GECO, ESMA, FundInfo, Quantalys)
    for name, finder in GENERIC_FINDERS:
        url = finder(session, isin)
        if url:
            return url, name

    return None, "not_found"


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None, sgp_filter: str | None, isin_prefix: str | None = None):
    print("=" * 60)
    print("  KID URL Finder — Recherche URLs KID/DICI")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    if sgp_filter:
        print(f"  SGP filtre : {sgp_filter}")
    if isin_prefix:
        print(f"  ISIN préfixe : {isin_prefix}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # Récupérer les fonds sans kid_url avec pagination
    funds = []
    page_size = 1000
    offset    = 0
    while True:
        query = client.table("investissement_funds") \
            .select("isin, name, management_company, aum_eur") \
            .is_("kid_url", "null") \
            .range(offset, offset + page_size - 1)
        if sgp_filter:
            query = query.ilike("management_company", f"%{sgp_filter}%")
        if isin_prefix:
            query = query.ilike("isin", f"{isin_prefix}%")
        resp  = query.execute()
        batch = resp.data or []
        funds.extend(batch)
        if len(batch) < page_size:
            break
        if limit and len(funds) >= limit:
            funds = funds[:limit]
            break
        offset += page_size
    print(f"  {len(funds)} fonds sans kid_url à traiter")
    print()

    session = build_session()

    found, not_found = 0, 0
    for i, fund in enumerate(funds, 1):
        isin = fund["isin"]
        sgp  = fund.get("management_company", "")
        name = fund.get("name", "")[:45]

        time.sleep(RATE_LIMIT_SEC)
        url, source = find_kid_url(session, isin, sgp)

        if url:
            found += 1
            print(f"  ✓ [{i:4d}] {isin} ({source:12s}) {name}")
            if apply:
                upsert_fund({"isin": isin, "kid_url": url})
        else:
            not_found += 1
            if i <= 20 or i % 100 == 0:
                print(f"  ✗ [{i:4d}] {isin} (not found)        {name}")

    print()
    print(f"  ✓ {found} URLs trouvées, {not_found} non trouvées")

    if apply:
        log_run(
            scraper="kid-url-finder",
            status="success",
            records_processed=found,
            records_failed=not_found,
            started_at=started,
        )


def build_session() -> FetcherSession:
    return FetcherSession(impersonate="chrome").__enter__()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="KID URL Finder")
    parser.add_argument("--apply",  action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",  type=int,            help="Limiter à N fonds")
    parser.add_argument("--sgp",         type=str, help="Filtrer par société de gestion")
    parser.add_argument("--isin-prefix", type=str, help="Filtrer par préfixe ISIN (ex: FR)")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, sgp_filter=args.sgp, isin_prefix=args.isin_prefix)
