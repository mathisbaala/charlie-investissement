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
      title: "Partenaires",
      intro:
        "Le choix du partenaire : le mapping exhaustif des assureurs et de leurs contrats pour savoir où loger fiscalement chaque support, avec qui travailler, ce que chacun propose (contrats, frais, rémunération) et ses forces et limites.",
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
            "Cliquez un contrat pour ouvrir sa fiche : enveloppe, supports référencés, frais et rémunération, répartition (classes, zones, gestionnaires, risque).",
            "Comparez les partenaires pour choisir où loger un support trouvé à la recherche.",
            "Depuis la fiche, « Voir les supports » ouvre le screener filtré sur ce contrat ; cliquez un assureur pour afficher tous ses supports au screener.",
          ],
        },
      ],
    },
  },
  {
    // Plus spécifique que /portefeuille → doit précéder l'entrée générique.
    prefixes: ["/portefeuille/analyser"],
    guide: {
      title: "Analyser un portefeuille existant",
      intro:
        "Le diagnostic de ce que le client détient déjà, en deux modes : un portefeuille complet (déposez ses relevés de situation, Charlie consolide et recommande) ou un support unique (déposez un DICI / KID, Charlie en extrait l'essentiel) — sans refaire le portefeuille.",
      sections: [
        {
          heading: "Sur cette page",
          items: [
            "Un sélecteur en tête : « Portefeuille complet » ou « Support unique ».",
            "Mode portefeuille : le dépôt des relevés (PDF, Excel ou CSV, jamais conservés), la validation des positions (contrat reconnu ou à choisir, montants éditables, fonds à ajouter à la main), la synthèse consolidée (répartition, SRI pondéré, frais moyens) et les recommandations triées par impact (corrélation, concentration, frais).",
            "Mode support unique : une zone de dépôt pour un DICI / KID qui produit un rapport de fonds structuré (identité, SRI, catégorie SFDR, frais détaillés, risques, scénarios de performance), rapproché des données de marché si le fonds est reconnu en base.",
          ],
        },
        {
          heading: "Comment l'utiliser",
          items: [
            "Pour un portefeuille : déposez les relevés, vérifiez les contrats et les montants, puis lancez l'analyse (corrélations, exposition agrégée, recommandations).",
            "Pour un support : basculez sur « Support unique » et déposez le DICI (jusqu'à 3 Mo) ; vérifiez les frais et scénarios extraits, puis ouvrez la fiche en base pour aller plus loin.",
            "Prolongez si besoin dans le simulateur de frais, ou basculez vers « Créer un portefeuille » pour proposer une réallocation complète.",
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
        "Deux chemins pour travailler le portefeuille d'un client : le construire de A à Z, cohérent avec son profil (contrat → allocation optimisée max-Sharpe ou HRP, back-test historique, proposition PDF / PowerPoint), ou analyser l'existant à partir de ses relevés pour repérer les trous dans la raquette et les points à optimiser.",
      sections: [
        {
          heading: "Sur cette page",
          items: [
            "Le profil du client (étape 1), enregistré automatiquement : il pilote les contraintes du portefeuille.",
            "Les réglages du conseiller : contrat visé, moteur de pondération (max-Sharpe ou HRP), nombre de supports, plafond de risque (SRI), zones, ESG, frais maximum.",
            "« Générer le portefeuille » ouvre une page entièrement dédiée : supports et poids, indicateurs attendus (rendement / volatilité / Sharpe, SRI pondéré), plan de Markowitz interactif, matrice de corrélation et back-test historique.",
            "Sur cette page dédiée, les projets du client (une poche par objectif) et le pilotage support par support (imposer, écarter, remplacer).",
          ],
        },
        {
          heading: "Comment l'utiliser",
          items: [
            "Renseignez ou réutilisez le profil, choisissez un contrat, puis générez le portefeuille.",
            "Sur la page dédiée, ajustez les poids (curseurs de Markowitz) ou écartez un support : le portefeuille et le back-test se recalculent.",
            "Affinez support par support, puis téléchargez la proposition d'investissement en PDF ou PowerPoint.",
          ],
        },
      ],
    },
  },
  {
    prefixes: ["/simulateur"],
    guide: {
      title: "Frais",
      intro:
        "La comptabilité du portefeuille : ce qu'il rapporte, ce que gagne le cabinet et ce qu'il coûte au client. Rétrocessions récurrentes et commission d'entrée, cumulées et détaillées support par support, avec le partage assureur / société de gestion / cabinet, prêtes à éditer en rapport.",
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
    "Le point de départ : décrivez avec vos propres mots le fonds ou le support recherché, Charlie en fait une recherche que vous pourrez filtrer, trier et comparer jusqu'au support qui convient. Reprenez aussi le travail là où vous l'avez laissé.",
  sections: [
    {
      heading: "Sur cette page",
      items: [
        "Une barre de recherche en langage naturel : décrivez un fonds (« actions européennes ESG, frais bas ») et l'IA traduit votre phrase en filtres.",
        "La reprise d'activité : vos recherches récentes et vos derniers fonds consultés, pour y revenir en un clic.",
        "Le profil client, lui, se renseigne dans l'onglet Portefeuille (où il pilote le portefeuille).",
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
