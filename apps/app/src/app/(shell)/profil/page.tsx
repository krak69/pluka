import { getTrailProfile } from '@pluka/domain';
import { Badge, Divider, SectionHeader } from '@pluka/ui';
import Link from 'next/link';

import { repereEnabled } from '@/lib/repere';

import { ProfileForms } from '@/app/(shell)/profil/profile-forms';
import { DeleteAccountForm } from '@/components/account-forms';
import { publicEnv } from '@/lib/env';
import { organizerPathOf } from '@/lib/organizer-link';
import { requireProfileContext } from '@/lib/profile';
import { requireSession } from '@/lib/session';

/**
 * Profil trailer — `05_ROUTES_FLOWS.md` §5.3, 00_PRODUCT_SPEC §8.
 *
 * Route globale : `trail_profiles` porte un profil unique par personne, et il
 * sert toutes les courses. §1.7 de 05_ROUTES_FLOWS l'explique — seul l'objectif
 * est scopé à une participation.
 *
 * §8 le fait remplir en deux écrans. Ici, deux formulaires sur une même route :
 * ce sont des étapes de formulaire, donc un état, pas deux adresses (§1.2).
 *
 * Un profil partiel est un état normal, pas une anomalie : §7.2 suppose qu'on
 * puisse le reprendre plus tard, donc l'enregistrer avant la fin. Le use case
 * dit s'il est complet, il ne l'exige pas.
 */

export const metadata = { title: 'Mon profil' };

export default async function ProfilePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const cancelled = (await searchParams).suppression === 'annulee';
  const view = await getTrailProfile(await requireProfileContext('/profil'));
  // Sur mobile, la barre du bas est pleine : c'est ici que le lien se trouve.
  const organizerHref = await organizerPathOf(await requireSession('/profil'));

  return (
    <div className="ap-page">
      <SectionHeader
        eyebrow="Mon compte"
        title="Mon profil"
        aside={
          view.complete ? (
            <Badge tone="success">Signal d’allure exploitable</Badge>
          ) : (
            <Badge tone="neutral">À compléter</Badge>
          )
        }
      />

      {cancelled ? (
        <p className="pk-body rp-measure" role="status">
          Tu t’es reconnecté : la suppression de ton compte est annulée.
        </p>
      ) : null}

      <p className="pk-body rp-measure">
        Un seul profil sert toutes tes courses. Il donne à PLUKA de quoi estimer tes temps de
        passage : un effort que tu connais bien, ou à défaut ton allure de confort en trail.
      </p>

      {view.complete ? null : (
        <p className="rp-hint">
          Tant que ni l’effort de référence ni l’allure de confort ne sont renseignés, PLUKA ne peut
          pas estimer tes passages — il te faudra donner un objectif explicite.
        </p>
      )}

      <Divider spaced />

      <ProfileForms profile={view.profile} />

      {repereEnabled() ? (
        <>
          <Divider spaced />
          <p className="pk-body">
            <Link href="/profil/repere" className="pk-link">
              Aider à calibrer le Repère PLUKA (bêta)
            </Link>
          </p>
        </>
      ) : null}

      {organizerHref === null ? null : (
        <>
          <Divider spaced />
          <Link href={organizerHref} className="pk-link">
            Espace organisateur
          </Link>
        </>
      )}

      <Divider spaced />

      <section aria-labelledby="mes-donnees">
        <h2 id="mes-donnees" className="pk-h2">
          Mes données
        </h2>
        <p className="pk-body rp-measure">
          Tout ce que PLUKA garde sur toi, dans un fichier : compte, profil, courses, Plans,
          Nutrition, sorties, assistance. Voir aussi la{' '}
          <a href={`${publicEnv().NEXT_PUBLIC_SITE_URL}/confidentialite`} className="pk-link">
            politique de confidentialité
          </a>
          .
        </p>
        <p className="pk-body">
          {/* Un téléchargement, pas une navigation : un lien simple, sans préchargement. */}
          <a href="/profil/donnees" className="pk-link" download>
            Télécharger mes données
          </a>
        </p>

        <details className="st-details or-danger">
          <summary>Supprimer mon compte</summary>
          <DeleteAccountForm />
        </details>
      </section>
    </div>
  );
}
