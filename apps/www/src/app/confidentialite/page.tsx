import type { Metadata } from 'next';
import Link from 'next/link';

import { SiteFooter } from '@/components/site-footer';
import * as home from '@/content/homepage';
import { LEGAL, legalComplete } from '@/content/legal';

/**
 * Politique de confidentialité — docs/legal/RGPD_AUTO_EVALUATION.md.
 *
 * Elle dit ce que le produit fait réellement, et rien de plus : chaque
 * affirmation correspond à une règle du code ou de la base. Tant que l'éditeur
 * et l'adresse de contact ne sont pas renseignés (`content/legal.ts`), la page
 * n'est pas indexée.
 */
export function generateMetadata(): Metadata {
  return {
    title: 'Politique de confidentialité — PLUKA',
    description: 'Ce que PLUKA collecte, pourquoi, combien de temps, et vos droits.',
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

export default function PrivacyPage() {
  const editor = LEGAL.editorName ?? TODO;
  const email = LEGAL.privacyEmail;

  return (
    <div className="lp-shell">
      <main className="lp-main lp-legal">
        <p>
          <Link href="/">PLUKA</Link>
        </p>

        <h1>Politique de confidentialité</h1>
        <p className="lp-legal-meta">Mise à jour le {day(LEGAL.updatedOn)} · service en bêta</p>

        <p>
          PLUKA aide les coureurs de trail à préparer une course : plan de course, nutrition,
          préparation, assistance. Cette page dit quelles données nous traitons, pourquoi, combien
          de temps, qui y a accès, et comment exercer vos droits.
        </p>

        <h2>Qui est responsable</h2>
        <p>
          PLUKA est édité par {editor}, à titre personnel pendant la bêta, responsable des
          traitements décrits ici. Pour toute question ou demande sur vos données :{' '}
          {email === null ? TODO : <a href={`mailto:${email}`}>{email}</a>}.
        </p>

        <h2>Ce que nous collectons</h2>
        <ul>
          <li>
            <strong>Votre compte :</strong> adresse e-mail, prénom et nom si vous les donnez.
          </li>
          <li>
            <strong>Votre profil trailer :</strong> un effort de référence ou une allure, votre
            volume habituel, votre aisance en montée et en descente.
          </li>
          <li>
            <strong>Votre préparation :</strong> les courses que vous préparez, votre objectif,
            votre plan, votre nutrition, votre matériel, votre assistance, vos sorties et vos notes.
          </li>
          <li>
            <strong>Si une organisation vous inscrit :</strong> la liste qu’elle nous transmet —
            nom, e-mail, dossard, vague, et parfois sexe, date de naissance, nationalité et indices
            de performance.
          </li>
          <li>
            <strong>Le Repère PLUKA (bêta) :</strong> les efforts et les temps que vous saisissez
            pour obtenir une plage de chrono, ou pour aider à la calibrer.
          </li>
          <li>
            <strong>Les messages</strong> envoyés depuis le site d’un événement à son organisation.
          </li>
          <li>
            <strong>Des données techniques :</strong> un journal des actions sensibles, sans adresse
            ni contenu, pour la sécurité du service.
          </li>
        </ul>

        <h2>Pourquoi, et sur quelle base</h2>
        <ul>
          <li>
            <strong>Vous fournir le service</strong> (compte, préparation, Repère) : l’exécution des
            conditions d’utilisation que vous acceptez.
          </li>
          <li>
            <strong>Vous inviter de la part d’une organisation :</strong> l’organisation est
            responsable de sa liste d’inscrits et nous la traitons pour elle, comme sous-traitant.
            C’est à elle de vous en informer lors de l’inscription.
          </li>
          <li>
            <strong>Transmettre un message</strong> à une organisation : votre demande.
          </li>
          <li>
            <strong>Sécuriser le service</strong> (journal) : notre intérêt légitime.
          </li>
        </ul>
        <p>Nous ne vendons aucune donnée, et PLUKA n’affiche aucune publicité.</p>

        <h2>Ce que voit une organisation</h2>
        <p>
          Une organisation voit sa liste d’inscrits, l’état de chaque invitation, et des chiffres
          d’ensemble calculés sur au moins dix participants. Elle ne voit jamais votre plan, votre
          nutrition, votre assistance, vos sorties ni vos notes, même lorsqu’elle vous offre l’accès
          à PLUKA.
        </p>

        <h2>Les invitations</h2>
        <p>
          Si une organisation nous transmet votre adresse, vous recevez une invitation à son nom.
          Elle dit d’où vient votre adresse et contient un lien pour refuser d’être contacté. Si
          vous refusez, l’invitation est annulée et cette organisation ne peut plus vous la
          renvoyer.
        </p>

        <h2>Qui d’autre traite vos données</h2>
        <p>Nous faisons appel à des prestataires, qui n’agissent que sur nos instructions :</p>
        <ul>
          <li>Supabase : base de données, authentification et stockage des fichiers ;</li>
          <li>Vercel : hébergement de l’application et du site ;</li>
          <li>Resend : envoi des e-mails (connexion, invitations, avis sur une course) ;</li>
          <li>
            Anthropic : lecture des documents officiels des courses (règlements, guides). Aucune
            donnée de votre préparation ne lui est envoyée.
          </li>
        </ul>
        <p>
          Ces prestataires sont établis aux États-Unis. Resend et Vercel déclarent être certifiés au
          Data Privacy Framework UE–États-Unis ; Supabase encadre ses transferts par les clauses
          contractuelles types de la Commission européenne. Anthropic ne reçoit que des documents
          publics des courses.
        </p>

        <h2>Combien de temps</h2>
        <ul>
          <li>
            Votre compte et votre préparation : tant que votre compte est actif. Après bientôt 3 ans
            sans connexion, un e-mail vous prévient ; sans connexion dans les 30 jours qui suivent,
            ils sont supprimés.
          </li>
          <li>
            Une liste d’inscrits transmise par une organisation : jusqu’à 12 mois après l’édition.
          </li>
          <li>Le journal de sécurité : 1 an.</li>
          <li>
            Un refus d’être contacté : tant que l’organisation existe, pour qu’elle ne puisse pas
            vous recontacter.
          </li>
          <li>Un message envoyé à une organisation : effacé dès qu’il lui est transmis.</li>
        </ul>

        <h2>Vos droits</h2>
        <p>
          Vous pouvez accéder à vos données, les corriger, les faire effacer, vous opposer à un
          traitement, en demander la limitation ou les recevoir dans un format lisible. Écrivez-nous
          à {email === null ? TODO : <a href={`mailto:${email}`}>{email}</a>} : nous répondons sous
          un mois.
        </p>
        <p>
          Depuis votre profil, dans l’application, vous pouvez aussi télécharger toutes vos données
          et supprimer votre compte. La suppression ferme le compte tout de suite ; les données sont
          effacées 30 jours plus tard, et vous reconnecter d’ici là l’annule. Une course venue d’une
          organisation lui reste, sans votre préparation, jusqu’à la fin de sa durée de conservation
          ; ce que vous avez publié dans la communauté reste, sans votre nom.
        </p>
        <p>
          Si vous estimez que vos droits ne sont pas respectés, vous pouvez saisir la CNIL
          (cnil.fr).
        </p>

        <h2>Âge</h2>
        <p>PLUKA s’adresse aux personnes de 15 ans et plus.</p>

        <h2>Cookies</h2>
        <p>
          PLUKA n’utilise que les cookies nécessaires à votre connexion. Aucun cookie de mesure
          d’audience ni de publicité.
        </p>

        <h2>Sécurité</h2>
        <p>
          L’accès aux données est fermé par défaut et vérifié par la base elle-même pour chaque
          demande. Les liens d’invitation sont personnels, et seule leur empreinte est conservée.
          Les données importées les plus sensibles sont rangées à part, hors de portée des
          organisations.
        </p>

        <h2>Modifications</h2>
        <p>
          Cette politique peut évoluer avec le service. La date de mise à jour figure en haut de la
          page.
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
