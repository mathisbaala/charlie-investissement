// Contenu du panneau « Charlie » (ex-chatbot) : une explication contextuelle de
// la page courante — ce qu'elle contient et comment l'exploiter pleinement.
// Module pur (pas de dépendance React) → sélection testable hors composant.

export type GuideSection = {
  /** Intitulé court de la section (ex. « Sur cette page »). */
  heading: string;
  /** Puces concrètes, orientées CGP. */
  items: string[];
};

export type PageGuide = {
  /** Nom de la page (titre du panneau). */
  title: string;
  /** Une à deux phrases : à quoi sert la page. */
  intro: string;
  sections: GuideSection[];
};

// Ordre significatif : la première entrée dont le préfixe matche gagne. Les plus
// spécifiques (ex. /fonds/) doivent donc précéder les plus génériques.
const GUIDES: { prefixes: string[]; guide: PageGuide }[] = [
  {
    prefixes: ["/recherche"],
    guide: {
      title: "Recherche",
      intro:
        "Le moteur de sélection. Resserrez l'univers des fonds par le texte, le profil ou les filtres, puis comparez et ouvrez les fiches.",
      sections: [
        {
          heading: "Sur cette page",
          items: [
            "Une barre de recherche en langage naturel ou par ISIN exact ; les critères compris par l'IA s'affichent en pastilles.",
            "Des bandeaux contextuels « Profil client » et « Référencement » rappellent les filtres hérités, retirables en un clic.",
            "Un tri complet : pertinence, performance 1/3/5 ans, encours, Sharpe, volatilité, TER, Morningstar, ancienneté.",
            "Un panneau de filtres détaillé : type de produit, classe d'actifs, région, performance, risque, frais, critères ESG.",
            "Une table de résultats avec sélection multiple pour comparer, et clic sur une ligne pour la fiche.",
          ],
        },
        {
          heading: "Comment l'utiliser",
          items: [
            "Partez d'une phrase, puis resserrez avec le panneau de filtres ou en retirant des pastilles.",
            "Cochez plusieurs fonds pour les comparer côte à côte.",
            "Si les résultats manquent, Charlie assouplit certains critères et vous le signale (bandeau « critères relâchés »).",
          ],
        },
      ],
    },
  },
  {
    prefixes: ["/assureurs"],
    guide: {
      title: "Assurances vie",
      intro:
        "La cartographie du référencement. Retrouvez, assureur par assureur, quels contrats logent quels supports.",
      sections: [
        {
          heading: "Sur cette page",
          items: [
            "Des onglets d'enveloppe : Assurance vie, Capitalisation, PER, PEA.",
            "Une recherche par nom d'assureur ou de contrat, et une option pour masquer les contrats fermés.",
            "Une grille de cartes assureur : nombre de supports référencés, liste des contrats et leur statut (ouvert / fermé).",
          ],
        },
        {
          heading: "Comment l'utiliser",
          items: [
            "Cliquez un assureur pour afficher tous ses supports au screener.",
            "Cliquez un contrat pour ne garder que les supports logeables dans ce contrat précis.",
            "Le filtre de référencement suit ensuite vos recherches (bandeau « Référencement »).",
          ],
        },
      ],
    },
  },
  {
    prefixes: ["/portefeuille"],
    guide: {
      title: "Portefeuille",
      intro:
        "L'atelier d'allocation. Composez un portefeuille de fonds et mesurez son comportement d'ensemble.",
      sections: [
        {
          heading: "Sur cette page",
          items: [
            "L'ajout de fonds un par un, avec le poids de chaque position (normalisé automatiquement).",
            "Le choix d'un indice de référence, d'une période et d'un montant simulé.",
            "Les indicateurs agrégés : performance vs indice, alpha, volatilité, Sharpe, Calmar, exposition géographique et par classe d'actifs.",
            "Une matrice de corrélation entre les fonds et une courbe de performance face à l'indice.",
            "Des scénarios de projection : stress, défavorable, intermédiaire, favorable.",
          ],
        },
        {
          heading: "Comment l'utiliser",
          items: [
            "Ajoutez plusieurs fonds, ajustez les poids, puis lisez la corrélation pour vérifier la diversification.",
            "Changez l'indice et la période pour tester la robustesse de l'allocation.",
            "L'URL est partageable : envoyez le portefeuille sans créer de compte.",
          ],
        },
      ],
    },
  },
  {
    prefixes: ["/documents"],
    guide: {
      title: "Documents",
      intro:
        "Le lecteur de DICI. Déposez un document et Charlie en extrait l'essentiel, structuré et lisible.",
      sections: [
        {
          heading: "Sur cette page",
          items: [
            "Une zone de dépôt (glisser-déposer ou clic) pour un PDF de DICI / KID.",
            "Un rapport structuré : identité du fonds, SRI, catégorie SFDR, frais détaillés, investisseur cible, risques clés, indice, scénarios de performance.",
            "Un lien vers la fiche complète si le fonds est reconnu en base.",
          ],
        },
        {
          heading: "Comment l'utiliser",
          items: [
            "Déposez le PDF (jusqu'à 3 Mo) et laissez l'analyse se faire.",
            "Vérifiez les frais et les scénarios extraits, puis ouvrez la fiche en base pour aller plus loin.",
            "« Nouvelle analyse » réinitialise la page pour un autre document.",
          ],
        },
      ],
    },
  },
  {
    prefixes: ["/fonds/"],
    guide: {
      title: "Fiche fonds",
      intro:
        "La fiche complète d'un fonds : performance, risque, frais, composition, durabilité et référencement au même endroit.",
      sections: [
        {
          heading: "Sur cette page",
          items: [
            "L'en-tête : nom, ISIN, gestionnaire, type de produit, et les badges d'éligibilité (PEA, PER, AV France / Luxembourg, CTO).",
            "Les indicateurs : performance 1/3/5 ans vs indice, volatilité, Sharpe, drawdown, alpha, frais (TER, entrée / sortie), encours.",
            "Les notations SRI et Morningstar ; les données ESG (article SFDR, taxonomie, PAI).",
            "La composition : principales lignes, ventilation sectorielle et géographique, historique de VL.",
            "Les assureurs qui référencent le fonds et dans quels contrats.",
          ],
        },
        {
          heading: "Comment l'utiliser",
          items: [
            "Comparez la performance à l'indice de référence et vérifiez les frais réels.",
            "Contrôlez les enveloppes éligibles via les badges de l'en-tête.",
            "Cliquez un contrat pour retrouver au screener les supports du même assureur.",
          ],
        },
      ],
    },
  },
];

// Accueil (et racine / redirection profil) : guide par défaut, servi aussi en repli.
const HOME_GUIDE: PageGuide = {
  title: "Accueil",
  intro:
    "Le point de départ. Décrivez le besoin de votre client, en langage naturel ou via le profil, et Charlie construit une sélection de supports adaptée.",
  sections: [
    {
      heading: "Sur cette page",
      items: [
        "Une barre de recherche en langage naturel : décrivez un fonds (« actions européennes ESG, frais bas ») et l'IA traduit votre phrase en filtres.",
        "Un formulaire de profil client complet : le client, le profil de risque (5 niveaux MIF), les préférences (classes d'actifs, zones, ESG), les frais / fiscalité / enveloppes, et la distribution du cabinet.",
        "L'import d'un document client (PDF, CSV, Excel) pour pré-remplir automatiquement le profil.",
      ],
    },
    {
      heading: "Comment l'utiliser",
      items: [
        "Pour une recherche rapide : tapez le besoin et lancez, vous arrivez directement sur les résultats.",
        "Pour une reco cadrée : renseignez le profil, puis « Trouver le support adapté » — les résultats sont filtrés et classés selon le profil.",
        "Renseignez vos assureurs dans « Distribution du cabinet » : la sélection reste appliquée à toutes vos recherches.",
      ],
    },
  ],
};

/**
 * Sélectionne le guide correspondant au chemin courant. Repli sur l'accueil pour
 * toute route non listée (racine, redirections, pages transverses). Pur.
 */
export function guideForPath(pathname: string): PageGuide {
  const hit = GUIDES.find((g) => g.prefixes.some((p) => pathname === p || pathname.startsWith(p)));
  return hit ? hit.guide : HOME_GUIDE;
}
