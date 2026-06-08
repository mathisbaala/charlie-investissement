import { dt, productTypeLabel, capitalize, fmtYears, fmtAumShort } from "@/lib/format";
import type { FundDetailHF } from "@/lib/types";

const STYLE_LABELS: Record<string, string> = {
  actif:      "Gestion active",
  passif:     "Gestion passive (index)",
  smart_beta: "Smart beta",
  alternatif: "Gestion alternative",
};

// Libellés FR de la classe d'actif large (colonne normalisée asset_class_broad).
// Évite les doublons de la colonne fine (ex. « diversifie » vs « multi-actifs »).
const ASSET_CLASS_LABELS: Record<string, string> = {
  action:            "Actions",
  actions:           "Actions",
  diversifie:        "Diversifié",
  "multi-actifs":    "Diversifié",
  obligation:        "Obligations",
  obligations:       "Obligations",
  monetaire:         "Monétaire",
  immobilier:        "Immobilier",
  alternatif:        "Alternatif",
  matieres_premieres:"Matières premières",
  private_equity:    "Private equity",
  "private equity":  "Private equity",
  euro_garanti:      "Fonds en euros",
  fonds_euros:       "Fonds en euros",
  livret:            "Livret",
  crypto:            "Crypto-actifs",
};

function assetClassLabel(broad: string | null, fine: string | null): string | null {
  const raw = broad ?? fine;
  if (!raw) return null;
  return ASSET_CLASS_LABELS[raw.toLowerCase()] ?? capitalize(raw);
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <tr className="border-b border-line-soft">
      <td className="py-2.5 text-[12px] text-muted pr-4 align-top">{label}</td>
      <td className="py-2.5 text-[12px] text-ink-2 text-right font-medium">{value}</td>
    </tr>
  );
}

// Affiche une ligne booléenne même quand la valeur est "Non" (mais pas quand null/inconnu).
function BoolRow({ label, value, yes = "Oui", no = "Non" }: { label: string; value: boolean | null; yes?: string; no?: string }) {
  if (value == null) return null;
  return (
    <tr className="border-b border-line-soft">
      <td className="py-2.5 text-[12px] text-muted pr-4 align-top">{label}</td>
      <td className={`py-2.5 text-[12px] text-right font-medium ${value ? "text-ink-2" : "text-muted-2"}`}>
        {value ? yes : no}
      </td>
    </tr>
  );
}

const LABEL_DISPLAY: Record<string, string> = {
  isr: "ISR",
  greenfin: "Greenfin",
  finansol: "Finansol",
  relance: "Label Relance",
  esg: "ESG",
  solidaire: "Solidaire",
  novethic: "Novethic",
  "towards-sustainability": "Towards Sustainability",
  "luxflag-esg": "LuxFLAG ESG",
  "luxflag-environment": "LuxFLAG Env.",
  "luxflag-climate-finance": "LuxFLAG Climat",
};

function LabelsRow({ labels }: { labels: string[] | null }) {
  const visible = labels?.filter(l => LABEL_DISPLAY[l.toLowerCase()]) ?? [];
  if (visible.length === 0) return null;
  return (
    <tr className="border-b border-line-soft">
      <td className="py-2.5 text-[12px] text-muted pr-4 align-top">Labels</td>
      <td className="py-2.5 text-right">
        <div className="flex flex-wrap gap-1 justify-end">
          {visible.map(l => (
            <span
              key={l}
              className="text-[10px] px-1.5 py-0.5 rounded border font-medium bg-ok-soft text-ok border-ok/20"
            >
              {LABEL_DISPLAY[l.toLowerCase()]}
            </span>
          ))}
        </div>
      </td>
    </tr>
  );
}

function MorningstarRow({ rating }: { rating: number | null }) {
  if (!rating) return null;
  return (
    <tr className="border-b border-line-soft">
      <td className="py-2.5 text-[12px] text-muted pr-4">Morningstar</td>
      <td className="py-2.5 text-right">
        <span className="text-[14px] text-warn leading-none">
          {"★".repeat(rating)}
          <span className="text-muted-2">{"★".repeat(5 - rating)}</span>
        </span>
      </td>
    </tr>
  );
}

export function CharacteristicsCard({ fund }: { fund: FundDetailHF }) {
  const styleLabel = fund.management_style ? (STYLE_LABELS[fund.management_style] ?? capitalize(fund.management_style)) : null;

  return (
    <div className="bg-paper rounded-2xl border border-line px-6 py-5">
      <h3 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-4">Caractéristiques</h3>
      <table className="w-full">
        <tbody>
          <Row label="Type" value={productTypeLabel(fund.product_type)} />
          <Row label="Style" value={styleLabel} />
          <Row label="Classe d'actif" value={assetClassLabel(fund.asset_class_broad, fund.asset_class)} />
          <Row label="Catégorie" value={capitalize(fund.category_normalized)} />
          <Row label="Zone géographique" value={capitalize(fund.region_normalized)} />
          <Row label="Devise" value={fund.currency} />
          <BoolRow label="Couverture de change" value={fund.hedged} yes="Couvert" no="Non couvert" />
          <Row label="Gestionnaire" value={fund.gestionnaire ?? fund.management_company} />
          <Row label="Encours" value={fmtAumShort(fund.aum_eur)} />
          <Row label="Création" value={fund.inception_date ? dt(fund.inception_date) : null} />
          <Row label="Ancienneté" value={fmtYears(fund.track_record_years)} />
          <BoolRow label="Conforme UCITS" value={fund.ucits_compliant} />
          <BoolRow label="Distribué en France" value={fund.distributor_france} />
          <MorningstarRow rating={fund.morningstar_rating} />
          <LabelsRow labels={fund.labels} />
        </tbody>
      </table>
    </div>
  );
}
