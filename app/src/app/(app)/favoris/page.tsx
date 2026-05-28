"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Btn } from "@/components/ui/Btn";
import { SfdrBadge, SriBadge } from "@/components/ui/Badge";
import { Star, X } from "@/components/ui/icons";
import { getFavorites, removeFavorite } from "@/lib/favorites";
import type { FavoriteEntry } from "@/lib/favorites";
import { pct } from "@/lib/format";

function FavCard({
  f,
  onRemove,
}: {
  f: FavoriteEntry;
  onRemove: () => void;
}) {
  return (
    <div className="bg-paper rounded-xl border border-line p-4 flex flex-col gap-3 hover:shadow-sm transition-all group">
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <p
          className="text-[13px] font-medium text-ink truncate flex-1"
          style={{ fontFamily: "var(--font-serif)" }}
          title={f.name}
        >
          {f.name}
        </p>
        <button
          onClick={onRemove}
          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-muted-2 hover:text-ink rounded p-0.5"
          aria-label="Retirer des favoris"
        >
          <X size={13} />
        </button>
      </div>

      {/* Gestionnaire */}
      {f.gestionnaire && (
        <p className="text-muted text-[11px] -mt-2">{f.gestionnaire}</p>
      )}

      {/* ISIN */}
      <p
        className="text-[10px] text-muted-2"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {f.isin}
      </p>

      {/* Badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <SfdrBadge article={f.sfdr_article} />
        <SriBadge sri={f.risk_score} />
      </div>

      {/* Metrics */}
      <div className="flex items-center gap-4">
        <div>
          <p className="text-[10px] text-muted mb-0.5">Perf. 3A</p>
          <p
            className={`text-[12px] font-medium ${
              f.performance_3y == null
                ? "text-muted"
                : f.performance_3y >= 0
                ? "text-ok"
                : "text-warn"
            }`}
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {pct(f.performance_3y, true)}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-muted mb-0.5">TER</p>
          <p
            className="text-[12px] text-ink-2"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {pct(f.ongoing_charges)}
          </p>
        </div>
      </div>

      {/* Eligibility pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {f.pea_eligible && (
          <span className="text-[10px] bg-ok-soft text-ok px-2 py-0.5 rounded-full">
            PEA
          </span>
        )}
        {f.per_eligible && (
          <span className="text-[10px] bg-ok-soft text-ok px-2 py-0.5 rounded-full">
            PER
          </span>
        )}
        {f.av_lux_eligible && (
          <span className="text-[10px] bg-ok-soft text-ok px-2 py-0.5 rounded-full">
            AV Lux
          </span>
        )}
      </div>

      {/* Footer link */}
      <Link
        href={`/fonds/${f.isin}`}
        className="text-accent text-[11px] hover:underline mt-auto"
      >
        Voir la fiche →
      </Link>
    </div>
  );
}

export default function FavorisPage() {
  const [favorites, setFavorites] = useState<FavoriteEntry[]>([]);

  useEffect(() => {
    setFavorites(getFavorites());
  }, []);

  function handleRemove(isin: string) {
    removeFavorite(isin);
    setFavorites((prev) => prev.filter((f) => f.isin !== isin));
  }

  return (
    <div className="h-full overflow-y-auto bg-cream px-8 py-8">
      {/* Header */}
      <div className="mb-2">
        <h1
          className="text-[26px] text-ink inline"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Favoris
          <span className="ml-2 text-[13px] text-muted font-sans">
            ({favorites.length})
          </span>
        </h1>
        <p className="text-[13px] text-muted mt-1">
          Gérez vos supports suivis
        </p>
      </div>

      {/* Grid or empty state */}
      {favorites.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-muted">
          <Star size={32} strokeWidth={1} className="mb-4 text-muted-2" />
          <p className="text-[14px]">Aucun favori enregistré</p>
          <p className="text-[12px] mt-1">
            Ajoutez des fonds depuis la recherche ou les fiches
          </p>
          <Link href="/recherche" className="mt-4">
            <Btn variant="primary" size="sm">
              Rechercher des fonds
            </Btn>
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-3 gap-4 max-[900px]:grid-cols-2">
          {favorites.map((f) => (
            <FavCard
              key={f.isin}
              f={f}
              onRemove={() => handleRemove(f.isin)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
