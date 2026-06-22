import { describe, it, expect } from "vitest";
import { profileToScreenerFilters, EMPTY_PROFILE } from "../lib/clientProfile";

// profileToScreenerFilters traduit le profil PARTAGÉ en filtres durs du screener
// (« Trouver les fonds adaptés » redirige vers /recherche pré-filtré). Ne traduit
// que les champs à équivalent filtre ; âge/horizon/objectif/montant/TMI restent
// du contexte NLP.
describe("profileToScreenerFilters", () => {
  it("ne produit aucun filtre pour un profil vide", () => {
    expect(profileToScreenerFilters(EMPTY_PROFILE)).toEqual({});
  });

  it("traduit le risque en PLAFOND SRI (pas de plancher)", () => {
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, risk_profile: "prudent" }).sri_max).toBe(3);
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, risk_profile: "modere" }).sri_max).toBe(4);
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, risk_profile: "equilibre" }).sri_max).toBe(5);
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, risk_profile: "dynamique" }).sri_max).toBe(6);
  });

  it("n'impose aucun plafond SRI pour un profil offensif", () => {
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, risk_profile: "offensif" }).sri_max).toBeUndefined();
  });

  it("traduit la préférence ESG en classification SFDR", () => {
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, esg: "art8" }).sfdr).toEqual([8, 9]);
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, esg: "art9" }).sfdr).toEqual([9]);
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, esg: "indifferent" }).sfdr).toBeUndefined();
  });

  it("traduit la préférence « labellisé » en filtre labels officiels", () => {
    const f = profileToScreenerFilters({ ...EMPTY_PROFILE, esg: "labelise" });
    expect(f.labels).toEqual(["isr", "greenfin", "finansol"]);
    expect(f.sfdr).toBeUndefined();
  });

  it("traduit la tolérance de perte en drawdown_max (illimitée → aucun filtre)", () => {
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, perte_max: "20" }).drawdown_max).toBe(20);
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, perte_max: "illimitee" }).drawdown_max).toBeUndefined();
  });

  it("reporte les enveloppes telles quelles", () => {
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, envelopes: ["PEA", "PER"] }).envelopes).toEqual(["PEA", "PER"]);
  });

  it("mappe les classes d'actifs vers asset_class_broad", () => {
    const out = profileToScreenerFilters({ ...EMPTY_PROFILE, asset_classes: ["actions", "scpi", "multi_actifs"] });
    expect(out.asset_class).toEqual(["action", "immobilier", "diversifie"]);
  });

  it("traduit la préférence de gestion en management_style", () => {
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, management: "passif" }).management_style).toEqual(["passif"]);
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, management: "actif" }).management_style).toEqual(["actif"]);
  });

  it("reporte le plafond de frais (max_ter → ter_max) et le sans-frais-d'entrée", () => {
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, max_ter: 1 }).ter_max).toBe(1);
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, no_entry_fee: true }).no_entry_fee).toBe(true);
    // no_entry_fee false ne doit produire aucun filtre.
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, no_entry_fee: false }).no_entry_fee).toBeUndefined();
  });

  it("n'émet pas de filtre dur pour l'expérience (seulement une préférence douce)", () => {
    // novice → préférence douce (écarte les produits complexes au CLASSEMENT), jamais
    // un filtre dur qui restreindrait l'univers.
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, experience: "novice" })).toEqual({
      prefs: { novice: true },
    });
    // informé / expérimenté : aucune préférence émise.
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, experience: "informe" })).toEqual({});
  });

  it("traduit les signaux profil en préférences DOUCES (prefs), pas en filtres durs", () => {
    // objectif revenus → income ; income_need régulier → income aussi.
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, objectif: "revenus" }).prefs).toEqual({ income: true });
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, income_need: "regulier" }).prefs).toEqual({ income: true });
    // TMI ≥ 30 → favoriser PER/PEA (boost, pas filtre).
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, tmi: "41" }).prefs).toEqual({ envelopes: ["PEA", "PER"] });
    // TMI < 30 → aucune préférence enveloppe.
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, tmi: "11" }).prefs).toBeUndefined();
    // Petit montant (< 10 000 €) → accessible retail.
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, amount_eur: 5_000 }).prefs).toEqual({ small_ticket: true });
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, amount_eur: 50_000 }).prefs).toBeUndefined();
  });

  it("traduit l'exclusion « fossiles » en exclude_sectors (les autres restent NLP)", () => {
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, exclusions: ["fossiles"] }).exclude_sectors).toEqual(["Énergie"]);
    // tabac/armes/jeux/alcool n'ont pas de secteur fiable → aucun filtre dur
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, exclusions: ["tabac", "armes"] }).exclude_sectors).toBeUndefined();
    // dédup si « fossiles » apparaît plusieurs fois
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, exclusions: ["fossiles", "tabac", "fossiles"] }).exclude_sectors).toEqual(["Énergie"]);
  });

  it("plafonne le SRI selon l'horizon (capacité), seul ou combiné au risque par min()", () => {
    // horizon court seul : capacité limite le SRI même sans risk_profile
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, horizon_years: 2 }).sri_max).toBe(2);
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, horizon_years: 5 }).sri_max).toBe(4);
    // horizon long : aucun plafond de capacité
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, horizon_years: 20 }).sri_max).toBeUndefined();
    // combiné : le plus contraignant gagne (dynamique=6, horizon 2 ans=2 → 2)
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, risk_profile: "dynamique", horizon_years: 2 }).sri_max).toBe(2);
    // tolérance plus contraignante que la capacité (prudent=3, horizon 20 ans=∞ → 3)
    expect(profileToScreenerFilters({ ...EMPTY_PROFILE, risk_profile: "prudent", horizon_years: 20 }).sri_max).toBe(3);
  });

  it("combine plusieurs champs en un seul jeu de filtres", () => {
    const out = profileToScreenerFilters({
      ...EMPTY_PROFILE, risk_profile: "equilibre", esg: "art8", perte_max: "10", envelopes: ["PEA"],
      management: "passif", max_ter: 1, no_entry_fee: true,
    });
    expect(out).toEqual({
      sri_max: 5, sfdr: [8, 9], drawdown_max: 10, envelopes: ["PEA"],
      management_style: ["passif"], ter_max: 1, no_entry_fee: true,
    });
  });
});
