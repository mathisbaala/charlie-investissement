// Indicateur de solidité (Solvabilité II, notation, PPB, encours) — ne s'affiche
// que si la valeur est renseignée. `sub` porte la précision (agence, millésime…).
// Partagé par la fiche assureur (compagnie) et la fiche-contrat.
export function SolidityStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | null;
  sub?: string | null;
}) {
  if (!value) return null;
  return (
    <div className="rounded-lg bg-paper-2 border border-line px-3 py-2">
      <p className="text-caption uppercase tracking-widest text-muted-2 font-semibold">{label}</p>
      <p className="text-body-lg text-ink font-semibold tabular-nums mt-0.5">{value}</p>
      {sub && <p className="text-caption text-muted-2 mt-0.5">{sub}</p>}
    </div>
  );
}
