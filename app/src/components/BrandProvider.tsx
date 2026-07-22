"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  Branding,
  BRANDING_EVENT,
  EMPTY_BRANDING,
  deriveAccentVars,
  loadStoredBranding,
} from "@/lib/branding";

// Fournisseur de thème du cabinet. Lit la marque validée dans localStorage et,
// si elle est active, surcharge en LIGNE sur <html> les variables CSS d'accent
// (le style inline sur :root l'emporte toujours sur la feuille Tailwind, sans
// dépendre de l'ordre d'insertion). Le logo est exposé via le contexte pour la
// Topbar et le Rail. Rien d'autre du design n'est touché : surfaces, textes et
// tableaux gardent la charte lisible de Charlie.

// Les six variables surchargées — sert aussi au nettoyage à la remise à zéro.
const ACCENT_VARS = [
  "--color-accent",
  "--color-brown",
  "--color-brown-2",
  "--color-accent-ink",
  "--color-accent-soft",
  "--color-accent-tint",
] as const;

interface BrandContextValue {
  branding: Branding;
  /** Logo à afficher, ou null : la marque est active ET porte un logo. */
  logo: string | null;
  /** Couleur de marque active, ou null. */
  accent: string | null;
  /** Nom de l'organisation à afficher, ou null. */
  name: string | null;
  /** Baseline sous le logo, ou null. */
  tagline: string | null;
  /** Relit le localStorage (après une modification dans « Mon cabinet »). */
  refresh: () => void;
}

const BrandContext = createContext<BrandContextValue | null>(null);

function applyAccent(accent: string | null): void {
  const root = document.documentElement;
  if (accent) {
    const vars = deriveAccentVars(accent);
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  } else {
    for (const k of ACCENT_VARS) root.style.removeProperty(k);
  }
}

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [branding, setBranding] = useState<Branding>(EMPTY_BRANDING);

  const refresh = useCallback(() => {
    setBranding(loadStoredBranding());
  }, []);

  // Chargement initial + écoute des changements (même onglet via l'événement
  // custom, autres onglets via storage).
  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener(BRANDING_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(BRANDING_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [refresh]);

  // Applique/retire l'accent dès que la marque change.
  useEffect(() => {
    applyAccent(branding.enabled ? branding.accent : null);
    return () => applyAccent(null);
  }, [branding.enabled, branding.accent]);

  const active = branding.enabled;
  const value: BrandContextValue = {
    branding,
    logo: active ? branding.logo : null,
    accent: active ? branding.accent : null,
    name: active && branding.orgName ? branding.orgName : null,
    tagline: active && branding.tagline ? branding.tagline : null,
    refresh,
  };

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand(): BrandContextValue {
  const ctx = useContext(BrandContext);
  if (!ctx) throw new Error("useBrand must be used within BrandProvider");
  return ctx;
}
