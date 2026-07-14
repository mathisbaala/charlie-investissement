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
        "La cartographie du référencement. Retrouvez, assureur par assureur, quels contrats logent quels supports, et ouvrez la fiche de chaque contrat.",
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
            "Cliquez un contrat pour ouvrir sa fiche : enveloppe, supports référencés, frais moyens et répartition (classes, zones, gestionnaires, risque).",
            "Depuis la fiche, « Voir les supports » ouvre le screener filtré sur ce contrat.",
            "Cliquez un assureur pour afficher directement tous ses supports au screener.",
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
        "L'atelier de construction de portefeuille. À partir du profil client et d'un contrat, Charlie construit une allocation optimisée (max-Sharpe ou HRP), la met à l'épreuve d'un back-test historique, et produit la proposition d'investissement (PDF / PowerPoint).",
      sections: [
        {
          heading: "Sur cette page",
          items: [
            "Le profil du client (étape 1), enregistré automatiquement : il pilote les contraintes de l'allocation.",
            "Les réglages du conseiller : contrat visé, moteur de pondération (max-Sharpe ou HRP), nombre de supports, plafond de risque (SRI), zones, ESG, frais maximum.",
            "L'allocation générée : supports et poids, indicateurs attendus (rendement / volatilité / Sharpe, SRI pondéré), plan de Markowitz interactif et matrice de corrélation.",
            "Le back-test historique de l'allocation face à un indice, sur la période choisie.",
            "Les projets du client, une poche par objectif, et le pilotage support par support (imposer, écarter, remplacer).",
          ],
        },
        {
          heading: "Comment l'utiliser",
          items: [
            "Renseignez ou réutilisez le profil, choisissez un contrat, puis générez l'allocation.",
            "Ajustez les réglages ou les poids (curseurs de Markowitz) : le résultat et le back-test se recalculent.",
            "Affinez support par support, puis téléchargez la proposition d'investissement en PDF ou PowerPoint.",
          ],
        },
      ],
    },
  },
  {
    prefixes: ["/simulateur"],
    guide: {
      title: "Simulateur de frais",
      intro:
        "Le simulateur de frais et de gains d'une assurance vie. Montre les deux étages de frais que porte le client final (contrat + unités de compte) et leur effet sur la performance nette, année par année.",
      sections: [
        {
          heading: "Sur cette page",
          items: [
            "Les paramètres du contrat (frais d'entrée / gestion / sortie) et des UC, pré-remplis par des valeurs de place, surchargeables.",
            "Des UC réelles ajoutées depuis la base (performance 5 ans et frais réels), pondérées.",
            "Les résultats : valeur nette vs brute, coût de structure, part des frais dans le gain, courbe des frais cumulés par poste, projections 5 / 10 / 15 ans, détail par UC.",
          ],
        },
        {
          heading: "Comment l'utiliser",
          items: [
            "Renseignez le contrat et le montant, ajoutez les UC du client, ajustez les frais si besoin.",
            "Lisez les frais en regard des gains (transparence DDA) et comparez les projections par horizon.",
          ],
        },
      ],
    },
  },
  {
    prefixes: ["/cabinet"],
    guide: {
      title: "Mon cabinet",
      intro:
        "Les réglages de votre cabinet, renseignés une fois et réutilisés par toute la plateforme (portefeuille, rapports) : nom du cabinet, assureurs partenaires et conventions de rétrocession.",
      sections: [
        {
          heading: "Sur cette page",
          items: [
            "Le nom du cabinet / conseiller, repris automatiquement dans les études et les rapports.",
            "Vos assureurs partenaires : recherchez et ajoutez les assureurs avec lesquels vous travaillez.",
            "Pour chaque assureur, les contrats référencés et vos conventions de rétrocession.",
          ],
        },
        {
          heading: "Comment l'utiliser",
          items: [
            "Ajoutez vos assureurs partenaires : la sélection alimente le référencement et le portefeuille.",
            "Renseignez les rétrocessions par contrat pour qu'elles remontent dans les restitutions.",
            "Une fois rempli, tout le reste de la plateforme réutilise ces informations sans re-saisie.",
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

// Accueil (et racine / routes non listées) : guide par défaut, servi aussi en repli.
const HOME_GUIDE: PageGuide = {
  title: "Accueil",
  intro:
    "Le point de départ. Décrivez un fonds en langage naturel pour lancer une recherche, et reprenez le travail là où vous l'avez laissé.",
  sections: [
    {
      heading: "Sur cette page",
      items: [
        "Une barre de recherche en langage naturel : décrivez un fonds (« actions européennes ESG, frais bas ») et l'IA traduit votre phrase en filtres.",
        "La reprise d'activité : vos recherches récentes et vos derniers fonds consultés, pour y revenir en un clic.",
        "Le profil client, lui, se renseigne dans l'onglet Portefeuille (où il pilote l'allocation).",
      ],
    },
    {
      heading: "Comment l'utiliser",
      items: [
        "Tapez le besoin et lancez : vous arrivez directement sur les résultats.",
        "Relancez une recherche récente, ou rouvrez un fonds déjà consulté depuis la reprise d'activité.",
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
