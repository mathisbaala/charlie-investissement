import { describe, it, expect } from "vitest";
import {
  toMatchingProfile,
  profileToScreenerFilters,
  EMPTY_PROFILE,
  type RichClientProfile,
} from "../lib/clientProfile";

// toMatchingProfile convertit le profil PARTAGÉ (RichClientProfile) vers le payload
// attendu par /api/matching (ClientProfile). C'est le pont qui unifie le profil
// entre le panneau de recherche et la page /matching.

describe("toMatchingProfile", () => {
  it("mappe les enveloppes du format UI vers les clés API", () => {
    const p: RichClientProfile = { ...EMPTY_PROFILE, envelopes: ["PEA", "AV-FR", "PER", "CTO", "PEA-PME", "AV-LUX"] };
    expect(toMatchingProfile(p).envelopes).toEqual(["pea", "av_fr", "per", "cto", "pea_pme", "av_lux"]);
  });

  it("rabat le profil 'modéré' sur 'équilibré' (absent du barème matching)", () => {
    expect(toMatchingProfile({ ...EMPTY_PROFILE, risk_profile: "modere" }).risk_profile).toBe("equilibre");
  });

  it("conserve les autres profils de risque", () => {
    for (const r of ["prudent", "equilibre", "dynamique", "offensif"] as const) {
      expect(toMatchingProfile({ ...EMPTY_PROFILE, risk_profile: r }).risk_profile).toBe(r);
    }
  });

  it("applique les valeurs par défaut quand le profil est vide", () => {
    const out = toMatchingProfile(EMPTY_PROFILE);
    expect(out.age).toBe(45);
    expect(out.horizon_years).toBe(10);
    expect(out.risk_profile).toBe("equilibre");
    expect(out.amount_eur).toBeUndefined();
    expect(out.envelopes).toEqual([]);
    expect(out.esg_preference).toBe("indifferent");
  });

  it("transmet âge, horizon, montant et ESG renseignés", () => {
    const p: RichClientProfile = {
      ...EMPTY_PROFILE, age: 60, horizon_years: 5, amount_eur: 50000, esg: "art9",
    };
    const out = toMatchingProfile(p);
    expect(out).toMatchObject({ age: 60, horizon_years: 5, amount_eur: 50000, esg_preference: "art9" });
  });

  it("ignore une enveloppe inconnue", () => {
    const p = { ...EMPTY_PROFILE, envelopes: ["PEA", "BIDON"] };
    expect(toMatchingProfile(p).envelopes).toEqual(["pea"]);
  });

  it("convertit perte_max en % (illimitée → null)", () => {
    expect(toMatchingProfile({ ...EMPTY_PROFILE, perte_max: "20" }).max_loss_pct).toBe(20);
    expect(toMatchingProfile({ ...EMPTY_PROFILE, perte_max: "illimitee" }).max_loss_pct).toBeNull();
    expect(toMatchingProfile(EMPTY_PROFILE).max_loss_pct).toBeNull();
  });

  it("mappe les classes d'actifs vers asset_class_broad", () => {
    const out = toMatchingProfile({ ...EMPTY_PROFILE, asset_classes: ["actions", "scpi", "multi_actifs"] });
    expect(out.preferred_asset_classes).toEqual(["action", "immobilier", "diversifie"]);
  });
});

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

  it("combine plusieurs champs en un seul jeu de filtres", () => {
    const out = profileToScreenerFilters({
      ...EMPTY_PROFILE, risk_profile: "equilibre", esg: "art8", perte_max: "10", envelopes: ["PEA"],
    });
    expect(out).toEqual({ sri_max: 5, sfdr: [8, 9], drawdown_max: 10, envelopes: ["PEA"] });
  });
});
