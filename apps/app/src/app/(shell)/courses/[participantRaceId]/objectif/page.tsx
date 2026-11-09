import {
  DomainError,
  can,
  getPlanOverview,
  getTrailProfile,
  resolveEntitlements,
} from '@pluka/domain';
import { Divider, SectionHeader } from '@pluka/ui';

import { ObjectiveForm } from '@/app/(shell)/courses/[participantRaceId]/objectif/objective-form';
import { RepereHelper } from '@/app/(shell)/courses/[participantRaceId]/objectif/repere-helper';
import { planContext, redirectOnDomainError } from '@/lib/plan';
import { profileContext } from '@/lib/profile';
import { repereEnabled } from '@/lib/repere';
import { requireSession } from '@/lib/session';

/**
 * Mon objectif — `05_ROUTES_FLOWS.md` §1.7, §5.2.
 *
 * Scopé à la participation : elle existe déjà quand on arrive ici, créée par la
 * validation de la course sur la fiche épreuve.
 *
 * 00_PRODUCT_SPEC §9.1 : « le coureur choisit l'objectif qu'il veut préparer,
 * en HH:MM. L'objectif reste la décision du coureur. » Le Repère PLUKA
 * (docs/engines/REPERE_PLUKA.md) n'apparaît qu'en bêta, derrière le flag
 * `repere_pluka` : une plage indicative, que le coureur reprend ou non.
 *
 * Ce que l'écran donne à la place, c'est l'aperçu : l'objectif saisi produit un
 * Plan, et le Plan se lit. C'est plus honnête qu'une estimation et c'est déjà
 * calculé par le moteur.
 */

export const metadata = { title: 'Mon objectif' };

export default async function ObjectivePage({
  params,
}: {
  readonly params: Promise<{ readonly participantRaceId: string }>;
}) {
  const { participantRaceId } = await params;
  const returnTo = `/courses/${participantRaceId}/objectif`;

  const session = await requireSession(returnTo);
  const context = planContext(session);
  // 04_ENTITLEMENTS : changer d'objectif est une capacité premium. L'écran le
  // dit avant le geste ; le domaine reste seul juge au moment de l'écrire.
  const canChangeTarget = await resolveEntitlements(context, { participantRaceId })
    .then((resolved) => can(resolved, 'plan.edit').allowed)
    .catch(() => true);
  const withRepere = repereEnabled();
  const profile = withRepere
    ? (await getTrailProfile(profileContext(session)).catch(() => null))?.profile ?? null
    : null;

  /*
   * Un Plan existe déjà quand le coureur revient changer d'objectif. Son
   * absence est l'état normal juste après la validation de la course, pas une
   * erreur : l'écran propose alors de le créer.
   */
  const overview = await getPlanOverview(context, { participantRaceId }).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === 'not_found') return null;
    return redirectOnDomainError(error);
  });

  return (
    <div className="ap-page">
      <SectionHeader eyebrow="Ma course" title="Mon objectif" />

      <p className="pk-body rp-measure">
        Indique le chrono que tu vises, arrêts compris. PLUKA le répartit sur le parcours réel —
        distance, dénivelé et sections — puis te montre les temps de passage qui en découlent.
      </p>

      <Divider spaced />

      <ObjectiveForm
        participantRaceId={participantRaceId}
        currentTargetSeconds={overview?.targetDurationSeconds ?? null}
        hasPlan={overview !== null}
        canChangeTarget={canChangeTarget}
        repere={
          withRepere ? (
            <RepereHelper
              participantRaceId={participantRaceId}
              targetInputId="objective-target"
              defaults={{
                distanceKm: profile?.representativeDistanceKm ?? null,
                elevationGainM: profile?.representativeElevationGainM ?? null,
                durationSeconds: profile?.representativeDurationSeconds ?? null,
                date: profile?.representativeEffortDate ?? null,
                paceSecondsPerKm: profile?.fallbackTrailPaceSecondsPerKm ?? null,
              }}
            />
          ) : undefined
        }
      />
    </div>
  );
}
