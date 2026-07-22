// Donation-cession : purger la plus-value mobilière en donnant les titres AVANT
// la cession (art. 150-0 D CGI — le prix de revient du donataire est la valeur
// au jour de la donation). Trois scénarios comparés.

import type { CalculatorDef } from "../types";
import { eur, pct, num, str } from "../types";
import {
  LIEN_OPTIONS,
  baremeForLien,
  abattementDonation,
  applyBareme,
  type LienParente,
} from "../bareme";

const def: CalculatorDef = {
  id: "donation-cession",
  title: "Donation-cession",
  description: "Purge de la plus-value mobilière par donation avant cession (art. 150-0 D CGI) — 3 scénarios comparés.",
  category: "transmission",
  aliases: ["purge plus-value", "donation avant cession", "150-0 D", "PV mobilière"],
  fields: [
    { key: "valeur", label: "Valeur actuelle des titres", type: "eur", min: 0 },
    { key: "prix_revient", label: "Prix de revient (acquisition)", type: "eur", min: 0 },
    { key: "lien", label: "Lien de parenté avec le donataire", type: "enum", options: LIEN_OPTIONS, default: "enfant" },
    {
      key: "taux_pv",
      label: "Taux d'imposition de la plus-value",
      type: "pct",
      default: 30,
      min: 0,
      max: 60,
      help: "PFU 30 % (12,8 % IR + 17,2 % PS) par défaut ; ajuster si option barème ou CEHR.",
    },
    {
      key: "abattement_consomme",
      label: "Abattement de donation déjà consommé",
      type: "eur",
      default: 0,
      min: 0,
      help: "Donations de moins de 15 ans au même donataire (art. 784 CGI).",
    },
  ],
  compute(v) {
    const valeur = num(v, "valeur");
    const prixRevient = num(v, "prix_revient");
    const lien = (str(v, "lien") || "enfant") as LienParente;
    const tauxPv = num(v, "taux_pv") / 100;
    const abattement = Math.max(0, abattementDonation(lien) - num(v, "abattement_consomme"));
    const bareme = baremeForLien(lien);
    const pv = Math.max(0, valeur - prixRevient);

    // A — Cession puis donation du produit net : impôt PV, puis droits sur le net.
    const impotPvA = pv * tauxPv;
    const netCede = valeur - impotPvA;
    const droitsA = applyBareme(bareme, Math.max(0, netCede - abattement)).droits;
    const recuA = netCede - droitsA;

    // B — Donation puis cession par le donataire : droits sur la valeur, PV purgée
    // (prix de revient rehaussé à la valeur de donation), cession au même prix.
    const droitsB = applyBareme(bareme, Math.max(0, valeur - abattement)).droits;
    const recuB = valeur - droitsB;

    // C — Cession sans transmission (référence patrimoniale).
    const recuC = valeur - impotPvA;

    const gain = recuB - recuA;

    return {
      kpis: [
        { label: "Reçu par le donataire (donation puis cession)", value: eur(recuB), tone: "ok" },
        { label: "Reçu (cession puis donation)", value: eur(recuA) },
        { label: "Gain de la purge", value: eur(gain), tone: gain >= 0 ? "ok" : "bad" },
        { label: "Plus-value purgée", value: eur(pv), hint: `Impôt évité : ${eur(impotPvA)}` },
      ],
      tables: [
        {
          title: "Comparaison des scénarios",
          columns: ["Scénario", "Impôt PV", "Droits de donation", "Reçu net"],
          rows: [
            ["B — Donation puis cession (purge)", eur(0), eur(droitsB), eur(recuB)],
            ["A — Cession puis donation", eur(impotPvA), eur(droitsA), eur(recuA)],
            ["C — Cession conservée (pas de donation)", eur(impotPvA), "—", eur(recuC)],
          ],
        },
      ],
      charts: [
        {
          type: "bar",
          title: "Net reçu par le donataire",
          items: [
            { label: "Donation puis cession", value: recuB },
            { label: "Cession puis donation", value: recuA },
          ],
        },
      ],
      notes: [
        `Taux PV retenu : ${pct(tauxPv * 100)}. Cession par le donataire supposée au prix de la donation (pas de nouvelle plus-value).`,
        "La donation doit être ANTÉRIEURE à la cession et sincère (pas de réappropriation du prix par le donateur) — sinon abus de droit.",
        "Si le donateur prend les droits à sa charge, ce paiement n'est pas taxable et augmente d'autant le net reçu.",
      ],
      refs: ["Art. 150-0 D CGI", "Art. 784 CGI"],
    };
  },
};

export default def;
