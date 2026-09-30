import { DomainError, getPlanOverview } from '@pluka/domain';
import { Divider, SectionHeader } from '@pluka/ui';

import { ObjectiveForm } from '@/app/(shell)/courses/[participantRaceId]/objectif/objective-form';
import { redirectOnDomainError, requirePlanContext } from '@/lib/plan';

/**
 * Mon objectif — `05_ROUTES_FLOWS.md` §1.7, §5.2.
 *
 * Scopé à la participation : elle existe déjà quand on arrive ici, créée par la
 * validation de la course sur la fiche épreuve.
 *
 * 00_PRODUCT_SPEC §9.1 : « le coureur choisit l'objectif qu'il veut préparer,
 * en HH:MM. L'objectif reste la décision du coureur. » Aucune suggestion n'est
 * affichée — le Repère PLUKA n'est ni spécifié ni calibré (PLAN_ENGINE §46), et
 * afficher un chrono sans modèle validé serait une fausse confiance.
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

  const context = await requirePlanContext(returnTo);

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
      />
    </div>
  );
}
