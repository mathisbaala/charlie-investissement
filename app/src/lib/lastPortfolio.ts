// Dernier portefeuille construit dans l'onglet « Portefeuille », mémorisé en
// localStorage pour être IMPORTÉ dans l'onglet « Frais » (le contexte du studio
// ne survit pas au changement d'onglet). On ne garde que ce qui sert à rejouer
// l'allocation ailleurs : lignes (ISIN + libellé + poids %), montant, contrat.

const KEY = "charlie_last_portfolio";

export interface StoredPortfolioLine {
  isin: string;
  name: string;
  weight: number; // % (0–100)
}

export interface StoredPortfolio {
  lines: StoredPortfolioLine[];
  montant: number | null;
  contract: string | null; // clé « Assureur::Contrat » si un contrat est sélectionné
  savedAt: number;         // epoch ms — pour dater l'import côté « Frais »
}

export function saveLastPortfolio(p: Omit<StoredPortfolio, "savedAt">): void {
  if (typeof window === "undefined") return;
  if (!p.lines?.length) return;
  try {
    const clean: StoredPortfolio = {
      lines: p.lines
        .filter((l) => l.isin)
        .map((l) => ({ isin: l.isin, name: l.name || l.isin, weight: Math.max(0, l.weight) })),
      montant: p.montant != null && Number.isFinite(p.montant) && p.montant > 0 ? Math.round(p.montant) : null,
      contract: p.contract && p.contract.includes("::") ? p.contract : null,
      savedAt: Date.now(),
    };
    if (clean.lines.length === 0) return;
    window.localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    /* quota / mode privé : import indisponible, sans conséquence */
  }
}

export function loadLastPortfolio(): StoredPortfolio | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as StoredPortfolio;
    if (!Array.isArray(p?.lines) || p.lines.length === 0) return null;
    return p;
  } catch {
    return null;
  }
}
