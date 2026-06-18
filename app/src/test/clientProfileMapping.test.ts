import { describe, it, expect } from "vitest";
import { toMatchingProfile, EMPTY_PROFILE, type RichClientProfile } from "../lib/clientProfile";

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
