// Extraction des positions d'un relevé de situation d'assureur (texte de PDF).
// Cœur PUR de l'onglet « Analyse de l'existant » (cf. docs/analyse-existant-spec.md) :
// on n'interprète PAS la mise en page (chaque assureur a la sienne, elle change)
// mais des INVARIANTS — un ISIN valide (clé Luhn) et les montants qui l'entourent
// sur la même ligne. Même philosophie que les scrapers d'annexes financières
// (scripts/scrapers/_av_pdf_common.py), portée côté TypeScript.

/** ISIN candidat : 2 lettres pays + 9 alphanumériques + 1 chiffre de contrôle. */
export const ISIN_SCAN_RE = /\b([A-Z]{2}[A-Z0-9]{9}\d)\b/g;

/**
 * Vrai ISIN = clé de contrôle mod-10 (Luhn sur lettres→chiffres, A=10…Z=35).
 * Écarte les faux positifs du regex (codes internes assureur, n° de contrat).
 */
export function isValidIsin(isin: string): boolean {
  if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) return false;
  let digits = "";
  for (const ch of isin) {
    if (ch >= "0" && ch <= "9") digits += ch;
    else digits += String(ch.charCodeAt(0) - 55);
  }
  let total = 0;
  const rev = digits.split("").reverse();
  for (let i = 0; i < rev.length; i++) {
    let n = Number(rev[i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    total += n;
  }
  return total % 10 === 0;
}

/**
 * Montant au format français : « 12 345,67 », « 1.234,56 € », espaces insécables
 * (U+00A0/U+202F) compris. Retourne la valeur en euros, ou null.
 */
export function parseFrenchAmount(raw: string): number | null {
  const cleaned = raw
    .replace(/[  \s]/g, "")
    .replace(/€|EUR/gi, "")
    .replace(/\./g, "")
    .replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Nombre « à la française » sur une ligne de relevé (avec ou sans décimales).
const AMOUNT_SCAN_RE = /-?\d{1,3}(?:[  \s.]\d{3})+(?:,\d{1,4})?(?:\s*(?:€|EUR))?|-?\d+(?:,\d{1,4})?(?:\s*(?:€|EUR))?/g;

/**
 * Un document dont AUCUNE position ne porte de montant n'est pas un relevé de
 * situation : c'est typiquement une annexe de frais/performances (loi PACTE)
 * qui liste des supports avec des pourcentages. Sert à avertir l'utilisateur
 * qu'il a déposé le mauvais document.
 */
export function looksLikeFeeDocument(positions: ExtractedPosition[]): boolean {
  return positions.length > 0 && positions.every((p) => p.amount === null);
}

/** Ligne extraite d'un relevé : une position candidate. */
export interface ExtractedPosition {
  isin: string;
  /** Libellé best-effort (texte avant l'ISIN sur la ligne, sinon après). */
  label: string;
  /** Montant retenu (le plus grand nombre de la ligne — heuristique : la valeur
   *  de la position domine VL et nombre de parts). Éditable dans l'UI. */
  amount: number | null;
}

// Libellé plausible : au moins 3 lettres, pas un en-tête de colonne.
const HEADER_WORDS = /\b(isin|code|libell[ée]|support|valeur|montant|part|quantit[ée]|unit[ée]s?)\b/i;

/**
 * ANONYMISATION déterministe d'un libellé : le seul texte libre qui sorte d'un
 * relevé est le libellé de la ligne de support — on y masque tout ce qui
 * pourrait identifier le client si l'assureur le fait figurer sur la ligne :
 *   - suites de ≥ 5 chiffres (n° d'adhérent/contrat — jamais un nom de fonds ;
 *     les millésimes type « Horizon 2030 » font 4 chiffres et sont préservés),
 *   - adresses e-mail,
 *   - civilités suivies d'un nom (« M. Dupont », « Madame Martin »).
 * Le reste du document (état civil, adresse…) n'est JAMAIS extrait : seules
 * les lignes porteuses d'un ISIN valide sont lues.
 */
export function scrubLabel(label: string): string {
  return label
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "•")
    .replace(/\b(?:M\.|Mr|Mme|Mlle|Monsieur|Madame|Mademoiselle)\s+[A-ZÀ-Ý][\wÀ-ÿ'-]*/g, "•")
    .replace(/\d{5,}/g, "•")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function plausibleLabel(s: string): string {
  const t = scrubLabel(
    s.replace(/\s{2,}/g, " ").replace(/^[\s.·–—|-]+|[\s.·–—|:-]+$/g, "").trim(),
  );
  if (t.length < 4 || !/[A-Za-zÀ-ÿ]{3}/.test(t) || HEADER_WORDS.test(t)) return "";
  return t.slice(0, 120);
}

/**
 * Meilleur montant d'une ligne : plus grand nombre ≥ 1 hors pourcentages
 * (perfs/frais), en ne retenant que les nombres À DÉCIMALES dès qu'il en
 * existe (les entiers secs appartiennent aux libellés : « S&P 500 »).
 */
function lineAmount(line: string): number | null {
  const candidates: { v: number; decimal: boolean }[] = [];
  AMOUNT_SCAN_RE.lastIndex = 0;
  let am: RegExpExecArray | null;
  while ((am = AMOUNT_SCAN_RE.exec(line)) !== null) {
    if (!am[0].trim()) continue;
    if (/^\s*%/.test(line.slice(am.index + am[0].length))) continue;
    const v = parseFrenchAmount(am[0]);
    if (v !== null && v >= 1) candidates.push({ v, decimal: /,\d/.test(am[0]) });
  }
  const pool = candidates.some((c) => c.decimal)
    ? candidates.filter((c) => c.decimal)
    : candidates;
  return pool.length ? Math.max(...pool.map((c) => c.v)) : null;
}

/** Normalisation de libellé pour l'appariement par nom (2nde passe). */
function normalizeLabel(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/**
 * Extrait les positions d'un texte de relevé, ligne à ligne.
 * Une même ligne peut porter VL + parts + montant : on retient le PLUS GRAND
 * nombre ≥ 1 (best-effort, corrigeable à l'écran). Les occurrences répétées
 * d'un ISIN (multi-poches d'un même support) sont fusionnées en sommant.
 */
export function extractPositions(text: string): ExtractedPosition[] {
  const byIsin = new Map<string, ExtractedPosition>();
  const lines = (text || "").split(/\r?\n/);
  for (const line of lines) {
    ISIN_SCAN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ISIN_SCAN_RE.exec(line)) !== null) {
      const isin = m[1];
      if (!isValidIsin(isin)) continue;

      const before = plausibleLabel(line.slice(0, m.index));
      const after = plausibleLabel(
        (line.slice(m.index + isin.length).trim().split(/\s{2,}/)[0] ?? ""),
      );
      const label = before || after;

      // Montants de la ligne HORS l'ISIN lui-même (sa terminaison numérique
      // matcherait le scan). On masque l'ISIN avant de chercher. Deux pièges
      // rencontrés sur relevés réels :
      //   - un nombre suivi de « % » est une performance ou des frais, JAMAIS
      //     un montant (annexes loi PACTE : « MSCI World … 11,32% ») ;
      //   - les libellés portent des entiers secs (« S&P 500 », « Horizon
      //     2030 ») : dès qu'un nombre À DÉCIMALES existe sur la ligne, seuls
      //     les nombres à décimales sont candidats (les colonnes chiffrées des
      //     relevés — VL, valorisation — sont toujours décimales).
      const masked = line.slice(0, m.index) + " ".repeat(isin.length) + line.slice(m.index + isin.length);
      const amount = lineAmount(masked);

      const prev = byIsin.get(isin);
      if (prev) {
        if (amount !== null) prev.amount = (prev.amount ?? 0) + amount;
        if (!prev.label && label) prev.label = label;
      } else {
        byIsin.set(isin, { isin, label, amount });
      }
    }
  }

  // 2nde passe — APPARIEMENT PAR NOM : certains relevés (ex. Afer trimestriel)
  // séparent la synthèse chiffrée (noms + montants, SANS ISIN) de l'annexe
  // performances (ISIN + noms, SANS montants). Pour chaque position restée sans
  // montant, on cherche son libellé sur les lignes dépourvues d'ISIN et on y
  // prend le meilleur montant (mêmes gardes : pas de %, décimales d'abord).
  const missing = Array.from(byIsin.values()).filter(
    (p) => p.amount === null && normalizeLabel(p.label).length >= 6,
  );
  if (missing.length > 0) {
    for (const line of lines) {
      ISIN_SCAN_RE.lastIndex = 0;
      if (ISIN_SCAN_RE.test(line)) continue; // lignes à ISIN : déjà traitées
      const norm = normalizeLabel(line);
      for (const p of missing) {
        if (p.amount !== null || !norm.includes(normalizeLabel(p.label))) continue;
        const v = lineAmount(line);
        if (v !== null) p.amount = v;
      }
    }
  }

  return Array.from(byIsin.values());
}

/** Position validée à l'écran (montant confirmé, fonds connu du catalogue). */
export interface ValidatedPosition {
  isin: string;
  name: string;
  amount: number;
}

/**
 * Consolide plusieurs relevés en un portefeuille pondéré : somme les montants
 * par ISIN puis convertit en poids (fractions, somme = 1). Les montants nuls ou
 * négatifs sont ignorés.
 */
export function consolidate(
  positions: ValidatedPosition[],
): { isin: string; name: string; amount: number; weight: number }[] {
  const byIsin = new Map<string, { isin: string; name: string; amount: number }>();
  for (const p of positions) {
    if (!Number.isFinite(p.amount) || p.amount <= 0) continue;
    const prev = byIsin.get(p.isin);
    if (prev) prev.amount += p.amount;
    else byIsin.set(p.isin, { isin: p.isin, name: p.name, amount: p.amount });
  }
  const total = Array.from(byIsin.values()).reduce((s, p) => s + p.amount, 0);
  if (total <= 0) return [];
  return Array.from(byIsin.values())
    .map((p) => ({ ...p, weight: p.amount / total }))
    .sort((a, b) => b.amount - a.amount);
}
