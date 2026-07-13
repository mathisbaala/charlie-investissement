// HRP — Hierarchical Risk Parity (López de Prado, 2016).
//
// Méthode de pondération alternative au max-Sharpe : elle n'utilise NI les
// rendements attendus NI l'inversion de la matrice de covariance (les deux
// points faibles de Markowitz sur données bruitées). Trois étapes :
//
//  1. Clustering hiérarchique des actifs sur la distance de corrélation
//     d_ij = √((1 − ρ_ij)/2) — les fonds qui se comportent pareil forment des
//     « familles » ;
//  2. Quasi-diagonalisation : on ordonne les actifs selon l'arbre (les fonds
//     similaires deviennent voisins) ;
//  3. Bissection récursive : le budget de risque se répartit de haut en bas
//     entre les deux moitiés de chaque segment, en proportion inverse de leur
//     variance (une moitié risquée reçoit moins), puis à l'intérieur de chaque
//     moitié, récursivement.
//
// Fonctions PURES et déterministes (mêmes conventions que optimizer.ts :
// fractions partout, pas de hasard, départage stable par indice).

/** Nœud de l'arbre de fusion : feuille (index d'actif) ou fusion de deux nœuds. */
type ClusterNode = { leaf: number } | { left: ClusterNode; right: ClusterNode };

/**
 * Clustering hiérarchique agglomératif en LIEN SIMPLE (single linkage, comme le
 * papier d'origine) sur une matrice de distances. Renvoie l'ordre des feuilles
 * après quasi-diagonalisation (parcours gauche-droite de l'arbre).
 * Départage déterministe : à distance égale, la paire d'indices la plus basse.
 */
export function seriation(dist: number[][]): number[] {
  const n = dist.length;
  if (n === 0) return [];
  if (n === 1) return [0];

  // Chaque cluster : son nœud d'arbre + les indices d'actifs qu'il contient.
  const nodes: ClusterNode[] = Array.from({ length: n }, (_, i) => ({ leaf: i }));
  const members: number[][] = Array.from({ length: n }, (_, i) => [i]);
  const alive = new Set<number>(Array.from({ length: n }, (_, i) => i));

  // Distance single-linkage entre deux clusters = min des distances croisées.
  const linkDist = (a: number, b: number): number => {
    let d = Infinity;
    for (const i of members[a]) {
      for (const j of members[b]) {
        if (dist[i][j] < d) d = dist[i][j];
      }
    }
    return d;
  };

  while (alive.size > 1) {
    let bestA = -1;
    let bestB = -1;
    let bestD = Infinity;
    const ids = [...alive].sort((x, y) => x - y);
    for (let x = 0; x < ids.length; x++) {
      for (let y = x + 1; y < ids.length; y++) {
        const d = linkDist(ids[x], ids[y]);
        if (d < bestD - 1e-15) {
          bestD = d;
          bestA = ids[x];
          bestB = ids[y];
        }
      }
    }
    // Fusion : le nouveau cluster remplace A, B disparaît.
    nodes[bestA] = { left: nodes[bestA], right: nodes[bestB] };
    members[bestA] = [...members[bestA], ...members[bestB]];
    alive.delete(bestB);
  }

  // Parcours gauche-droite de l'arbre → ordre quasi-diagonal.
  const order: number[] = [];
  const walk = (node: ClusterNode): void => {
    if ("leaf" in node) order.push(node.leaf);
    else {
      walk(node.left);
      walk(node.right);
    }
  };
  walk(nodes[[...alive][0]]);
  return order;
}

/**
 * Variance d'un segment d'actifs sous pondération inverse-variance interne
 * (le portefeuille « naïvement optimal » du cluster, comme dans le papier).
 */
function clusterVariance(cov: number[][], idx: number[]): number {
  const inv = idx.map((i) => 1 / Math.max(cov[i][i], 1e-12));
  const sum = inv.reduce((s, x) => s + x, 0);
  const w = inv.map((x) => x / sum);
  let v = 0;
  for (let a = 0; a < idx.length; a++) {
    for (let b = 0; b < idx.length; b++) {
      v += w[a] * cov[idx[a]][idx[b]] * w[b];
    }
  }
  return Math.max(v, 0);
}

/**
 * Poids HRP (fractions sommant à 1) à partir de la covariance Σ et de la
 * matrice de corrélation COMPLÈTE (les `null` doivent avoir été remplacés en
 * amont — priors de classe). Aucun rendement attendu n'entre en jeu.
 */
export function hrpWeights(cov: number[][], corr: number[][]): number[] {
  const n = cov.length;
  if (n === 0) return [];
  if (n === 1) return [1];

  // 1-2) Distance de corrélation puis ordre quasi-diagonal.
  const dist = corr.map((row, i) =>
    row.map((rho, j) => (i === j ? 0 : Math.sqrt(Math.max(0, (1 - rho) / 2)))),
  );
  const order = seriation(dist);

  // 3) Bissection récursive : chaque segment partage son budget entre ses deux
  // moitiés en proportion inverse de leur variance de cluster.
  const w = new Array<number>(n).fill(1);
  const stack: number[][] = [order];
  while (stack.length > 0) {
    const seg = stack.pop()!;
    if (seg.length < 2) continue;
    const mid = Math.floor(seg.length / 2);
    const left = seg.slice(0, mid);
    const right = seg.slice(mid);
    const vL = clusterVariance(cov, left);
    const vR = clusterVariance(cov, right);
    const total = vL + vR;
    // Deux moitiés sans variance mesurable → partage égal.
    const alpha = total > 1e-18 ? 1 - vL / total : 0.5;
    for (const i of left) w[i] *= alpha;
    for (const i of right) w[i] *= 1 - alpha;
    stack.push(left, right);
  }

  // Normalisation finale (protection contre la dérive flottante).
  const sum = w.reduce((s, x) => s + x, 0) || 1;
  return w.map((x) => x / sum);
}
