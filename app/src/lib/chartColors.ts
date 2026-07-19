// Palette dataviz partagée (Recharts) sur le fond papier, cohérente avec le thème.
// Recharts exige des littéraux de couleur (pas de classes Tailwind) : on les
// centralise ici pour éviter les valeurs en dur dispersées dans les composants.

export const CHART_GRID = "#DFDEDA";            // lignes de grille
export const CHART_AXIS = "#999895";            // labels d'axes
export const CHART_TOOLTIP_BORDER = "#C9C7C2";  // bordure de l'infobulle
export const CHART_BENCHMARK = "#8A8780";       // indice de référence (gris tireté)
export const CHART_PORTFOLIO = "#B0613F";       // courbe du portefeuille (clay)

// Séries par support : ordre FIXE, jamais recyclé — au-delà de 8 supports, les
// suivants ne sont pas tracés (ils restent dans le tableau). L'identité ne repose
// pas que sur la couleur : légende + tableau.
export const CHART_SERIES = [
  "#2a78d6", "#1baf7a", "#eda100", "#008300",
  "#4a3aa7", "#e34948", "#e87ba4", "#eb6834",
];

// Fonds comparés : teintes sourdes, distinctes du portefeuille et de l'indice.
export const CHART_COMPARE = ["#5B7A8C", "#6E8B5E", "#8C6D9C"];

// Séries « par fonds » de la comparaison de fonds et du look-through (courbes NAV
// comparées + barres géo/secteur) : 4 teintes distinctes. Source unique partagée.
export const CHART_FUND_SERIES = ["#9F4325", "#2d7d5a", "#b97c2a", "#3d5a8a"];
