import type { FundDetailHF } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { productTypeLabel } from "@/lib/format";

// Types de private equity (non coté) — partagé avec FundSheetClient pour neutraliser
// les blocs « cotés » (graphe VL, perf annualisée, vol/sharpe) qui n'ont pas de sens ici.
const PE_TYPES = new Set(["fcpr", "fcpi", "fip", "fpci"]);
export function isPrivateEquity(productType: string | null | undefined): boolean {
  return !!productType && PE_TYPES.has(productType.toLowerCase());
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-caption uppercase tracking-wider text-muted font-semibold mb-1">{label}</div>
      <div className="text-body text-ink-2 font-medium">{value}</div>
    </div>
  );
}

// Affichage dédié au private equity : remplace l'aire « performance » (vide ou trompeuse
// sur du non coté) par un cadrage honnête — pas de VL quotidienne, perf mesurée à la sortie
// (TRI/multiple), capital bloqué — et les rares faits réellement disponibles.
export function PrivateEquityCard({ fund }: { fund: FundDetailHF }) {
  if (!isPrivateEquity(fund.product_type)) return null;

  const vintage = fund.inception_date ? new Date(fund.inception_date).getFullYear() : null;

  return (
    <Card className="px-5 py-5 md:px-7 md:py-6 mt-5">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-label uppercase tracking-widest text-muted font-semibold">
          Private equity · non coté
        </h3>
        <span className="text-caption px-2 py-0.5 rounded-full font-medium bg-accent-soft text-accent-ink border border-accent/20">
          Illiquide
        </span>
      </div>

      <p className="text-meta text-ink-2 leading-relaxed max-w-2xl">
        Ce fonds (<span className="font-semibold">{productTypeLabel(fund.product_type)}</span>) investit
        dans des sociétés <span className="font-semibold">non cotées</span>. Il n&apos;a pas de valeur
        liquidative quotidienne&nbsp;: sa valorisation est périodique et sa performance se mesure
        <span className="font-semibold"> à la sortie</span> (TRI, multiple de capital), non en
        performance annualisée comparable à un fonds coté. Nous n&apos;affichons donc ni courbe de VL
        ni performance annualisée pour ce support.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-5">
        {vintage != null && <Fact label="Millésime" value={String(vintage)} />}
        {fund.risk_score != null && <Fact label="Risque (SRI)" value={`${fund.risk_score} / 7`} />}
        <Fact
          label="Durée de blocage"
          value={fund.holding_period_years != null ? `${fund.holding_period_years} ans` : "5 à 10 ans (indicatif)"}
        />
      </div>

      <p className="text-caption text-muted-2 mt-5 leading-snug max-w-2xl">
        Selon le produit, l&apos;accès se fait en souscription directe (avantage fiscal IR sous
        conditions de durée et de plafonds) ou via certains contrats d&apos;assurance-vie&nbsp;: la
        disponibilité en assurance-vie dépend du contrat et n&apos;est pas garantie. Capital à risque,
        parts bloquées pendant la durée de vie du fonds. Consultez le DICI avant toute souscription.
      </p>
    </Card>
  );
}
