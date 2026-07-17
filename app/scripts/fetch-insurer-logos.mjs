// Sourcing des logos d'assureurs (et distributeurs) pour la section AV.
//
// Source : service favicon Google (sz=256) — renvoie la marque carrée de chaque
// domaine en PNG (~180 px), fiable pour toutes les enseignes. Repli sur icon.horse
// (apple-touch-icon, souvent plus net) quand le favicon est absent/générique.
//
// Sortie : app/public/insurers/{slug}.png  (slug = slugify(company)).
// La liste des slugs réellement récupérés est écrite dans
// app/src/lib/insurer-logos.generated.ts (consommée par le helper runtime).
//
// Usage : node scripts/fetch-insurer-logos.mjs
//
// Les placeholders génériques (fond gris + 1re lettre, servis quand un domaine
// n'a pas de favicon) sont détectés et EXCLUS → ces assureurs auront un
// monogramme stylé côté UI plutôt qu'un faux logo.
//
// Marques dont le site bloque le favicon (403/JS) : logo officiel curé depuis
// Wikimedia Commons (voir CURATED). Tous les fichiers sont normalisés en vrai
// PNG (`sips`) car les sources peuvent renvoyer du JPEG/ICO renommé .png.

import { writeFile, mkdir, stat, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(__dirname, "..");
const OUT_DIR = join(APP_DIR, "public", "insurers");
const GENERATED_TS = join(APP_DIR, "src", "lib", "insurer-logos.generated.ts");

// slug déterministe — DOIT rester identique à slugifyInsurer() du helper runtime.
function slugify(name) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Map company (nom EXACT tel qu'en base) → domaine de la marque.
// Les entités sans site propre pointent vers la marque du groupe (logo du groupe).
const DOMAINS = {
  // ── Assureurs France ────────────────────────────────────────────────
  "Abeille Vie": "abeille-assurances.fr",
  "Abeille Retraite Professionnelle": "abeille-assurances.fr",
  "ACM Vie": "creditmutuel.fr",
  "AEP": "cardif.fr",
  "Afer": "afer.fr",
  "Afi Esca": "afiesca.fr",
  "AG2R La Mondiale": "ag2rlamondiale.fr",
  "Agipi": "agipi.com",
  "Allianz France": "allianz.fr",
  "APICIL": "apicil.com",
  "Asac Fapes": "asac-fapes.fr",
  "AXA France": "axa.fr",
  "AXA Wealth Services": "axa.fr",
  "BNP Paribas Cardif": "cardif.fr",
  "BPCE Vie": "bpce.fr",
  "Carac": "carac.fr",
  "CNP Assurances": "cnp.fr",
  "CNP Retraite": "cnp.fr",
  "Garance": "garance-mutuelle.fr",
  "Generali Vie": "generali.fr",
  "Generali Retraite": "generali.fr",
  "GMF Vie": "gmf.fr",
  "Groupama Gan Vie": "groupama.fr",
  "La Banque Postale Life": "labanquepostale.fr",
  "La France Mutualiste": "la-france-mutualiste.fr",
  "Le Conservateur": "conservateur.fr",
  "Linxea": "linxea.com",
  "MAAF Vie": "maaf.fr",
  "Macif Vie": "macif.fr",
  "MACSF": "macsf.fr",
  "Maif": "maif.fr",
  "MMA Vie": "mma.fr",
  "Monceau Assurances": "monceauassurances.com",
  "Oradéa Vie": "oradea-vie.fr",
  "Predica": "credit-agricole.fr",
  "Crédit Agricole Assurances Retraite": "credit-agricole.fr",
  "Prépar Vie": "prepar-vie.fr",
  "Sogécap": "societegenerale.fr",
  "Spirica": "spirica.fr",
  "Suravenir": "suravenir.fr",
  "SwissLife France": "swisslife.fr",

  // ── Assureurs Luxembourg ────────────────────────────────────────────
  "AFI ESCA Luxembourg": "afiesca.fr",
  "Allianz Life Luxembourg": "allianz.lu",
  "Apicil / OneLife": "apicil.com",
  "APICIL Luxembourg": "apicil.com",
  "AXA Wealth Europe": "axa.lu",
  "Baloise Life": "baloise.lu",
  "CALI Europe": "credit-agricole.fr",
  "Cardif Lux Vie": "cardifluxvie.com",
  "CNP Luxembourg": "cnp.fr",
  "Generali Luxembourg": "generali.lu",
  "Natixis Life Luxembourg": "natixis.com",
  "Sogelife": "sogelife.com",
  "Suravenir Luxembourg": "suravenir.fr",
  "Swiss Life Luxembourg": "swisslife.lu",
  "Utmost Luxembourg S.A.": "utmostinternational.com",
  "Vitis Life": "vitislife.com",
  "Wealins": "wealins.com",

  // ── Distributeurs / banques / fintech (onglet assureurs) ────────────
  "Banque Populaire": "banquepopulaire.fr",
  "Bourse Direct": "boursedirect.fr",
  "BoursoBank": "boursobank.com",
  "Caisse d'Épargne": "caisse-epargne.fr",
  "Easybourse": "easybourse.com",
  "Fortuneo": "fortuneo.fr",
  "LCL": "lcl.fr",
  "Selencia": "selencia.fr",
  "Trade Republic": "traderepublic.com",
  "Yomoni": "yomoni.fr",
};

// Logos CURÉS (par slug) : marques dont le site bloque le scraping de favicon
// (403 / JS / anti-bot) → on prend le logo officiel via Wikimedia Commons
// (Wikidata P154 ou image de tête de l'article), source stable et libre.
// Special:FilePath rend même les SVG en raster. Normalisés en PNG à l'écriture.
// Clés = slug(company) EXACT (slugify du nom en base).
const CURATED = {
  "apicil": "https://commons.wikimedia.org/wiki/Special:FilePath/Logotype%20Groupe%20APICIL.png?width=400",
  "caisse-d-epargne": "https://commons.wikimedia.org/wiki/Special:FilePath/Team%20Caisse%20d%E2%80%99Epargne.svg?width=400",
  "bourse-direct": "https://fr.wikipedia.org/wiki/Special:FilePath/Bourse-Direct-Logo.jpg?width=400",
};

const faviconUrl = (domain) =>
  `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`;
const iconHorseUrl = (domain) => `https://icon.horse/icon/${encodeURIComponent(domain)}`;

async function fetchBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (charlie-logo-sourcing)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("empty");
  return buf;
}

const sha1 = (buf) => createHash("sha1").update(buf).digest("hex");

// Empreintes des placeholders génériques (fond gris + 1re lettre) que Google/
// icon.horse renvoient quand un domaine n'a PAS de favicon. Le visuel ne dépend
// que de la 1re lettre → on récupère un gabarit de référence par lettre a-z via
// des domaines volontairement inexistants, et on rejette tout logo qui matche.
async function buildPlaceholderHashes() {
  const hashes = new Set();
  const letters = "abcdefghijklmnopqrstuvwxyz".split("");
  await Promise.all(
    letters.map(async (l) => {
      const bogus = `${l}qxz-does-not-exist-9271.com`;
      for (const url of [faviconUrl(bogus), iconHorseUrl(bogus)]) {
        try {
          hashes.add(sha1(await fetchBuffer(url)));
        } catch {}
      }
    }),
  );
  return hashes;
}

// Normalise un fichier en vrai PNG (les favicons/logos peuvent arriver en JPEG,
// ICO, WEBP… renommés .png). Utilise `sips` (macOS). Best-effort : sans sips,
// on garde les octets tels quels. Idempotent sur un PNG déjà valide.
async function normalizeToPng(path) {
  try {
    await execFileP("sips", ["-s", "format", "png", path, "--out", path]);
  } catch {}
}

// Récupère un VRAI logo (non générique). Google favicon d'abord, repli icon.horse.
// Renvoie null si les deux sources ne rendent qu'un placeholder générique.
async function sourceLogo(domain, placeholders) {
  for (const url of [faviconUrl(domain), iconHorseUrl(domain)]) {
    try {
      const buf = await fetchBuffer(url);
      if (buf.length >= 300 && !placeholders.has(sha1(buf))) return buf;
    } catch {}
  }
  return null;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  console.log("Construction des gabarits de placeholders (a-z)…");
  const placeholders = await buildPlaceholderHashes();
  console.log(`  ${placeholders.size} empreintes de référence.\n`);

  const ok = [];
  const skipped = []; // pas de vrai logo → monogramme côté UI
  const byHash = new Map(); // sha1 -> {slug, domain} : sécurité anti-doublon inter-marques

  for (const [company, domain] of Object.entries(DOMAINS)) {
    const slug = slugify(company);
    const out = join(OUT_DIR, `${slug}.png`);
    const buf = await sourceLogo(domain, placeholders);
    if (!buf) {
      skipped.push(company);
      await rm(out, { force: true });
      console.log(`○ ${company.padEnd(34)} ${domain.padEnd(28)} générique → monogramme`);
      continue;
    }
    // Sécurité : deux MARQUES distinctes (domaines ≠) au contenu identique = encore
    // un placeholder passé au travers. On rejette la seconde occurrence.
    const h = sha1(buf);
    const seen = byHash.get(h);
    if (seen && seen.domain !== domain) {
      skipped.push(company);
      await rm(out, { force: true });
      console.log(`○ ${company.padEnd(34)} ${domain.padEnd(28)} doublon inter-marque → monogramme`);
      continue;
    }
    byHash.set(h, { slug, domain });
    await writeFile(out, buf);
    await normalizeToPng(out);
    ok.push(slug);
    console.log(`✓ ${company.padEnd(34)} ${domain.padEnd(28)} ${buf.length} o`);
  }

  // Logos curés (Wikimedia) pour les marques dont le favicon est inexploitable.
  for (const [slug, url] of Object.entries(CURATED)) {
    if (ok.includes(slug)) continue; // déjà obtenu via favicon
    const out = join(OUT_DIR, `${slug}.png`);
    try {
      const buf = await fetchBuffer(url);
      if (buf.length < 300) throw new Error("trop petit");
      await writeFile(out, buf);
      await normalizeToPng(out);
      ok.push(slug);
      console.log(`✓ ${slug.padEnd(34)} ${"wikimedia (curé)".padEnd(28)} ${buf.length} o`);
    } catch (e) {
      console.log(`○ ${slug.padEnd(34)} ${"wikimedia (curé)".padEnd(28)} ${e?.message ?? e}`);
    }
  }

  // Fichier généré : liste des slugs disposant d'un logo (source unique pour le
  // helper runtime — évite un accès FS côté edge).
  const uniqueSlugs = [...new Set(ok)].sort();
  const banner =
    "// AUTO-GÉNÉRÉ par scripts/fetch-insurer-logos.mjs — ne pas éditer à la main.\n" +
    "// Slugs des assureurs/distributeurs disposant d'un logo dans /public/insurers.\n\n";
  const body =
    "export const INSURER_LOGO_SLUGS: ReadonlySet<string> = new Set([\n" +
    uniqueSlugs.map((s) => `  ${JSON.stringify(s)},`).join("\n") +
    "\n]);\n";
  await writeFile(GENERATED_TS, banner + body);

  console.log(`\n${uniqueSlugs.length} logos OK · ${skipped.length} sans logo (monogramme)`);
  if (skipped.length) console.log("Sans logo :", skipped.join(", "));
  console.log(`Fichier généré : ${GENERATED_TS}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
