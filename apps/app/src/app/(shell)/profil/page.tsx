import { getTrailProfile } from '@pluka/domain';
import { Badge, Divider, SectionHeader } from '@pluka/ui';

import { ProfileForms } from '@/app/(shell)/profil/profile-forms';
import { requireProfileContext } from '@/lib/profile';

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

export const metadata = { title: 'Profil trailer' };

export default async function ProfilePage() {
  const view = await getTrailProfile(await requireProfileContext('/profil'));

  return (
    <div className="ap-page">
      <SectionHeader
        eyebrow="Mon compte"
        title="Profil trailer"
        aside={
          view.complete ? (
            <Badge tone="success">Signal d’allure exploitable</Badge>
          ) : (
            <Badge tone="neutral">À compléter</Badge>
          )
        }
      />

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
    </div>
  );
}
