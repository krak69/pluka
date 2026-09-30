import { DomainError, getPlanOverview } from '@pluka/domain';
import { Divider, SectionHeader } from '@pluka/ui';

import { AltitudeProfile } from '@/app/(shell)/courses/[participantRaceId]/plan/altitude-profile';
import { GeneratePlanForm } from '@/app/(shell)/courses/[participantRaceId]/plan/generate-form';
import { PlanPoints } from '@/app/(shell)/courses/[participantRaceId]/plan/plan-points';
import { redirectOnDomainError, requirePlanContext } from '@/lib/plan';

/**
 * Écran du Plan — docs/engines/PLAN_ENGINE.md §64, 06_DESIGN_SYSTEM.md §47.
 *
 * Server Component (01_ARCHITECTURE §6.1). Il lit par `getPlanOverview` et
 * n'écrit rien : les mutations passent par les Server Actions, qui appellent
 * les commandes de §63.
 *
 * §64 énumère ce que l'écran doit permettre d'afficher, et l'ordre suit la
 * question du coureur : où j'en suis (objectif, arrivée, écart), à quoi
 * ressemble le terrain (profil), et le détail point par point.
 *
 * Aucun droit n'est testé ici. La lecture du Plan est Free (§41), l'édition ne
 * l'est pas, et §45 refuse le « bouton masqué côté UI seulement » : les
 * commandes sont proposées, le domaine tranche, et le refus revient lisible à
 * côté du formulaire. Un coureur apprend ce qui lui manque plutôt que de se
 * demander pourquoi un bouton a disparu.
 */
export default async function PlanPage({
  params,
}: {
  readonly params: Promise<{ readonly participantRaceId: string }>;
}) {
  const { participantRaceId } = await params;
  const returnTo = `/courses/${participantRaceId}/plan`;

  const context = await requirePlanContext(returnTo);
  const overview = await getPlanOverview(context, { participantRaceId }).catch((error: unknown) => {
    // Pas encore de Plan : l'écran propose de le générer plutôt que de rendre
    // un 404. La participation existe, elle n'a simplement pas d'horaires.
    if (error instanceof DomainError && error.code === 'not_found') return null;

    return redirectOnDomainError(error);
  });

  return (
    /*
     * La largeur et les marges viennent du shell — `.ap-content` porte
     * `--content-main`. Les reposer ici produirait deux gouttières imbriquées.
     */
    <div className="ap-page">
      <SectionHeader eyebrow="Ma course" title="Plan de course" />

      <p className="pk-body rp-measure">
        PLUKA répartit ton objectif sur le parcours réel. Les passages sont estimés à partir du
        relief ; ils restent modifiables, et tes choix ne sont jamais recalculés sans toi.
      </p>

      <Divider spaced />

      {overview === null ? (
        <GeneratePlanForm participantRaceId={participantRaceId} />
      ) : (
        <>
          <AltitudeProfile
            profile={overview.profile}
            points={overview.points}
            timezone={overview.timezone}
            anchored={overview.profileIsAnchored}
          />

          <Divider spaced />

          <PlanPoints
            participantRaceId={participantRaceId}
            overview={overview}
            timezone={overview.timezone}
          />

          <Divider spaced />

          <p className="pk-body" style={{ color: 'var(--pk-text-muted)' }}>
            Version {overview.version} · moteur {overview.engineVersion}
          </p>
        </>
      )}
    </div>
  );
}
