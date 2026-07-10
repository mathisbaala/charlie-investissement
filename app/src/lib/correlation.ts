// Corrélation & covariance — fonctions pures du moteur d'allocation.
//
// Le spec demande explicitement « une fonction dédiée pour calculer la
// corrélation entre les actifs ». On la fournit ici en TypeScript (testable sans
// DB) ; le jumeau SQL `inv_fund_correlation` (migration) calcule les mêmes
// coefficients côté base à partir de investissement_fund_prices, sur la même
// grille hebdomadaire que inv_portfolio_analyze. Les deux doivent rester
// cohérents.
//
// Convention : les rendements sont des variations relatives période à période
// (hebdo par défaut). On travaille toujours sur la fenêtre commune (mêmes dates)
// pour que la corrélation ait un sens.

/**
 * Corrélation de Pearson entre deux séries alignées (même longueur, même grille
 * de dates). Renvoie `null` — et jamais un nombre trompeur — quand le
 * coefficient n'est pas défini :
 *  - longueurs différentes (séries non alignées) ;
 *  - moins de 2 points (variance non estimable) ;
 *  - variance nulle d'une des séries (série constante → dénominateur 0).
 */
export function pearson(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 2) return null;
  const n = a.length;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA <= 0 || varB <= 0) return null;

  const r = cov / Math.sqrt(varA * varB);
  // Garde-fou numérique : borne dans [-1, 1] (les erreurs d'arrondi flottant
  // peuvent produire 1.0000000002).
  return Math.max(-1, Math.min(1, r));
}

/**
 * Convertit une série de valeurs liquidatives (VL/NAV) en rendements simples
 * période à période : r_t = nav_t / nav_{t-1} − 1. Une série de N VL donne N−1
 * rendements. Les pas où la VL précédente est nulle/absente sont ignorés (pas de
 * division par zéro), ce qui peut désaligner deux séries — d'où l'usage sur une
 * grille commune LOCF en amont.
 */
export function navToReturns(navs: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < navs.length; i++) {
    const prev = navs[i - 1];
    if (prev > 0) out.push(navs[i] / prev - 1);
  }
  return out;
}

/**
 * Matrice de corrélation N×N (symétrique, diagonale = 1) à partir des séries de
 * rendements de chaque actif (index i ↔ actif i). Les cases non calculables
 * valent `null` (cf. `pearson`). Ne suppose rien de plus que l'alignement des
 * séries entre elles.
 */
export function correlationMatrix(returns: number[][]): (number | null)[][] {
  const n = returns.length;
  const m: (number | null)[][] = Array.from({ length: n }, () =>
    Array<number | null>(n).fill(null),
  );
  for (let i = 0; i < n; i++) {
    m[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const r = pearson(returns[i], returns[j]);
      m[i][j] = r;
      m[j][i] = r;
    }
  }
  return m;
}

/**
 * Matrice de covariance Σ (N×N) reconstruite depuis les volatilités
 * individuelles et la matrice de corrélation : Σ_ij = σ_i · σ_j · ρ_ij, et
 * Σ_ii = σ_i². Sert d'entrée à l'optimisation moyenne-variance.
 *
 * Choix explicite quand une corrélation est inconnue (`null`) hors diagonale :
 * on retient ρ = `fallbackCorr` (0 par défaut = actifs supposés indépendants).
 * C'est conservateur pour l'estimation du risque total sans être absurde ; le
 * cas est signalé en amont (comptage des paires manquantes) pour ne pas masquer
 * un trou de données.
 */
export function covarianceMatrix(
  vols: number[],
  corr: (number | null)[][],
  fallbackCorr = 0,
): number[][] {
  const n = vols.length;
  if (corr.length !== n) {
    throw new Error(
      `covarianceMatrix: ${n} volatilités mais matrice de corrélation ${corr.length}×${corr.length}`,
    );
  }
  return vols.map((si, i) =>
    vols.map((sj, j) => {
      if (i === j) return si * si;
      const rho = corr[i][j];
      return si * sj * (rho ?? fallbackCorr);
    }),
  );
}

/**
 * Corrélation moyenne des paires distinctes (i<j) effectivement calculées.
 * Indicateur synthétique de diversification : plus elle est basse, mieux le
 * portefeuille est diversifié. `null` si aucune paire exploitable.
 */
export function averagePairwiseCorrelation(
  corr: (number | null)[][],
): number | null {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < corr.length; i++) {
    for (let j = i + 1; j < corr.length; j++) {
      const c = corr[i][j];
      if (c !== null && Number.isFinite(c)) {
        sum += c;
        count += 1;
      }
    }
  }
  return count > 0 ? sum / count : null;
}
