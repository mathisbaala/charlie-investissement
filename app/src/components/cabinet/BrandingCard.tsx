"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Check, Loader2, RotateCcw, X } from "@/components/ui/icons";
import {
  Branding,
  clearStoredBranding,
  ensureUsableAccent,
  loadStoredBranding,
  normalizeHex,
  readableOn,
  saveStoredBranding,
} from "@/lib/branding";

// Onglet Cabinet, section « Ma marque ». Le CGP colle l'URL de son site : on en
// extrait (gratuitement, côté serveur) son logo et sa couleur de marque, il les
// prévisualise et ajuste, puis les applique. Le screener adopte alors son logo
// en tête et sa couleur sur les liens, onglets actifs et éléments choisis. Le
// reste du design lisible de Charlie ne bouge pas. C'est réversible à tout
// moment (« Réinitialiser »).

const inputCls =
  "w-full border border-line rounded-lg px-3 py-2 text-meta bg-paper text-ink placeholder:text-muted focus:outline-none focus:border-brown/50 transition-colors";

const MAX_LOGO_BYTES = 600_000;

interface ExtractResult {
  siteUrl: string;
  siteName: string | null;
  logo: string | null;
  logoCandidates: string[];
  accent: string | null;
  accentCandidates: string[];
}

type Status = "idle" | "loading" | "error";

export function BrandingCard() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  // Aperçu en cours d'édition (non encore appliqué).
  const [logo, setLogo] = useState<string | null>(null);
  const [accent, setAccent] = useState<string | null>(null);
  const [accentChoices, setAccentChoices] = useState<string[]>([]);
  const [orgName, setOrgName] = useState("");
  const [tagline, setTagline] = useState("");

  // Marque actuellement appliquée (pour l'état « active » et la comparaison).
  const [applied, setApplied] = useState<Branding | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reflète la marque déjà enregistrée à l'ouverture de la page.
  useEffect(() => {
    const b = loadStoredBranding();
    setApplied(b.enabled ? b : null);
    if (b.enabled) {
      setUrl(b.siteUrl);
      setLogo(b.logo);
      setAccent(b.accent);
      setAccentChoices(b.accent ? [b.accent] : []);
      setOrgName(b.orgName);
      setTagline(b.tagline);
    }
  }, []);

  async function analyse() {
    if (!url.trim()) return;
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/brand/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error || "Analyse impossible");
        setStatus("error");
        return;
      }
      const data = (await res.json()) as ExtractResult;
      setLogo(data.logo);
      const acc = data.accent ? normalizeHex(data.accent) : null;
      setAccent(acc);
      setAccentChoices(data.accentCandidates || []);
      setStatus("idle");
      // Pré-remplit le nom depuis le titre du site (partie avant « | »), si vide.
      let nextOrg = orgName;
      if (!orgName.trim() && data.siteName) {
        nextOrg = data.siteName.split("|")[0].trim().slice(0, 40);
        setOrgName(nextOrg);
      }
      // Application immédiate au screener (logo + couleur), sans étape de validation.
      persist({ logo: data.logo, accent: acc, url, orgName: nextOrg });
      if (!data.logo && !acc) {
        setError(
          "Rien de réutilisable détecté sur ce site. Vous pouvez ajouter un logo et choisir une couleur à la main.",
        );
      }
    } catch {
      setError("Analyse impossible");
      setStatus("error");
    }
  }

  function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Le fichier doit être une image");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError("Logo trop lourd (600 Ko maximum)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      setLogo(result);
      setError(null);
      persist({ logo: result });
    };
    reader.readAsDataURL(file);
  }

  // Applique en DIRECT au screener (logo + couleur). Appelée dès l'analyse et à
  // chaque ajustement : pas de validation manuelle, l'aperçu EST le résultat.
  // Les valeurs sont passées explicitement (l'état React n'est pas encore à jour
  // au moment de l'appel).
  function persist(next: {
    logo?: string | null;
    accent?: string | null;
    url?: string;
    orgName?: string;
    tagline?: string;
  }) {
    const nlogo = next.logo !== undefined ? next.logo : logo;
    const naccent = next.accent !== undefined ? next.accent : accent;
    const nurl = next.url !== undefined ? next.url : url;
    const norg = next.orgName !== undefined ? next.orgName : orgName;
    const ntag = next.tagline !== undefined ? next.tagline : tagline;
    const b: Branding = {
      siteUrl: nurl.trim(),
      logo: nlogo,
      accent: naccent ? ensureUsableAccent(naccent) : null,
      orgName: norg,
      tagline: ntag,
      enabled: Boolean(nlogo || naccent || norg.trim()),
    };
    saveStoredBranding(b);
    setApplied(b.enabled ? b : null);
  }

  function chooseAccent(hex: string) {
    setAccent(hex);
    setAccentChoices((prev) => [...new Set([hex, ...prev])]);
    persist({ accent: hex });
  }

  function reset() {
    clearStoredBranding();
    setApplied(null);
    setLogo(null);
    setAccent(null);
    setAccentChoices([]);
    setOrgName("");
    setTagline("");
    setError(null);
  }

  const hasPreview = Boolean(logo || accent || orgName.trim());
  // Les 3 couleurs distinctes détectées sur le site (la 1re, la plus présente,
  // est déjà appliquée automatiquement). Proposées comme alternatives cliquables.
  const siteColors = accentChoices.slice(0, 3);
  const usableAccent = accent ? ensureUsableAccent(accent) : null;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-label uppercase tracking-[0.08em] text-accent font-semibold">
          Ma marque
        </p>
        {applied && (
          <span className="inline-flex items-center gap-1 text-caption text-ok font-semibold">
            <Check size={12} strokeWidth={2.4} /> Personnalisation active
          </span>
        )}
      </div>

      <p className="text-meta text-muted">
        Le screener reprend le logo et la couleur de votre site.
      </p>

      {/* Saisie de l'URL + analyse */}
      <div className="flex items-center gap-2">
        <input
          className={inputCls}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              analyse();
            }
          }}
          placeholder="www.mon-cabinet.fr"
          aria-label="Adresse du site du cabinet"
          type="url"
          inputMode="url"
          autoComplete="url"
        />
        <button
          onClick={analyse}
          disabled={status === "loading" || !url.trim()}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-meta font-medium text-paper hover:bg-ink-strong disabled:opacity-40 transition-colors cursor-pointer"
        >
          {status === "loading" ? (
            <>
              <Loader2 size={13} className="animate-spin" /> Analyse…
            </>
          ) : (
            "Analyser mon site"
          )}
        </button>
      </div>

      {error && <p className="text-meta text-danger">{error}</p>}

      {/* Nom de l'organisation + baseline sous le logo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-label text-muted font-medium">Nom de l&apos;organisation</label>
          <input
            className={inputCls}
            value={orgName}
            onChange={(e) => { setOrgName(e.target.value); persist({ orgName: e.target.value }); }}
            placeholder="Ex. Mon Cabinet"
            aria-label="Nom de l'organisation"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-label text-muted font-medium">Texte sous le logo</label>
          <input
            className={inputCls}
            value={tagline}
            onChange={(e) => { setTagline(e.target.value); persist({ tagline: e.target.value }); }}
            placeholder="Ex. Gestion privée"
            aria-label="Texte sous le logo"
          />
        </div>
      </div>

      {/* Aperçu */}
      {hasPreview && (
        <div className="space-y-4 rounded-lg border border-line bg-paper-2 p-4">
          <p className="text-label uppercase tracking-[0.08em] text-muted font-semibold">
            Aperçu
          </p>

          {/* Carte de marque : logo + nom posés sur la couleur du cabinet */}
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-xl px-6 py-8"
            style={{ backgroundColor: usableAccent || "var(--color-paper-3)" }}
          >
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" className="max-h-14 max-w-[60%] object-contain" />
            ) : null}
            {orgName.trim() && (
              <span
                className="text-subhead font-semibold leading-none"
                style={{ color: usableAccent ? readableOn(usableAccent) : "var(--color-ink)" }}
              >
                {orgName}
              </span>
            )}
            {tagline.trim() && (
              <span
                className="text-meta leading-none"
                style={{
                  color: usableAccent ? readableOn(usableAccent) : "var(--color-muted)",
                  opacity: 0.85,
                }}
              >
                {tagline}
              </span>
            )}
          </div>

          {/* Logo */}
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-40 items-center justify-center rounded-md border border-line bg-paper px-3">
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logo}
                  alt="Logo détecté"
                  className="max-h-10 max-w-full object-contain"
                />
              ) : (
                <span className="text-caption text-muted">Aucun logo</span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <button
                onClick={() => fileRef.current?.click()}
                className="text-meta text-accent hover:text-accent-ink font-medium cursor-pointer text-left"
              >
                {logo ? "Changer le logo" : "Ajouter un logo"}
              </button>
              {logo && (
                <button
                  onClick={() => { setLogo(null); persist({ logo: null }); }}
                  className="inline-flex items-center gap-1 text-meta text-muted hover:text-ink-2 cursor-pointer"
                >
                  <X size={12} /> Retirer le logo
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={onLogoFile}
                className="hidden"
              />
            </div>
          </div>

          {/* Couleur de marque */}
          <div className="space-y-2">
            <p className="text-meta text-ink-2">Couleur de marque</p>
            {siteColors.length > 0 && (
              <p className="text-caption text-muted">
                {siteColors.length === 1
                  ? "Détectée sur votre site."
                  : "Détectées sur votre site — la principale est appliquée."}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {siteColors.map((hex) => (
                <button
                  key={hex}
                  onClick={() => chooseAccent(hex)}
                  aria-label={`Couleur ${hex}`}
                  title={hex}
                  className={`h-8 w-8 rounded-full border transition-transform hover:scale-110 cursor-pointer ${
                    accent === hex ? "ring-2 ring-offset-2 ring-ink border-transparent" : "border-line"
                  }`}
                  style={{ backgroundColor: hex }}
                />
              ))}
              {/* Séparateur puis réglage fin à la pipette */}
              {siteColors.length > 0 && <span className="w-px h-6 bg-line mx-1" />}
              <label
                className="inline-flex items-center gap-1.5 text-meta text-muted cursor-pointer"
                title="Choisir une autre couleur"
              >
                <input
                  type="color"
                  value={usableAccent || "#000000"}
                  onChange={(e) => chooseAccent(e.target.value)}
                  className="h-8 w-8 cursor-pointer rounded border border-line bg-paper p-0.5"
                  aria-label="Choisir une couleur précise"
                />
                Autre couleur
              </label>
            </div>

            {/* Rendu réel d'un bouton et d'un lien dans la couleur choisie */}
            {usableAccent && (
              <div className="flex items-center gap-3 pt-1">
                <span
                  className="inline-flex items-center rounded-md px-3 py-1.5 text-meta font-medium"
                  style={{ backgroundColor: usableAccent, color: readableOn(usableAccent) }}
                >
                  Bouton
                </span>
                <span className="text-meta font-medium" style={{ color: usableAccent }}>
                  Lien actif
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Actions — l'application est automatique ; il ne reste qu'à remettre à zéro */}
      {(applied || hasPreview) && (
        <div className="flex items-center gap-2">
          <span className="text-meta text-muted">
            Appliqué automatiquement au screener.
          </span>
          <button
            onClick={reset}
            className="inline-flex items-center gap-1.5 text-meta text-accent hover:text-accent-ink font-medium cursor-pointer"
          >
            <RotateCcw size={13} /> Réinitialiser
          </button>
        </div>
      )}
    </Card>
  );
}
