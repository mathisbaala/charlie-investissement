// Registre des calculateurs patrimoniaux. Chaque def de `defs/` s'enregistre
// ici — l'UI (grille, formulaires) et le routing IA lisent ce registre, jamais
// les modules directement. Trié par titre pour une grille stable.

import type { CalculatorDef } from "./types";

import assuranceVieSuccession from "./defs/assurance-vie-succession";
import avVsCapitalisation from "./defs/av-vs-capitalisation";
import comparaisonSasSarl from "./defs/comparaison-sas-sarl";
import compareRegimesMatrimoniaux from "./defs/compare-regimes-matrimoniaux";
import dernierVivant from "./defs/dernier-vivant";
import differePaiement from "./defs/differe-paiement";
import donationCession from "./defs/donation-cession";
import donationGfa from "./defs/donation-gfa";
import donationNette from "./defs/donation-nette";
import donationPartageSoulte from "./defs/donation-partage-soulte";
import dptReinco from "./defs/dpt-reinco";
import droitsCession from "./defs/droits-cession";
import droitsDonationSuccession from "./defs/droits-donation-succession";
import droitsPartage from "./defs/droits-partage";
import exoPartage from "./defs/exo-partage";
import graduelleResiduelle from "./defs/graduelle-residuelle";
import holdingAnimatrice from "./defs/holding-animatrice-evaluation";
import ifi from "./defs/ifi";
import ifiPlacementsCoefficient from "./defs/ifi-placements-coefficient";
import masseSuccessorale from "./defs/masse-successorale";
import mecenat from "./defs/mecenat";
import paiementFractionne from "./defs/paiement-fractionne";
import penalitesSuccession from "./defs/penalites-succession";
import preciput from "./defs/preciput";
import rachatCapitalisation from "./defs/rachat-capitalisation";
import reversionUsufruit from "./defs/reversion-usufruit";
import territorialiteDmtg from "./defs/territorialite-dmtg";
import transmissionCapitalisation from "./defs/transmission-capitalisation";

export const CALCULATORS: CalculatorDef[] = [
  assuranceVieSuccession,
  avVsCapitalisation,
  comparaisonSasSarl,
  compareRegimesMatrimoniaux,
  dernierVivant,
  differePaiement,
  donationCession,
  donationGfa,
  donationNette,
  donationPartageSoulte,
  dptReinco,
  droitsCession,
  droitsDonationSuccession,
  droitsPartage,
  exoPartage,
  graduelleResiduelle,
  holdingAnimatrice,
  ifi,
  ifiPlacementsCoefficient,
  masseSuccessorale,
  mecenat,
  paiementFractionne,
  penalitesSuccession,
  preciput,
  rachatCapitalisation,
  reversionUsufruit,
  territorialiteDmtg,
  transmissionCapitalisation,
].sort((a, b) => a.title.localeCompare(b.title, "fr"));

export const CALCULATOR_BY_ID: Record<string, CalculatorDef> = Object.fromEntries(
  CALCULATORS.map((c) => [c.id, c]),
);
