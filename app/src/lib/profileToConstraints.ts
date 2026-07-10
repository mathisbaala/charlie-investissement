// Profil client → contraintes du moteur d'allocation. Traduit un profil (niveau
// de risque, classes d'actifs souhaitées, tolérance) en répartition cible par
// classe + plafond de SRI. Fonction pure et testable — le cœur du « je saisis le
// client, ça génère l'allocation ».

import type { RiskProfile, RichClientProfile } from "./clientProfile";
import type { AssetClass, OptimizerConstraints } from "./optimizer";

// Répartition cible par défaut selon le niveau de risque (profil MIF).
const RISK_TARGETS: Record<RiskProfile, Partial<Record<AssetClass, number>>> = {
  prudent: { obligations: 55, monetaire: 20, diversifie: 15, actions: 10 },
  modere: { obligations: 45, actions: 25, diversifie: 20, monetaire: 10 },
  equilibre: { actions: 45, obligations: 30, diversifie: 20, monetaire: 5 },
  dynamique: { actions: 65, diversifie: 20, obligations: 15 },
  offensif: { actions: 80, diversifie: 15, obligations: 5 },
};

// SRI moyen pondéré plafond, par niveau de risque.
const RISK_MAX_SRI: Record<RiskProfile, number> = {
  prudent: 3,
  modere: 4,
  equilibre: 4,
  dynamique: 5,
  offensif: 7,
};

// Classes du profil (valeurs du formulaire) → classes canoniques du moteur.
const PROFILE_CLASS_TO_BUCKET: Record<string, AssetClass> = {
  actions: "actions",
  obligations: "obligations",
  scpi: "immobilier",
  immobilier: "immobilier",
  monetaire: "monetaire",
  multi_actifs: "diversifie",
  // private_equity → pas de bucket dédié (écarté).
};

/** Renormalise une table de cibles pour que la somme fasse 100. */
export function renormalize(
  targets: Partial<Record<AssetClass, number>>,
): Partial<Record<AssetClass, number>> {
  const entries = Object.entries(targets).filter(([, v]) => (v ?? 0) > 0);
  const sum = entries.reduce((s, [, v]) => s + (v as number), 0);
  if (sum <= 0) return {};
  const out: Partial<Record<AssetClass, number>> = {};
  for (const [k, v] of entries) out[k as AssetClass] = Math.round(((v as number) / sum) * 1000) / 10;
  return out;
}

/**
 * Cibles par classe pour un profil : part de la répartition type du niveau de
 * risque, restreinte aux classes souhaitées si le client en a coché (renormalisé).
 */
export function targetsForProfile(
  risk: RiskProfile,
  chosenClasses: string[] = [],
): Partial<Record<AssetClass, number>> {
  const base = { ...RISK_TARGETS[risk] };

  const buckets = chosenClasses
    .map((c) => PROFILE_CLASS_TO_BUCKET[c])
    .filter((b): b is AssetClass => !!b);

  if (buckets.length === 0) return renormalize(base);

  // Restreint aux classes choisies : on garde leur poids de base, et on donne un
  // poids plancher aux classes choisies absentes de la répartition type.
  const wanted = new Set(buckets);
  const restricted: Partial<Record<AssetClass, number>> = {};
  for (const b of wanted) restricted[b] = base[b] ?? 10;
  return renormalize(restricted);
}

/**
 * Traduit un profil client complet en contraintes d'optimisation partielles
 * (cibles de classe + plafond SRI). Profil de risque absent → « equilibre » par
 * défaut (choix prudent et neutre). Les autres réglages (min/max lignes, plafond
 * par fonds) restent aux valeurs par défaut du moteur, surchargeables par l'UI.
 */
export function profileToConstraints(
  profile: Pick<RichClientProfile, "risk_profile" | "asset_classes" | "max_ter">,
): Partial<OptimizerConstraints> {
  const risk: RiskProfile = profile.risk_profile ?? "equilibre";
  return {
    classTargets: targetsForProfile(risk, profile.asset_classes ?? []),
    maxWeightedSri: RISK_MAX_SRI[risk],
  };
}
