import type { Metadata } from 'next';
import Link from 'next/link';

import { SiteFooter } from '@/components/site-footer';
import * as home from '@/content/homepage';
import { LEGAL, legalComplete } from '@/content/legal';

/**
 * Conditions générales d'utilisation — version bêta.
 *
 * Elles reprennent ce que le produit fait et ne fait pas (00_PRODUCT_SPEC §2,
 * AGENTS §70, §85, §86) : PLUKA prépare une course, il ne remplace ni le
 * règlement, ni les décisions de l'organisation, ni un avis médical. À faire
 * relire avant l'ouverture au public (docs/legal/RGPD_AUTO_EVALUATION.md).
 */
export function generateMetadata(): Metadata {
  return {
    title: 'Conditions d’utilisation — PLUKA',
    robots: legalComplete() ? undefined : { index: false, follow: false },
  };
}

const TODO = '[à compléter]';

function day(date: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

export default function TermsPage() {
  const email = LEGAL.privacyEmail;

  return (
    <div className="lp-shell">
      <main className="lp-main lp-legal">
        <p>
          <Link href="/">PLUKA</Link>
        </p>

        <h1>Conditions générales d’utilisation</h1>
        <p className="lp-legal-meta">Version bêta · mise à jour le {day(LEGAL.updatedOn)}</p>

        <h2>Objet</h2>
        <p>
          Ces conditions encadrent l’usage de PLUKA, un service qui aide les coureurs de trail à
          préparer une course : plan de course, nutrition, préparation du matériel, assistance. En
          créant un compte, vous les acceptez.
        </p>

        <h2>Ce que PLUKA n’est pas</h2>
        <ul>
          <li>Ni un plan d’entraînement, ni un coach.</li>
          <li>
            Ni une source officielle à la place de l’organisation : le règlement, le matériel
            obligatoire, les barrières horaires et les décisions de sécurité restent ceux que
            l’organisation publie et annonce. En cas de différence, c’est l’organisation qui fait
            foi.
          </li>
          <li>
            Ni un avis médical. Les temps, les allures, les repères et les quantités proposés sont
            des estimations indicatives, que vous choisissez et ajustez vous-même.
          </li>
          <li>Ni un outil de suivi en direct pendant la course.</li>
        </ul>

        <h2>Accès</h2>
        <p>
          PLUKA s’adresse aux personnes de 15 ans et plus. Le compte est personnel : vous vous
          connectez avec votre adresse e-mail, et vous êtes responsable de son usage.
        </p>

        <h2>Offres</h2>
        <p>
          L’accès gratuit comprend les informations officielles de la course et un premier plan.
          Certaines fonctions avancées demandent un accès payant pour une course ou pour la saison,
          ou un accès offert par l’organisation. Pendant la bêta, aucun paiement n’est possible ;
          les testeurs invités ont l’accès complet jusqu’à la date annoncée. Les informations
          officielles de sécurité ne sont jamais réservées à un accès payant.
        </p>

        <h2>Vos contenus</h2>
        <p>
          Votre préparation vous appartient. Elle n’est jamais montrée à une organisation, même
          lorsque celle-ci vous offre l’accès. Vous pouvez à tout moment l’exporter ou la supprimer
          depuis votre profil (voir la{' '}
          <Link href="/confidentialite">politique de confidentialité</Link>).
        </p>

        <h2>Usage attendu</h2>
        <p>
          Vous vous engagez à ne pas détourner le service, à ne pas tenter d’accéder aux données
          d’autrui, et à ne pas publier de contenu illicite ou trompeur. PLUKA peut suspendre un
          compte qui ne respecte pas ces règles.
        </p>

        <h2>Responsabilité</h2>
        <p>
          PLUKA fait de son mieux pour un service exact et disponible, sans pouvoir le garantir,
          surtout pendant la bêta. La pratique du trail comporte des risques : vous restez seul juge
          de votre préparation, de votre état de forme et de votre sécurité, et vous suivez les
          consignes de l’organisation.
        </p>

        <h2>Évolution et fin</h2>
        <p>
          Ces conditions peuvent évoluer ; la date de mise à jour figure en haut de la page. Vous
          pouvez supprimer votre compte à tout moment depuis votre profil, ou en écrivant à{' '}
          {email === null ? TODO : <a href={`mailto:${email}`}>{email}</a>}.
        </p>

        <h2>Droit applicable</h2>
        <p>
          Ces conditions sont soumises au droit français. En cas de litige, une solution amiable est
          recherchée d’abord.
        </p>
      </main>

      <SiteFooter
        layout="grid"
        tagline={home.footerTagline}
        columns={home.footerColumns}
        domain="pluka.run"
        disclaimer={home.footerDisclaimer}
      />
    </div>
  );
}
