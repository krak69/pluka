import {
  DomainError,
  getNutritionStrategy,
  getPlanCourseChange,
  getPlanOverview,
  getPlanStartDrift,
  getRaceConditions,
  listStartChanges,
} from '@pluka/domain';
import { MicroLabel } from '@pluka/ui';
import Link from 'next/link';

import { AltitudeProfile } from '@/app/(shell)/courses/[participantRaceId]/plan/altitude-profile';
import { GeneratePlanForm } from '@/app/(shell)/courses/[participantRaceId]/plan/generate-form';
import {
  NutritionBand,
  NutritionFoot,
} from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-band';
import { PlanBoard } from '@/app/(shell)/courses/[participantRaceId]/plan/plan-board';
import {
  DriftDecision,
  PlanPoints,
  PlanSettings,
  type PlanTimelineNutrition,
} from '@/app/(shell)/courses/[participantRaceId]/plan/plan-points';
import { CourseChangeAlert } from '@/components/course-change-alert';
import { StartChangeAlert } from '@/components/start-change-alert';
import { conditionsContext, conditionsEnabled } from '@/lib/conditions';
import { conditionsTeaser } from '@/lib/conditions-format';
import { nutritionContext } from '@/lib/nutrition';
import {
  aidLines,
  editableProducts,
  flaskView,
  profileIntakes,
  timelineNutrition,
} from '@/lib/nutrition-format';
import { planContext, redirectOnDomainError } from '@/lib/plan';
import {
  formatClock,
  formatDuration,
  formatSigned,
  formatStartMoment,
  formatTotalStops,
} from '@/lib/plan-format';
import { requireSession } from '@/lib/session';
import { startChangeContext } from '@/lib/start-changes';

function waveLabel(name: string | null): string {
  return name === null ? 'départ de l’épreuve' : `vague ${name}`;
}

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

  const session = await requireSession(returnTo);
  const context = planContext(session);
  // 0082 : une alerte non refermée, écrite par la base quand la vague du
  // coureur change. Une lecture en échec n'empêche pas le Plan de s'afficher.
  const startChanges = await listStartChanges(startChangeContext(session), {
    participantRaceId,
  }).catch(() => []);
  // L'organisation a pu déplacer le départ sans changer de vague (l'heure de
  // l'épreuve) : l'écart entre le Plan et l'heure actuelle suffit à le dire.
  const drift = await getPlanStartDrift(context, { participantRaceId }).catch(() => null);
  // PLAN_ENGINE §39 : un point ajouté, retiré ou déplacé depuis le calcul du Plan.
  const courseChange = await getPlanCourseChange(context, { participantRaceId }).catch(() => null);
  // La Nutrition, sous le Plan ; une lecture en échec n'empêche pas le Plan de s'afficher.
  const nutrition = await getNutritionStrategy(nutritionContext(session), {
    participantRaceId,
  }).catch(() => null);
  // Prototype : le bouton « Conditions » de la bande, une fois J-14 ouvert.
  const conditions = conditionsEnabled()
    ? await getRaceConditions(conditionsContext(session), { participantRaceId }).catch(() => null)
    : null;
  const conditionsSub = conditions === null ? null : conditionsTeaser(conditions);
  const overview = await getPlanOverview(context, { participantRaceId }).catch((error: unknown) => {
    // Pas encore de Plan : l'écran propose de le générer plutôt que de rendre
    // un 404. La participation existe, elle n'a simplement pas d'horaires.
    if (error instanceof DomainError && error.code === 'not_found') return null;

    return redirectOnDomainError(error);
  });

  const latest = startChanges[0];
  let timezone = overview?.timezone ?? null;
  if ((latest !== undefined || drift !== null) && timezone === null) {
    const participation = await context.repositories.participantRaces.findById(participantRaceId);
    const race =
      participation === null
        ? null
        : await context.repositories.races.findById(participation.raceId);
    timezone = race?.timezone ?? null;
  }

  // L'arrivée est l'heure prévue du dernier point : rien à recalculer.
  const finishAt = overview?.points[overview.points.length - 1]?.plannedArrivalAt ?? null;

  // « Ma stratégie » : les prises rangées dans la frise du Plan, point par point.
  const timeline: PlanTimelineNutrition | null =
    overview === null ||
    nutrition === null ||
    nutrition.state !== 'ready' ||
    nutrition.result === null ||
    nutrition.settings === null
      ? null
      : {
          marks: timelineNutrition(
            nutrition.result,
            nutrition.startAt,
            nutrition.timezone,
            overview.points,
            nutrition.preparation?.points ?? [],
          ),
          products: editableProducts(nutrition.products, nutrition.settings.selectedProductIds),
          aid: aidLines(nutrition.aid),
          hasDrink:
            nutrition.result.flasks === null
              ? null
              : flaskView(
                  nutrition.result.flasks,
                  nutrition.result,
                  nutrition.startAt,
                  nutrition.timezone,
                ).hasDrink,
          canEdit: nutrition.canEdit,
        };

  return (
    <div className="ap-page pl-page">
      {timezone === null ? null : latest !== undefined ? (
        <StartChangeAlert
          participantRaceId={participantRaceId}
          count={startChanges.length}
          canShift={drift !== null}
          canDismiss
          change={{
            before: waveLabel(latest.previousWaveName),
            after: waveLabel(latest.newWaveName),
            beforeAt: formatStartMoment(latest.previousStartAt, timezone),
            afterAt: formatStartMoment(latest.newStartAt, timezone),
          }}
        />
      ) : drift !== null ? (
        // L'heure de l'épreuve a bougé : rien à refermer, le Plan reste à décaler.
        <StartChangeAlert
          participantRaceId={participantRaceId}
          count={1}
          canShift
          canDismiss={false}
          change={{
            before: null,
            after: null,
            beforeAt: formatStartMoment(drift.planStartAt, timezone),
            afterAt: formatStartMoment(drift.officialStartAt, timezone),
          }}
        />
      ) : null}

      {courseChange === null ? null : (
        <CourseChangeAlert participantRaceId={participantRaceId} change={courseChange} />
      )}

      {overview === null ? (
        <section className="pl-hero">
          <MicroLabel className="pl-eyebrow">Mon plan</MicroLabel>
          <h1 className="pl-hero-title">Construis ton plan de course.</h1>
          <p className="pl-hero-lead">
            PLUKA répartit ton objectif sur le parcours réel. Les passages sont estimés à partir du
            relief ; ils restent modifiables, et tes choix ne sont jamais recalculés sans toi.
          </p>
          <div className="pl-hero-form">
            <GeneratePlanForm participantRaceId={participantRaceId} />
          </div>
        </section>
      ) : (
        <>
          {/* Bannière du Plan — prototype : la durée, l'arrivée, la marge, le relief. */}
          <section className="pl-hero" aria-labelledby="pl-title">
            <div className="pl-hero-top">
              <div className="pl-hero-summary">
                <MicroLabel className="pl-eyebrow">Mon plan</MicroLabel>
                <h1 id="pl-title" className="pl-hero-duration">
                  {formatDuration(overview.finishElapsedSeconds)}
                  {overview.driftSeconds === 0 ? null : (
                    <span className="pl-hero-target">
                      objectif {formatDuration(overview.targetDurationSeconds)}
                    </span>
                  )}
                </h1>
                <p className="pl-hero-line">
                  Départ {formatClock(overview.startAt, overview.timezone)} →{' '}
                  <strong>
                    arrivée estimée{' '}
                    {finishAt === null ? '' : formatClock(finishAt, overview.timezone)}
                  </strong>
                </p>
                <p className="pl-hero-facts">
                  {overview.tightestCutoff === null ? null : (
                    <span>
                      Marge minimale{' '}
                      <strong
                        className={
                          overview.tightestCutoff.status === 'comfortable' ? 'pl-good' : 'pl-warn'
                        }
                      >
                        {formatSigned(overview.tightestCutoff.marginSeconds)} ·{' '}
                        {overview.tightestCutoff.waypointName}
                      </strong>
                    </span>
                  )}
                  <span>
                    Arrêts cumulés <strong>{formatTotalStops(overview.points)}</strong>
                  </span>
                </p>
              </div>
              <div className="pl-hero-actions">
                <Link href="#reglages" className="pl-hero-edit">
                  Modifier mon plan
                </Link>
                {conditionsSub === null ? null : (
                  <Link href={`${returnTo}/conditions`} className="pl-hero-conditions">
                    <span className="pl-hero-conditions-title">Conditions</span>
                    <span className="pk-data pl-hero-conditions-sub">{conditionsSub}</span>
                  </Link>
                )}
              </div>
            </div>

            <AltitudeProfile
              profile={overview.profile}
              points={overview.points}
              timezone={overview.timezone}
              anchored={overview.profileIsAnchored}
              variant="dark"
              cutoffWaypointIds={overview.cutoffs.map((cutoff) => cutoff.raceWaypointId)}
              nutrition={
                nutrition === null || nutrition.state === 'no_plan'
                  ? null
                  : nutrition.state === 'ready' && nutrition.result !== null
                    ? {
                        state: 'ready',
                        intakes: profileIntakes(
                          nutrition.result,
                          nutrition.startAt,
                          nutrition.timezone,
                        ),
                      }
                    : { state: 'off' }
              }
            />
          </section>

          <PlanBoard>
            <DriftDecision participantRaceId={participantRaceId} overview={overview} />

            {/* AGENTS §39 : la Nutrition vit sous le Plan, pas dans un onglet. */}
            {nutrition === null ? null : (
              <NutritionBand participantRaceId={participantRaceId} view={nutrition} />
            )}

            <PlanPoints
              participantRaceId={participantRaceId}
              overview={overview}
              timezone={overview.timezone}
              nutrition={timeline}
            />
          </PlanBoard>

          {nutrition === null ? null : (
            <NutritionFoot participantRaceId={participantRaceId} view={nutrition} />
          )}

          <PlanSettings participantRaceId={participantRaceId} overview={overview} />

          <p className="pl-version">
            Version {overview.version} · moteur {overview.engineVersion}
          </p>
        </>
      )}
    </div>
  );
}
