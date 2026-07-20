// ── Lecture DÉTERMINISTE d'un DICI / KID (PRIIPs) ────────────────────────────
// Les documents d'information clé sont RÉGLEMENTÉS (UCITS KIID puis PRIIPs KID) :
// titres de sections figés, tableau de coûts normalisé, indicateur de risque sur
// 7. Pour le seul besoin de l'onglet « Frais » — rattacher un support et lire ses
// FRAIS — une poignée de regexes suffit sur la couche texte du PDF, SANS appel à
// un modèle (l'outil est en libre-service, sans compte : chaque appel Vision
// coûte). L'IA reste le filet quand le déterministe échoue (PDF scanné, gabarit
// exotique) — cf. api/dici/parse : déterministe d'abord, IA en secours.
//
// Fonctions PURES (aucun accès réseau/DB) : `text` est la sortie de pdfToLines.

import { isValidIsin } from "./releve";

export interface DiciDeterministic {
  isin: string | null;
  name: string | null;
  ongoing_charges: number | null; // frais courants annuels, en % (ex. 1.5)
  sri: number | null;             // indicateur synthétique de risque 1..7
  entry_fees_max: string | null;  // texte (« 2 % », « Néant ») — cf. parsePctString
  exit_fees_max: string | null;
}

/** Premier ISIN valide (clé Luhn) rencontré dans le texte. */
export function findIsin(text: string): string | null {
  // 2 lettres pays + 9 alphanum + 1 chiffre de contrôle. On borne par des
  // frontières non-alphanumériques pour ne pas capter un fragment d'un code plus
  // long (référence interne collée).
  const re = /(?<![A-Z0-9])([A-Z]{2}[A-Z0-9]{9}[0-9])(?![A-Z0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const cand = m[1];
    if (isValidIsin(cand)) return cand;
  }
  return null;
}

// Un nombre « français » collé à un % : 1,50 % / 0.25% / 12 %. Renvoie la valeur
// numérique (point décimal), ou null.
function pctNumber(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const v = Number(String(raw).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

/**
 * Frais courants annuels (%). Deux gabarits :
 *   • UCITS KIID : « Frais courants  1,50 % ».
 *   • PRIIPs KID : ligne « Frais de gestion et autres frais administratifs ou
 *     d'exploitation … 1,50 % » du tableau des coûts (coûts récurrents).
 * On borne la fenêtre entre le libellé et le % pour ne pas happer un pourcentage
 * d'une autre ligne (les lignes sont déjà reconstruites par pdfToLines).
 */
export function findOngoingCharges(text: string): number | null {
  const patterns = [
    /frais\s+courants[^%\n]{0,40}?(\d{1,2}(?:[.,]\d{1,2})?)\s*%/i,
    /frais\s+de\s+gestion\s+et\s+autres\s+frais[^%\n]{0,60}?(\d{1,2}(?:[.,]\d{1,2})?)\s*%/i,
    /co[uû]ts?\s+r[ée]currents[^%\n]{0,60}?(\d{1,2}(?:[.,]\d{1,2})?)\s*%/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    const v = pctNumber(m?.[1]);
    // Garde-fou de plausibilité : des frais courants > 10 % trahissent un faux
    // positif (on a capté un autre chiffre) — on rejette.
    if (v != null && v >= 0 && v <= 10) return v;
  }
  return null;
}

/**
 * Indicateur synthétique de risque (SRI/SRRI), 1 à 7. Cherche la classe
 * ASSIGNÉE, pas l'échelle « 1 2 3 4 5 6 7 » ni le « sur 7 » du dénominateur :
 *   • KID : « classé ce produit dans la classe de risque 4 sur 7 ».
 *   • KIID : « Le fonds est classé dans la catégorie 5 ».
 */
export function findSri(text: string): number | null {
  const patterns = [
    /classe\s+de\s+risque\s+([1-7])\s+sur\s+7/i,
    /class[ée]e?[^.\n]{0,60}?\b([1-7])\s+sur\s+7/i,
    /class[ée]e?\s+dans\s+la\s+cat[ée]gorie\s+([1-7])\b/i,
    /cat[ée]gorie\s+de\s+risque\s+([1-7])\b/i,
    /\bSRI\b\s*[:=]?\s*([1-7])\b/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 7) return n;
    }
  }
  return null;
}

// Frais ponctuels (entrée / sortie) sous forme de TEXTE, consommé ensuite par
// parsePctString (« 2 % », « Néant » → 0, sinon null). `kind` choisit le libellé.
function findPointFee(text: string, kind: "entree" | "sortie"): string | null {
  const label = kind === "entree" ? "entr[ée]e" : "sortie";
  // « Frais d'entrée : 2 % » / « Coûts de sortie 0,00 % » / « Frais d'entrée Néant ».
  const withPct = new RegExp(
    `(?:frais|co[uû]ts?)\\s+(?:d['e]\\s*)?${label}[^%\\n]{0,40}?(\\d{1,2}(?:[.,]\\d{1,2})?)\\s*%`,
    "i",
  );
  const m = text.match(withPct);
  if (m) return `${m[1].replace(",", ".")} %`;
  const neant = new RegExp(
    `(?:frais|co[uû]ts?)\\s+(?:d['e]\\s*)?${label}[^\\n]{0,40}?(n[ée]ant|aucun|sans\\s+frais)`,
    "i",
  );
  if (neant.test(text)) return "Néant";
  return null;
}

/**
 * Extraction déterministe des champs d'un DICI/KID utiles à l'analyse de frais.
 * Les champs non trouvés valent null ; l'appelant décide si le résultat est
 * suffisant (cf. diciFeesComplete) ou s'il faut escalader vers l'IA.
 */
export function extractDiciFields(text: string): DiciDeterministic {
  return {
    isin: findIsin(text),
    name: null, // le nom fiable vient du rattachement en base (par ISIN) ; l'IA
                // s'en charge pour l'analyse complète. Inutile de deviner ici.
    ongoing_charges: findOngoingCharges(text),
    sri: findSri(text),
    entry_fees_max: findPointFee(text, "entree"),
    exit_fees_max: findPointFee(text, "sortie"),
  };
}

/**
 * Le résultat déterministe couvre-t-il le besoin « Frais » (rattacher + lire les
 * frais) ? Il faut au minimum un ISIN valide ET les frais courants — les deux
 * champs indispensables au simulateur. Le reste (entrée/sortie/SRI) est un bonus.
 * En dessous, on escalade vers l'IA pour ne pas dégrader la qualité.
 */
export function diciFeesComplete(d: DiciDeterministic): boolean {
  return d.isin != null && d.ongoing_charges != null;
}
