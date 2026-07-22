import type { Metadata } from "next";
import Link from "next/link";
import React from "react";

export const metadata: Metadata = {
  description:
    "Comment Charlie traite les données personnelles : documents clients déposés, profils, mesure d'audience, sous-traitants, durées de conservation et droits RGPD.",
  alternates: { canonical: "/confidentialite" },
};

// Date de dernière mise à jour de la politique. À actualiser à chaque révision.
const LAST_UPDATED = "29 juin 2026";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-9">
      <h2
        className="text-title text-ink mb-3"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {title}
      </h2>
      <div className="space-y-3 text-body text-ink-2 leading-relaxed">
        {children}
      </div>
    </section>
  );
}

export default function ConfidentialitePage() {
  return (
    <main className="min-h-screen bg-cream px-5 sm:px-8 py-12">
      <article className="max-w-[720px] mx-auto">
        {/* Lien retour discret */}
        <Link
          href="/accueil"
          className="text-label text-muted hover:text-ink transition-colors"
        >
          ← Retour à l&apos;outil
        </Link>

        <h1
          className="mt-6 text-display-lg leading-[1.1] tracking-[-0.02em] text-ink"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          Politique de confidentialité
        </h1>
        <p className="mt-3 text-meta text-muted">
          Dernière mise à jour : {LAST_UPDATED}
        </p>

        <div className="mt-6 rounded-xl border border-line bg-paper px-5 py-4 text-meta text-ink-2 leading-relaxed">
          Charlie est un outil d&apos;aide à la sélection de supports
          d&apos;investissement destiné aux professionnels du conseil
          (CGP, courtiers). Cette politique décrit quelles données sont traitées
          lorsque vous utilisez l&apos;outil, et surtout lesquelles{" "}
          <strong>ne sont pas conservées</strong>.
        </div>

        <Section title="1. Responsable de traitement">
          <p>
            Le responsable du traitement des données est{" "}
            <strong>
              CHARLIE, société par actions simplifiée (SAS) immatriculée sous le
              numéro SIREN 105&nbsp;673&nbsp;131, dont le siège social est situé
              au 47 rue Vivienne, 75002 Paris
            </strong>
            , éditrice du service Charlie (ci-après « Charlie », « nous »).
          </p>
          <p>
            Pour toute question relative à vos données ou à cette politique :{" "}
            <a
              href="mailto:contact@charliefinance.fr"
              className="text-accent-ink underline underline-offset-2"
            >
              contact@charliefinance.fr
            </a>
            .
          </p>
        </Section>

        <Section title="2. Principe directeur : minimisation des données">
          <p>
            Charlie s&apos;utilise <strong>sans création de compte</strong>{" "}
            : aucun identifiant, mot de passe ou profil utilisateur n&apos;est
            requis ni stocké. Nous appliquons le principe de minimisation : nous ne
            collectons que ce qui est strictement nécessaire au fonctionnement de
            l&apos;outil.
          </p>
        </Section>

        <Section title="3. Documents clients déposés (DICI, profils, portefeuilles)">
          <p>
            Lorsque vous déposez un document (un DICI, un profil client, un relevé
            de portefeuille…) pour qu&apos;il soit analysé, son contenu est
            transmis à notre prestataire d&apos;intelligence artificielle{" "}
            <strong>uniquement le temps de l&apos;analyse</strong>, afin
            d&apos;en extraire les informations utiles (caractéristiques du fonds,
            éléments de profil).
          </p>
          <p>
            <strong>
              Ces documents ne sont pas conservés sur nos serveurs.
            </strong>{" "}
            Le fichier n&apos;est pas enregistré dans notre base de données : il
            est traité en mémoire puis écarté. Seule une mesure technique anonyme
            (par exemple l&apos;identifiant ISIN reconnu ou le type de produit)
            peut être enregistrée à des fins de statistiques d&apos;usage, sans le
            contenu du document.
          </p>
          <p>
            <strong>Votre responsabilité.</strong>{" "}Vous restez responsable des
            données de vos propres clients que vous déposez dans l&apos;outil.
            Assurez-vous de disposer du droit de les traiter et déposez de
            préférence des documents expurgés des données non nécessaires à
            l&apos;analyse.
          </p>
        </Section>

        <Section title="4. Profil client renseigné dans l'outil">
          <p>
            Les informations que vous saisissez dans le formulaire de profil
            (âge, montant, horizon, objectifs, préférences…) sont conservées{" "}
            <strong>localement dans votre navigateur</strong> (stockage local)
            pour pré-remplir vos recherches. Elles <strong>ne sont pas
            transmises ni stockées sur nos serveurs</strong> et disparaissent si
            vous videz les données de votre navigateur.
          </p>
        </Section>

        <Section title="5. Assistant conversationnel (chat)">
          <p>
            Les messages que vous adressez à l&apos;assistant sont transmis à
            notre prestataire d&apos;intelligence artificielle pour générer une
            réponse. <strong>Le contenu des conversations n&apos;est pas
            conservé</strong>{" "}; seul un compteur technique (nombre d&apos;échanges)
            peut être enregistré pour le suivi d&apos;usage et la limitation
            anti-abus.
          </p>
        </Section>

        <Section title="6. Mesure d'audience et statistiques d'usage">
          <p>
            Pour comprendre comment l&apos;outil est utilisé et l&apos;améliorer,
            nous enregistrons des événements d&apos;usage pseudonymisés : page
            consultée, fonds consulté, termes de recherche saisis, filtres
            appliqués. Ces événements sont rattachés à un identifiant de session
            technique et à un <strong>identifiant visiteur dérivé de votre
            adresse IP par hachage irréversible</strong>. Votre adresse IP en
            clair n&apos;est jamais conservée.
          </p>
          <p>
            Nous utilisons par ailleurs une solution de mesure d&apos;audience
            respectueuse de la vie privée fournie par notre hébergeur.
          </p>
        </Section>

        <Section title="7. Cookies et stockage local">
          <p>
            Charlie n&apos;utilise <strong>pas de cookies publicitaires ni de
            traceurs tiers</strong>. Sont uniquement employés des éléments
            techniques strictement nécessaires : un cookie de session, un cookie
            mémorisant que vous avez déjà vu la page d&apos;accueil, et un
            stockage local conservant votre profil client et l&apos;état de la
            visite guidée.
          </p>
        </Section>

        <Section title="8. Finalités et bases légales">
          <p>Les traitements ci-dessus reposent sur :</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              l&apos;<strong>intérêt légitime</strong>{" "}à fournir un outil
              d&apos;aide à la décision performant et à en assurer la sécurité
              (analyse des documents, limitation anti-abus) ;
            </li>
            <li>
              notre <strong>intérêt légitime</strong>{" "}à mesurer et améliorer
              l&apos;usage du service (statistiques pseudonymisées) ;
            </li>
            <li>
              le bon fonctionnement technique du service (cookies strictement
              nécessaires).
            </li>
          </ul>
        </Section>

        <Section title="9. Destinataires et sous-traitants">
          <p>
            Nous ne vendons ni ne louons aucune donnée. Pour fonctionner, Charlie
            s&apos;appuie sur des sous-traitants techniques, encadrés
            contractuellement :
          </p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <strong>Anthropic</strong> : analyse par intelligence artificielle
              des documents et des conversations ;
            </li>
            <li>
              <strong>Supabase</strong> : base de données et hébergement du
              service ;
            </li>
            <li>
              <strong>Vercel</strong>{" "}: hébergement de l&apos;application et
              mesure d&apos;audience.
            </li>
          </ul>
          <p>
            Certains de ces prestataires peuvent traiter des données en dehors de
            l&apos;Union européenne. Le cas échéant, ces transferts sont encadrés
            par les garanties appropriées prévues par le RGPD (notamment les
            clauses contractuelles types de la Commission européenne).
          </p>
        </Section>

        <Section title="10. Durées de conservation">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <strong>Documents déposés :</strong> non conservés (traités puis
              écartés).
            </li>
            <li>
              <strong>Profil client :</strong> conservé localement dans votre
              navigateur, sous votre contrôle.
            </li>
            <li>
              <strong>Conversations :</strong> contenu non conservé.
            </li>
            <li>
              <strong>Statistiques d&apos;usage pseudonymisées :</strong>{" "}
              conservées pour une durée limitée à des fins d&apos;analyse, puis
              supprimées ou agrégées.
            </li>
          </ul>
        </Section>

        <Section title="11. Sécurité">
          <p>
            Nous mettons en œuvre des mesures techniques et organisationnelles
            appropriées pour protéger les données (chiffrement des échanges,
            contrôle d&apos;accès, pseudonymisation, limitation des volumes
            traités).
          </p>
        </Section>

        <Section title="12. Vos droits">
          <p>
            Conformément au Règlement général sur la protection des données
            (RGPD) et à la loi Informatique et Libertés, vous disposez des droits
            d&apos;accès, de rectification, d&apos;effacement, de limitation,
            d&apos;opposition et de portabilité sur vos données personnelles.
          </p>
          <p>
            Pour exercer ces droits, écrivez-nous à{" "}
            <a
              href="mailto:contact@charliefinance.fr"
              className="text-accent-ink underline underline-offset-2"
            >
              contact@charliefinance.fr
            </a>
            . Vous pouvez également introduire une réclamation auprès de la{" "}
            <a
              href="https://www.cnil.fr"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-ink underline underline-offset-2"
            >
              CNIL
            </a>
            .
          </p>
        </Section>

        <Section title="13. Évolution de cette politique">
          <p>
            Cette politique peut être mise à jour pour refléter les évolutions de
            l&apos;outil ou de la réglementation. La date de dernière mise à jour
            figure en haut de cette page.
          </p>
        </Section>

        <div className="mt-12 pt-6 border-t border-line-soft">
          <Link
            href="/accueil"
            className="text-label text-muted hover:text-ink transition-colors"
          >
            ← Retour à l&apos;outil
          </Link>
        </div>
      </article>
    </main>
  );
}
