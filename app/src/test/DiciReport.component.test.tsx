import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiciReport, type DiciFiche } from "@/components/existant/DiciReport";

// DiciReport utilise useRouter (navigation) — on le neutralise.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Fiche minimale (tous les champs optionnels à null) : le rapport ne doit pas
// crasher et ne déclenche aucun fetch (matched_isin null).
function emptyFiche(over: Partial<DiciFiche> = {}): DiciFiche {
  return {
    name: "Fonds Test",
    isin: null,
    gestionnaire: null,
    product_type: null,
    sfdr_article: null,
    sri: null,
    investment_objective: null,
    recommended_holding_period: null,
    entry_fees_max: null,
    exit_fees_max: null,
    ongoing_charges: null,
    performance_fees: null,
    target_investor: null,
    key_risks: null,
    benchmark: null,
    currency: null,
    domicile: null,
    inception_date: null,
    transaction_costs: null,
    total_costs: null,
    performance_scenarios: null,
    matched_isin: null,
    matched_name: null,
    ...over,
  };
}

describe("DiciReport", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  });

  it("rend une fiche minimale sans crasher et n'appelle pas l'API fonds", () => {
    expect(() => render(<DiciReport fiche={emptyFiche()} onReset={() => {}} />)).not.toThrow();
    expect(screen.getByText("Fonds Test")).toBeTruthy();
    // matched_isin null → aucun enrichissement marché demandé.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("affiche les scénarios de performance triés du favorable aux tensions", () => {
    render(
      <DiciReport
        fiche={emptyFiche({
          performance_scenarios: [
            { scenario: "stress", return_pct: -28.4, final_amount: 3200 },
            { scenario: "favorable", return_pct: 14.2, final_amount: 19400 },
            { scenario: "intermediaire", return_pct: 6.8, final_amount: 13900 },
            { scenario: "defavorable", return_pct: -2.1, final_amount: 9000 },
          ],
        })}
        onReset={() => {}}
      />,
    );
    const labels = ["Favorable", "Intermédiaire", "Défavorable", "Tensions"].map((t) =>
      screen.getByText(t),
    );
    // Ordre vertical : favorable doit précéder tensions dans le DOM.
    const top = labels[0].compareDocumentPosition(labels[3]);
    expect(top & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("masque la section scénarios quand toutes les valeurs sont nulles", () => {
    render(
      <DiciReport
        fiche={emptyFiche({
          performance_scenarios: [{ scenario: "stress", return_pct: null, final_amount: null }],
        })}
        onReset={() => {}}
      />,
    );
    expect(screen.queryByText("Scénarios de performance")).toBeNull();
  });

  it("indique quand le fonds n'est pas retrouvé en base", () => {
    render(<DiciReport fiche={emptyFiche()} onReset={() => {}} />);
    expect(screen.getByText(/n'a pas été retrouvé dans la base/)).toBeTruthy();
  });
});
