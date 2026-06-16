// Référencement assureur : « chez quel(s) assureur(s) le fonds est référencé ».
// Composant partagé entre le tableau (FundTable), le drawer d'aperçu
// (FundPreviewDrawer) et la fiche, pour un langage visuel et une troncature
// identiques. Teinte neutre pour ne pas concurrencer les pills d'éligibilité
// (vertes).

export function InsurerChips(
  { insurers, max = 3, className = "" }:
  { insurers: string[] | null; max?: number; className?: string },
) {
  const list = insurers ?? [];
  if (list.length === 0) return null;
  const shown = list.slice(0, max);
  const extra = list.length - shown.length;
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {shown.map((c) => (
        <span
          key={c}
          className="inline-block px-1.5 py-0.5 rounded text-caption font-medium bg-paper-2 border border-line-soft text-muted"
        >
          {c}
        </span>
      ))}
      {extra > 0 && (
        <span title={list.join(" · ")} className="text-caption text-muted-2">+{extra}</span>
      )}
    </div>
  );
}
