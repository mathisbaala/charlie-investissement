// Sélection de la trajectoire « phare » d'un fonds euros pour un assureur.
//
// Un assureur peut servir plusieurs fonds euros (générique, dynamique, nouvelle
// génération…), chacun avec son historique de taux. Pour une vue compacte
// (cellule de comparateur, badge), on n'en montre qu'un : le plus représentatif.
// Règle : le fonds euros dont le DERNIER millésime servi est le plus récent ;
// à millésime égal, celui qui a servi le meilleur taux. Fonction pure et testée
// (aucun accès base) — la lecture des lignes se fait côté page.

export type FeRate = { fonds_euros_nom: string; annee: number; taux_pct: number };

/**
 * Parmi toutes les lignes de taux d'un assureur (tous fonds euros confondus),
 * retourne la série du fonds euros le plus représentatif, triée par année
 * croissante. Retourne [] si aucune ligne exploitable.
 */
export function bestFeSeries(rows: FeRate[]): FeRate[] {
  const byNom = new Map<string, FeRate[]>();
  for (const r of rows) {
    if (r == null || r.annee == null || r.taux_pct == null) continue;
    const arr = byNom.get(r.fonds_euros_nom) ?? [];
    arr.push(r);
    byNom.set(r.fonds_euros_nom, arr);
  }
  let best: FeRate[] = [];
  let bestScore = -Infinity;
  for (const series of byNom.values()) {
    const sorted = [...series].sort((a, b) => a.annee - b.annee);
    const latest = sorted.at(-1);
    if (!latest) continue;
    // Score = millésime le plus récent d'abord (×100 domine), puis meilleur taux
    // servi à millésime égal (< 100 en pratique). Un seul critère, sans ambiguïté.
    const score = latest.annee * 100 + Number(latest.taux_pct);
    if (score > bestScore) {
      best = sorted;
      bestScore = score;
    }
  }
  return best;
}
