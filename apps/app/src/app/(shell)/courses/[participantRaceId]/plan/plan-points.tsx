'use client';

import type { PlanCutoffView, PlanOverview, PlanPointView } from '@pluka/domain';
import { Button, Input, StatusBadge } from '@pluka/ui';
import { useActionState } from 'react';

import {
  changePlanTargetAction,
  preservePlanAction,
  rebalancePlanAction,
  removeSegmentOverrideAction,
  updateSegmentDurationAction,
  updateStopAction,
  type ActionState,
} from '@/app/actions';
import { lockWaypointAction, resetPlanAction } from '@/app/profile-actions';
import {
  formatClock,
  formatDistance,
  formatElapsed,
  formatMinutes,
  formatPace,
  formatSigned,
} from '@/lib/plan-format';

/**
 * Frise des passages et réglages du Plan — PLAN_ENGINE §64, §65 ;
 * 06_DESIGN_SYSTEM.md §53 ; prototype, `tab: 'plan'`.
 *
 * L'heure prévue à gauche, une carte par point, et entre deux points la
 * section qui les relie. §64 énumère ce qui doit être affichable — durée de
 * chaque section, ETA de chaque point, temps écoulé, arrêt, verrou, marge à la
 * barrière — et tout y est.
 *
 * RIEN N'EST CALCULÉ ICI
 *
 * Chaque valeur affichée vient de `getPlanOverview` — horaires, allures,
 * marges, dérive. Ce composant met en forme des nombres déjà résolus : §35 du
 * moteur veut un résultat déterministe côté serveur, et un recalcul dans le
 * navigateur en produirait un second, forcément divergent un jour.
 *
 * Les réglages d'un point se replient dans sa carte : la frise reste lisible,
 * et chaque geste reste à un clic, nommé, à côté de ce qu'il change (§24).
 */

const INITIAL: ActionState = {};

/** §185 du Design System : un état se lit, il ne se devine pas à la couleur. */
const MARGIN_LABEL: Readonly<Record<string, string>> = {
  comfortable: 'Marge confortable',
  watch: 'À surveiller',
  critical: 'Marge critique',
  beyond: 'Barrière dépassée',
};

const MARGIN_TONE: Readonly<Record<string, 'success' | 'warning' | 'error' | 'neutral'>> = {
  comfortable: 'success',
  watch: 'warning',
  critical: 'warning',
  beyond: 'error',
};

/** « Départ », « Arrivée » — sauf quand le point porte déjà ce nom. */
function kindOf(name: string, index: number, lastIndex: number): string | null {
  const kind = index === 0 ? 'Départ' : index === lastIndex ? 'Arrivée' : null;
  return kind !== null && name.trim().toLowerCase() === kind.toLowerCase() ? null : kind;
}

export interface PlanPointsProps {
  readonly participantRaceId: string;
  readonly overview: PlanOverview;
  readonly timezone: string;
}

export function PlanPoints({ participantRaceId, overview, timezone }: PlanPointsProps) {
  const marginByWaypoint = new Map(
    overview.cutoffs.map((cutoff) => [cutoff.raceWaypointId, cutoff]),
  );
  const lastIndex = overview.points.length - 1;

  return (
    <>
      <DriftDecision participantRaceId={participantRaceId} overview={overview} />

      <section aria-labelledby="pl-points-title" className="pl-timeline-wrap">
        <h2 id="pl-points-title" className="pk-visually-hidden">
          Points du parcours
        </h2>
        <ol className="pl-timeline">
          {overview.points.map((point, index) => (
            <TimelineItem
              key={point.raceWaypointId}
              participantRaceId={participantRaceId}
              point={point}
              timezone={timezone}
              cutoff={marginByWaypoint.get(point.raceWaypointId)}
              tightest={overview.tightestCutoff?.raceWaypointId === point.raceWaypointId}
              kind={kindOf(point.name, index, lastIndex)}
            />
          ))}
        </ol>
      </section>

      <section id="reglages" aria-labelledby="pl-settings-title" className="pl-settings">
        <h2 id="pl-settings-title" className="pl-settings-title">
          Réglages du plan
        </h2>
        <div className="pl-settings-grid">
          <TargetForm participantRaceId={participantRaceId} overview={overview} />
          <ResetPlan participantRaceId={participantRaceId} />
        </div>
      </section>
    </>
  );
}

/**
 * Un Plan dont l'arrivée diverge de l'objectif — §27 l'admet, et les deux
 * boutons qui la résolvent sont deux décisions distinctes (§22, §65).
 */
function DriftDecision({
  participantRaceId,
  overview,
}: {
  readonly participantRaceId: string;
  readonly overview: PlanOverview;
}) {
  const [rebalanceState, rebalance] = useActionState(rebalancePlanAction, INITIAL);
  const [preserveState, preserve] = useActionState(preservePlanAction, INITIAL);

  if (overview.driftSeconds === 0) return null;

  return (
    <section className="pl-drift" aria-labelledby="pl-drift-title">
      <div>
        <h2 id="pl-drift-title" className="pl-drift-title">
          Ton plan arrive {formatSigned(overview.driftSeconds)} par rapport à ton objectif.
        </h2>
        <p className="pl-drift-text">
          Tes ajustements ont déplacé l’arrivée. À toi de choisir : rééquilibrer le reste du
          parcours, ou garder ce plan tel quel.
        </p>
      </div>
      <div className="pl-drift-actions">
        <form action={rebalance}>
          <input type="hidden" name="participantRaceId" value={participantRaceId} />
          <Button type="submit">
            Rééquilibrer pour finir en {formatElapsed(overview.targetDurationSeconds)}
          </Button>
        </form>
        <form action={preserve}>
          <input type="hidden" name="participantRaceId" value={participantRaceId} />
          <Button type="submit" variant="secondary">
            Conserver ce Plan
          </Button>
        </form>
      </div>
      <ActionError state={rebalanceState} />
      <ActionError state={preserveState} />
    </section>
  );
}

function TimelineItem({
  participantRaceId,
  point,
  timezone,
  cutoff,
  tightest,
  kind,
}: {
  readonly participantRaceId: string;
  readonly point: PlanPointView;
  readonly timezone: string;
  readonly cutoff: PlanCutoffView | undefined;
  readonly tightest: boolean;
  readonly kind: string | null;
}) {
  const segment = point.incomingSegment;

  return (
    <li className="pl-item">
      {segment === null ? null : (
        <p className="pl-segment">
          <span>{formatDistance(segment.distanceKm)} km</span>
          <span>{formatPace(segment.paceSecondsPerKm)} /km</span>
          <strong className="pl-segment-duration">
            {formatElapsed(segment.plannedDurationSeconds)}
          </strong>
          {segment.manualOverride ? <span className="pl-chip">Durée imposée</span> : null}
        </p>
      )}

      <div className="pl-row">
        <div className="pl-time">
          <span className="pl-clock">{formatClock(point.plannedArrivalAt, timezone)}</span>
          <span className="pl-elapsed">{formatElapsed(point.plannedElapsedSeconds)}</span>
          <span
            className={
              cutoff !== undefined
                ? 'pl-dot pl-dot-cutoff'
                : kind !== null
                  ? 'pl-dot pl-dot-end'
                  : 'pl-dot'
            }
            aria-hidden="true"
          />
        </div>

        <article className={tightest ? 'pl-card pl-card-tight' : 'pl-card'}>
          <header className="pl-card-head">
            <h3 className="pl-name">
              {point.name}
              {kind === null ? null : <span className="pl-kind">{kind}</span>}
            </h3>
            {cutoff === undefined ? null : (
              <StatusBadge tone={MARGIN_TONE[cutoff.status] ?? 'neutral'}>
                Marge {formatSigned(cutoff.marginSeconds)} ·{' '}
                {MARGIN_LABEL[cutoff.status] ?? cutoff.status}
              </StatusBadge>
            )}
          </header>
          <p className="pl-facts">
            km <span>{formatDistance(point.distanceKm)}</span>
            {point.altitudeM === null ? '' : ` · ${String(Math.round(point.altitudeM))} m`}
            {point.stopDurationSeconds === 0
              ? ''
              : ` · arrêt ${formatMinutes(point.stopDurationSeconds)} min`}
          </p>
          {point.isLocked ? <p className="pl-chip pl-chip-lock">Heure verrouillée</p> : null}

          <details className="pl-adjust">
            <summary>Ajuster ce point</summary>
            <PointEditor participantRaceId={participantRaceId} point={point} />
          </details>
        </article>
      </div>
    </li>
  );
}

/**
 * Édition d'un point : durée de la section qui y mène, arrêt, verrou.
 *
 * §24 gouverne les libellés autant que le code : une durée imposée reste
 * imposée jusqu'à ce que l'utilisateur la retire, et le bouton qui la retire
 * est donc présent, nommé, et distinct de celui qui la pose.
 */
function PointEditor({
  participantRaceId,
  point,
}: {
  readonly participantRaceId: string;
  readonly point: PlanPointView;
}) {
  const [segmentState, updateSegment] = useActionState(updateSegmentDurationAction, INITIAL);
  const [removeState, removeOverride] = useActionState(removeSegmentOverrideAction, INITIAL);
  const [stopState, updateStop] = useActionState(updateStopAction, INITIAL);
  const [lockState, lockWaypoint] = useActionState(lockWaypointAction, INITIAL);

  return (
    <div className="pl-editor">
      {point.incomingSegment === null ? null : (
        <form action={updateSegment} className="pl-editor-form">
          <input type="hidden" name="participantRaceId" value={participantRaceId} />
          <input type="hidden" name="raceSegmentId" value={point.incomingSegment.raceSegmentId} />
          <Input
            id={`section-${point.raceWaypointId}`}
            name="duration"
            label="Durée de la section"
            hint="HH:MM. Elle ne sera plus recalculée."
            defaultValue={formatElapsed(point.incomingSegment.plannedDurationSeconds)}
            {...(segmentState.error === undefined ? {} : { error: segmentState.error })}
          />
          <Button type="submit" variant="secondary">
            Imposer cette durée
          </Button>
        </form>
      )}

      {point.incomingSegment?.manualOverride === true ? (
        <form action={removeOverride} className="pl-editor-form">
          <input type="hidden" name="participantRaceId" value={participantRaceId} />
          <input type="hidden" name="raceSegmentId" value={point.incomingSegment.raceSegmentId} />
          <Button type="submit" variant="secondary">
            Revenir à la proposition PLUKA
          </Button>
          <ActionError state={removeState} />
        </form>
      ) : null}

      <form action={updateStop} className="pl-editor-form">
        <input type="hidden" name="participantRaceId" value={participantRaceId} />
        <input type="hidden" name="raceWaypointId" value={point.raceWaypointId} />
        <Input
          id={`stop-${point.raceWaypointId}`}
          name="minutes"
          type="number"
          label="Arrêt (min)"
          hint="Zéro retire l’arrêt."
          defaultValue={formatMinutes(point.stopDurationSeconds)}
          {...(stopState.error === undefined ? {} : { error: stopState.error })}
        />
        <Button type="submit" variant="secondary">
          Enregistrer l’arrêt
        </Button>
      </form>

      {/*
        Verrou de passage — PLAN_ENGINE §26. Il s'exprime en temps écoulé
        depuis le départ, comme le reste du Plan. Un champ vidé déverrouille :
        c'est le même geste, donc le même formulaire.
      */}
      <form action={lockWaypoint} className="pl-editor-form">
        <input type="hidden" name="participantRaceId" value={participantRaceId} />
        <input type="hidden" name="raceWaypointId" value={point.raceWaypointId} />
        <Input
          id={`lock-${point.raceWaypointId}`}
          name="elapsed"
          label="Passage verrouillé"
          hint="HH:MM depuis le départ. Vide : estimé."
          defaultValue={
            point.lockedElapsedSeconds === null ? '' : formatElapsed(point.lockedElapsedSeconds)
          }
          {...(lockState.error === undefined ? {} : { error: lockState.error })}
        />
        <Button type="submit" variant="secondary">
          {point.isLocked ? 'Mettre à jour' : 'Verrouiller'}
        </Button>
      </form>
    </div>
  );
}

function TargetForm({
  participantRaceId,
  overview,
}: {
  readonly participantRaceId: string;
  readonly overview: PlanOverview;
}) {
  const [state, changeTarget] = useActionState(changePlanTargetAction, INITIAL);

  return (
    <form action={changeTarget} className="pl-setting">
      <h3 className="pl-setting-title">Mon objectif</h3>
      <input type="hidden" name="participantRaceId" value={participantRaceId} />
      <Input
        id="plan-target"
        name="target"
        label="Nouvel objectif"
        hint="Format HH:MM. L’objectif reste ta décision."
        defaultValue={formatElapsed(overview.targetDurationSeconds)}
        {...(state.error === undefined ? {} : { error: state.error })}
      />
      <Button type="submit" variant="secondary">
        Changer l’objectif
      </Button>
    </form>
  );
}

/**
 * Remise à zéro — PLAN_ENGINE §28. Volontairement secondaire : §28 du Design
 * System refuse qu'une action destructive prenne le Lichen d'un CTA.
 */
function ResetPlan({ participantRaceId }: { readonly participantRaceId: string }) {
  const [state, reset] = useActionState(resetPlanAction, INITIAL);

  return (
    <form action={reset} className="pl-setting">
      <h3 className="pl-setting-title">Repartir de zéro</h3>
      <input type="hidden" name="participantRaceId" value={participantRaceId} />
      <p className="pl-setting-text">
        Retire tous tes ajustements — arrêts, durées imposées et passages verrouillés — et
        reconstruit le Plan sur ton objectif.
      </p>
      <Button type="submit" variant="secondary">
        Effacer mes ajustements
      </Button>
      <ActionError state={state} />
    </form>
  );
}

function ActionError({ state }: { readonly state: ActionState }) {
  if (state.error === undefined) return null;

  return (
    <p className="pk-field-error" role="alert">
      {state.error}
    </p>
  );
}
