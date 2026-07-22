// Donation nette de droits : quand le DONATEUR prend les droits à sa charge,
// ce paiement n'est PAS une libéralité supplémentaire (doctrine constante,
// BOI-ENR-DG-50-10-20) — l'assiette taxable reste le net reçu par le donataire.
// D'où deux questions symétriques : « je veux transmettre X net, combien cela
// me coûte-t-il ? » et « j'ai un budget total Y, quel net puis-je donner ? »
// (la seconde exige d'inverser la fonction droits, faite par recherche binaire).

import type { CalculatorDef } from "../types";
import { eur, pct, num, str } from "../types";
import { LIEN_OPTIONS, baremeForLien, abattementDonation, applyBareme, type LienParente } from "../bareme";

const def: CalculatorDef = {
  id: "donation-nette",
  title: "Donation nette (montant après droits)",
  description:
    "Donation avec prise en charge des droits par le donateur : coût total pour un net voulu, ou net maximal pour un budget donné.",
  category: "transmission",
  aliases: ["droits pris en charge par le donateur", "donation net de frais", "budget donation", "net donataire"],
  fields: [
    { key: "lien", label: "Lien de parenté avec le donataire", type: "enum", options: LIEN_OPTIONS },
    {
      key: "mode",
      label: "Point de départ",
      type: "enum",
      options: [
        { value: "net_voulu", label: "Je veux transmettre un net donné" },
        { value: "budget_total", label: "J'ai un budget total donateur" },
      ],
      default: "net_voulu",
    },
    {
      key: "montant",
      label: "Montant (net voulu ou budget total selon le mode)",
      type: "eur",
      min: 0,
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
    const lien = (str(v, "lien") || "enfant") as LienParente;
    const mode = str(v, "mode") || "net_voulu";
    const montant = num(v, "montant");
    const abattement = Math.max(0, abattementDonation(lien) - num(v, "abattement_consomme"));
    const bareme = baremeForLien(lien);

    // Droits pour un net donné : l'assiette est le net (les droits pris en
    // charge par le donateur ne s'y ajoutent pas — c'est tout l'intérêt).
    const droitsPour = (net: number) => applyBareme(bareme, Math.max(0, net - abattement)).droits;

    let net: number;
    if (mode === "budget_total") {
      // Inversion : coût(net) = net + droits(net) est strictement croissant en
      // net → recherche binaire sur [0, budget] (60 itérations ≈ précision 2⁻⁶⁰).
      let lo = 0;
      let hi = montant;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (mid + droitsPour(mid) > montant) hi = mid;
        else lo = mid;
      }
      net = lo;
    } else {
      net = montant;
    }
    const droits = droitsPour(net);
    const cout = net + droits;

    return {
      kpis: [
        { label: "Net au donataire", value: eur(net), tone: "ok" },
        { label: "Droits pris en charge par le donateur", value: eur(droits), tone: droits > 0 ? "bad" : "ok" },
        { label: "Coût total donateur", value: eur(cout) },
        {
          label: "Taux effectif (droits / coût total)",
          value: cout > 0 ? pct((droits / cout) * 100) : pct(0),
        },
      ],
      charts: [
        {
          type: "donut",
          title: "Répartition du coût total donateur",
          items: [
            { label: "Net au donataire", value: net },
            { label: "Droits pris en charge", value: droits },
          ],
        },
      ],
      notes: [
        "La prise en charge des droits par le donateur n'est pas taxable : l'assiette des droits reste le net reçu par le donataire (doctrine constante).",
        `Abattement disponible retenu : ${eur(abattement)} (${LIEN_OPTIONS.find((o) => o.value === lien)?.label ?? lien}).`,
      ],
      refs: ["Art. 777, 779 CGI", "BOI-ENR-DG-50-10-20"],
    };
  },
};

export default def;
