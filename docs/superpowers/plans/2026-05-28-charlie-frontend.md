# Charlie Investissement — Frontend Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task.

**Goal:** Re-implement the Charlie Investissement hi-fi prototype as a production Next.js app wired to Supabase (35 988 fonds, NAV history) and Anthropic NLP.

**Architecture:** Route groups `(public)` (Landing, bare layout) and `(app)` (Chrome layout: Topbar + Rail + Chat). Cookie `charlie_seen` gates Landing vs Home. All data fetches via thin `lib/api.ts` client. Favorites and search history in localStorage (no auth in beta).

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript strict · Tailwind v4 (CSS-first @theme) · Recharts v3 · lucide-react · zustand · @anthropic-ai/sdk · @supabase/supabase-js

---

## Shared Contracts (all agents must use these exactly)

### ParsedFilters (NLP output + UI state)
```ts
export type ParsedFilters = {
  sfdr?: number[];           // [6,8,9]
  sri_min?: number;
  sri_max?: number;
  ter_max?: number;
  perf_1y_min?: number;
  perf_3y_min?: number;
  vol_max?: number;
  sharpe_min?: number;
  aum_min?: number;
  track_record_min?: number;
  envelopes?: string[];      // ["PEA","PER","AV-LUX"]
  universe?: string[];       // mapped to product_type / asset_class
  currency?: string[];
  morningstar_min?: number;
  manager_search?: string;
  free_text?: string;
  chips?: string[];          // human-readable labels for UI chips
};
```

### FundRow (screener list)
Uses existing `Fund` type from `lib/types.ts`. Key fields used in table:
`isin, name, gestionnaire, sfdr_article, risk_score, ongoing_charges, performance_1y, performance_3y, volatility_1y, sharpe_1y, pea_eligible, per_eligible, av_lux_eligible, data_completeness, morningstar_rating`

### FundDetailHF (fund sheet — adapted to available DB data)
```ts
export type FundDetailHF = {
  // Identité
  isin: string;
  name: string;
  gestionnaire: string | null;
  management_company: string | null;
  product_type: string | null;
  category_normalized: string | null;
  asset_class: string | null;
  region_normalized: string | null;
  currency: string | null;
  inception_date: string | null;
  track_record_years: number | null;
  // Risque
  sfdr_article: number | null;
  risk_score: number | null;   // SRI 1-7
  srri: number | null;
  // Performance
  performance_1y: number | null;
  performance_3y: number | null;
  performance_5y: number | null;
  volatility_1y: number | null;
  volatility_3y: number | null;
  sharpe_1y: number | null;
  sharpe_3y: number | null;
  max_drawdown_1y: number | null;
  max_drawdown_3y: number | null;
  // Frais (only what DB has)
  ongoing_charges: number | null;
  ter: number | null;
  // Éligibilités (only confirmed 3)
  pea_eligible: boolean | null;
  per_eligible: boolean | null;
  av_lux_eligible: boolean | null;
  // Autres
  aum_eur: number | null;
  morningstar_rating: number | null;
  labels: string[] | null;
  kid_url: string | null;
  data_completeness: number;
  // NAV history (from investissement_fund_prices)
  nav_history: { date: string; nav: number }[];
};
```

### NavPoint
```ts
export type NavPoint = { date: string; nav: number };
```

### FavoriteEntry (localStorage)
```ts
export type FavoriteEntry = {
  isin: string;
  name: string;
  gestionnaire: string | null;
  sfdr_article: number | null;
  risk_score: number | null;
  performance_3y: number | null;
  ongoing_charges: number | null;
  pea_eligible: boolean | null;
  per_eligible: boolean | null;
  av_lux_eligible: boolean | null;
  morningstar_rating: number | null;
  added_at: string; // ISO
};
```

### SearchEntry (localStorage)
```ts
export type SearchEntry = {
  query: string;
  filters: ParsedFilters;
  count: number;
  searched_at: string; // ISO
};
```

---

## API Contracts

### POST /api/parse
Request: `{ query: string }`
Response: `ParsedFilters` (always valid JSON, empty `{}` on NLP failure)
Uses: Anthropic claude-sonnet-4-6, system prompt → structured JSON

### GET /api/funds
Query params mirror ParsedFilters + `page`, `per_page` (default 50), `sort_by`, `sort_dir`
Response: `{ data: Fund[], total: number, page: number, per_page: number, total_pages: number }`
Hard floor: `data_completeness >= 50`

### GET /api/funds/[isin]
Response: `{ data: FundDetailHF }`
Fetches from `investissement_funds` + joins `investissement_fund_prices` for last 3 years of NAV

### POST /api/chat
Request: `{ messages: { role: string; content: string }[] }`
Response: streaming text/event-stream

---

## File Map

### New files to CREATE:
```
app/src/
├── app/
│   ├── (public)/layout.tsx          # bare layout (no chrome)
│   ├── (public)/page.tsx            # Landing (sets cookie, NLP entry)
│   ├── (app)/layout.tsx             # Chrome layout (Topbar + Rail + Chat)
│   ├── (app)/accueil/page.tsx       # Home (cookie seen → redirect here)
│   ├── (app)/recherche/page.tsx     # Results
│   ├── (app)/fonds/[isin]/page.tsx  # Fund sheet (replaces existing)
│   ├── (app)/favoris/page.tsx       # Favoris
│   ├── (app)/documents/page.tsx     # Documents
│   └── api/
│       ├── parse/route.ts
│       ├── funds/route.ts
│       ├── funds/[isin]/route.ts
│       └── chat/route.ts
├── components/
│   ├── chrome/
│   │   ├── Topbar.tsx
│   │   ├── Rail.tsx
│   │   └── ChatPanel.tsx
│   ├── ui/
│   │   ├── icons.tsx                # Logo, Sparkle custom SVGs
│   │   ├── Badge.tsx                # SFDR / SRI / Morningstar
│   │   ├── Tag.tsx                  # chip tags
│   │   ├── Btn.tsx                  # button variants
│   │   └── Toast.tsx                # toast + useToast hook
│   ├── screener/
│   │   ├── TypingPrompt.tsx
│   │   ├── FilterPanel.tsx
│   │   ├── ParsedFilterChips.tsx
│   │   ├── FundTable.tsx            # replaces src/components/FundTable.tsx
│   │   ├── FundPreviewDrawer.tsx
│   │   ├── SelectionBar.tsx
│   │   └── ComparisonModal.tsx
│   ├── fund/
│   │   ├── FundBanner.tsx
│   │   ├── KpiStrip.tsx
│   │   ├── NavChart.tsx             # replaces PerformanceChart.tsx
│   │   ├── CharacteristicsCard.tsx
│   │   ├── RisqueCard.tsx
│   │   ├── EnveloppesCard.tsx
│   │   └── FeesCard.tsx
│   └── SelectionProvider.tsx        # global selection context (max 4)
└── lib/
    ├── format.ts                    # pct(), eur(), dt(), nf, nf1
    ├── api.ts                       # client-side fetch helpers
    ├── favorites.ts                 # localStorage CRUD
    └── searches.ts                  # localStorage CRUD
```

### Files to MODIFY:
```
app/src/app/globals.css              # OKLCH tokens + @theme
app/src/app/layout.tsx               # Google Fonts (Instrument Serif, DM Sans, Caveat, DM Mono)
app/src/lib/types.ts                 # add ParsedFilters, FundDetailHF, NavPoint, FavoriteEntry, SearchEntry
app/src/lib/claude.ts                # add parseFrenchQuery() with chips output
```

### Files to DELETE (replaced by new versions in (app)/):
```
app/src/app/fonds/[isin]/page.tsx   → replaced by (app)/fonds/[isin]/page.tsx
app/src/app/page.tsx                → replaced by (public)/page.tsx + (app)/accueil/page.tsx
```

---

## Design tokens (Tailwind v4 @theme — OKLCH only)

```css
@theme {
  --color-cream:       oklch(0.955 0.018 78);
  --color-paper:       oklch(0.998 0.003 80);
  --color-paper-2:     oklch(0.965 0.015 76);
  --color-paper-3:     oklch(0.93  0.02  74);
  --color-ink:         oklch(0.22  0.012 60);
  --color-ink-2:       oklch(0.40  0.012 60);
  --color-muted:       oklch(0.58  0.012 60);
  --color-muted-2:     oklch(0.72  0.012 60);
  --color-line:        oklch(0.78  0.018 68);
  --color-line-soft:   oklch(0.86  0.015 70);
  --color-accent:      oklch(0.62  0.13  45);
  --color-accent-soft: oklch(0.93  0.05  50);
  --color-accent-ink:  oklch(0.42  0.13  40);
  --color-brown:       oklch(0.53  0.135 45);
  --color-brown-2:     oklch(0.48  0.135 45);
  --color-ok:          oklch(0.55  0.10  150);
  --color-ok-soft:     oklch(0.93  0.04  150);
  --color-warn:        oklch(0.62  0.13  65);
  --color-warn-soft:   oklch(0.94  0.06  75);

  --font-serif:  "Instrument Serif", Georgia, serif;
  --font-sans:   "DM Sans", system-ui, sans-serif;
  --font-hand:   "Caveat", cursive;
  --font-mono:   "DM Mono", "Courier New", monospace;

  --radius-sm:   4px;
  --radius-md:   8px;
  --radius-lg:   12px;
  --radius-pill: 999px;
}
```

---

## Tasks

### Task 1 — Design system + Google Fonts
**Files:** `globals.css`, `layout.tsx`
- [ ] Replace globals.css with OKLCH @theme tokens above + base body styles
- [ ] Update layout.tsx: load Instrument_Serif (400,400i), DM_Sans (400,500,600,700), Caveat (500), DM_Mono (400,500) via next/font/google

### Task 2 — Core lib helpers
**Files:** `lib/format.ts`, `lib/favorites.ts`, `lib/searches.ts`
- [ ] Create `lib/format.ts` with `nf`, `nf1`, `pct(v, sign?)`, `eur(v)`, `dt(iso)`, `fmtAum(v)`
- [ ] Create `lib/favorites.ts` with `getFavorites()`, `addFavorite(entry)`, `removeFavorite(isin)`, `isFavorite(isin)`
- [ ] Create `lib/searches.ts` with `getRecentSearches()`, `addSearch(entry)`, `clearSearches()`

### Task 3 — Update lib/types.ts
**Files:** `lib/types.ts`
- [ ] Add `ParsedFilters`, `FundDetailHF`, `NavPoint`, `FavoriteEntry`, `SearchEntry` types as defined in Shared Contracts above

### Task 4 — Update lib/claude.ts + API /api/parse
**Files:** `lib/claude.ts`, `app/api/parse/route.ts`
- [ ] Add `parseFrenchQuery(query: string): Promise<ParsedFilters>` to claude.ts — calls claude-sonnet-4-6 with system prompt, returns ParsedFilters with `chips[]` array
- [ ] Create `api/parse/route.ts` POST handler

### Task 5 — API /api/funds + /api/funds/[isin]
**Files:** `app/api/funds/route.ts`, `app/api/funds/[isin]/route.ts`
- [ ] `/api/funds`: map ParsedFilters query params to existing screener/funds logic (data_completeness >= 50, LIMIT 50)
- [ ] `/api/funds/[isin]`: fetch from `investissement_funds` + last 3Y of NAV from `investissement_fund_prices`, return FundDetailHF

### Task 6 — API /api/chat (streaming)
**Files:** `app/api/chat/route.ts`
- [ ] POST handler: takes `{ messages }`, streams Claude response as SSE

### Task 7 — UI primitives
**Files:** `components/ui/icons.tsx`, `Badge.tsx`, `Tag.tsx`, `Btn.tsx`, `Toast.tsx`
- [ ] `icons.tsx`: Logo (C square), Sparkle (✦), Bot SVGs + re-export lucide-react icons
- [ ] `Badge.tsx`: SfdrBadge, SriBadge, MorningstarBadge with Charlie design tokens
- [ ] `Tag.tsx`: removable chip with × button
- [ ] `Btn.tsx`: variants primary (brown), ghost, outline
- [ ] `Toast.tsx`: toast stack + `useToast()` hook

### Task 8 — SelectionProvider + SelectionBar + ComparisonModal
**Files:** `components/SelectionProvider.tsx`, `components/screener/SelectionBar.tsx`, `components/screener/ComparisonModal.tsx`
- [ ] SelectionProvider: React context, max 4 funds, persists to sessionStorage
- [ ] SelectionBar: sticky bottom, appears when ≥1 selected, "Comparer" disabled until ≥2
- [ ] ComparisonModal: side-by-side table, best/worst highlighting

### Task 9 — Chrome components
**Files:** `components/chrome/Topbar.tsx`, `Rail.tsx`, `ChatPanel.tsx`
- [ ] Topbar: 56px, Logo + wordmark + breadcrumb, chat trigger button
- [ ] Rail: 60px wide, icon nav buttons, active=brown, tooltips
- [ ] ChatPanel: 360px, streaming from /api/chat, empty state "Bonjour."

### Task 10 — Route layouts
**Files:** `app/(public)/layout.tsx`, `app/(app)/layout.tsx`, `app/page.tsx` (root)
- [ ] `(public)/layout.tsx`: bare wrapper, no chrome
- [ ] `(app)/layout.tsx`: Topbar + Rail + ChatPanel wrapper, SelectionProvider
- [ ] `app/page.tsx` (root): reads `charlie_seen` cookie → redirect `/accueil` if set, else redirect `/(public)` landing

### Task 11 — TypingPrompt + Sparkline + NavChart
**Files:** `components/screener/TypingPrompt.tsx`, `components/ui/Sparkline.tsx`, `components/fund/NavChart.tsx`
- [ ] TypingPrompt: cycling placeholders, 40ms type / 20ms delete, terracotta caret
- [ ] Sparkline: SVG, terracotta line 1.75px, 60×24px default
- [ ] NavChart: Recharts LineChart, terracotta line, 4 dashed grid rules, quarter x-axis labels

### Task 12 — Landing page
**Files:** `app/(public)/page.tsx`
- [ ] Hero H1 with Instrument Serif italic keywords in accent color
- [ ] TypingPrompt + submit → POST /api/parse → set cookie → redirect /recherche?q=
- [ ] Drop zone for client profile file → toast → redirect
- [ ] Two radial-gradient terracotta blooms in background
- [ ] "Données réglementaires." reassurance line

### Task 13 — Home page (accueil)
**Files:** `app/(app)/accueil/page.tsx`
- [ ] H1 "Trouver le bon support."
- [ ] Compact search bar with TypingPrompt
- [ ] 3-col grid: Recherches récentes (localStorage), Vos favoris (localStorage), static popular searches

### Task 14 — FilterPanel + ParsedFilterChips + FundTable
**Files:** `components/screener/FilterPanel.tsx`, `ParsedFilterChips.tsx`, `FundTable.tsx`
- [ ] FilterPanel: 12 filter groups, sticky footer "Appliquer · {count}", slide-in from left
- [ ] ParsedFilterChips: horizontal scroll, each chip removable
- [ ] FundTable: checkbox | Fonds | SFDR | SRI | TER | Perf1Y | Perf3Y | Vol1Y | Sharpe | Enveloppes | chevron; selected row = left accent stripe

### Task 15 — FundPreviewDrawer
**Files:** `components/screener/FundPreviewDrawer.tsx`
- [ ] 380px right drawer, slide-in 200ms
- [ ] Head: "APERÇU" eyebrow + fund name + compare-toggle pill + close
- [ ] Body: Favoris + PDF buttons, meta, badges, 4 KPI tiles, Sparkline, éligibilités list, caractéristiques table
- [ ] Full-width CTA "Voir la fiche complète →"

### Task 16 — Results page (/recherche)
**Files:** `app/(app)/recherche/page.tsx`
- [ ] Inline-editable NLP query header
- [ ] Toolbar: count + ParsedFilterChips + sort + Filtres toggle
- [ ] FilterPanel + FundTable + FundPreviewDrawer
- [ ] Selection bar at bottom
- [ ] Degraded NLP state → toast + auto-open filters

### Task 17 — Fund sheet components + page
**Files:** `components/fund/FundBanner.tsx`, `KpiStrip.tsx`, `CharacteristicsCard.tsx`, `RisqueCard.tsx`, `EnveloppesCard.tsx`, `FeesCard.tsx`, `app/(app)/fonds/[isin]/page.tsx`
- [ ] FundBanner: sticky action bar + display-md name + badges
- [ ] KpiStrip: 6 tiles (Perf1Y, Perf3Y, Perf5Y, Vol1Y, Sharpe1Y, MaxDD) with ok/warn colors
- [ ] CharacteristicsCard: stat table with available fields only
- [ ] RisqueCard: SRI track 1-7 + risk metrics
- [ ] EnveloppesCard: 3 eligibility tiles (PEA/PER/AV-LUX only)
- [ ] FeesCard: only ongoing_charges (adapt title to "Frais courants")
- [ ] data_completeness < 80 → warn banner
- [ ] Pill section nav: scroll spy

### Task 18 — Favoris page
**Files:** `app/(app)/favoris/page.tsx`, `components/favorites/FavCard.tsx`
- [ ] FavCard: name + ISIN + star toggle + badges + 3 KPI mini-tiles + Caveat note area + "Ouvrir →"
- [ ] 2-col grid, filter sidebar, opens FundPreviewDrawer inline

### Task 19 — Documents page
**Files:** `app/(app)/documents/page.tsx`
- [ ] Table: Document | Fonds | Type | Date | Actions
- [ ] Shows DICI/KIID from kid_url field + generated PDFs from session
- [ ] Filter sidebar: Type + Période
