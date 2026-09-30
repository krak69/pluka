'use client';

import type { PlanOverview, PlanPointView } from '@pluka/domain';
import {
  Badge,
  Button,
  DataValue,
  Divider,
  Input,
  MicroLabel,
  StatusBadge,
  Table,
} from '@pluka/ui';
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
import {
  formatClock,
  formatDistance,
  formatElapsed,
  formatMinutes,
  formatPace,
  formatSigned,
} from '@/lib/plan-format';

/**
 * Points du parcours et édition du Plan — PLAN_ENGINE §64, §65 ;
 * 06_DESIGN_SYSTEM.md §53.
 *
 * §64 énumère ce qui doit être affichable, et la table le porte : durée de
 * chaque section, ETA de chaque waypoint, temps écoulé, arrêt, état
 * verrouillé, marge à la barrière.
 *
 * RIEN N'EST CALCULÉ ICI
 *
 * Chaque valeur affichée vient de `getPlanOverview` — horaires, allures,
 * marges, dérive. Ce composant met en forme des nombres déjà résolus : §35 du
 * moteur veut un résultat déterministe côté serveur, et un recalcul dans le
 * navigateur en produirait un second, forcément divergent un jour.
 *
 * §65 fixe le vocabulaire : « passage estimé », « heure prévue », « arrêt »,
 * « section », « marge », « à surveiller », « rééquilibrer », « conserver ce
 * Plan ». Rien qui promette un chrono.
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

export interface PlanPointsProps {
  readonly participantRaceId: string;
  readonly overview: PlanOverview;
  readonly timezone: string;
}

export function PlanPoints({ participantRaceId, overview, timezone }: PlanPointsProps) {
  const marginByWaypoint = new Map(
    overview.cutoffs.map((cutoff) => [cutoff.raceWaypointId, cutoff]),
  );

  const rows = overview.points.map((point) => {
    const cutoff = marginByWaypoint.get(point.raceWaypointId);

    return {
      key: point.raceWaypointId,
      // §7.2 : Aube marque la prochaine échéance. Le point le plus serré est
      // celui qui mérite l'attention du coureur.
      emphasis: overview.tightestCutoff?.raceWaypointId === point.raceWaypointId,
      cells: {
        name: (
          <span>
            {point.name}
            {point.isLocked ? (
              <>
                {' '}
                <Badge tone="neutral">Heure verrouillée</Badge>
              </>
            ) : null}
          </span>
        ),
        distance: formatDistance(point.distanceKm),
        elapsed: formatElapsed(point.plannedElapsedSeconds),
        clock: formatClock(point.plannedArrivalAt, timezone),
        section:
          point.incomingSegment === null
            ? '—'
            : formatElapsed(point.incomingSegment.plannedDurationSeconds),
        pace:
          point.incomingSegment === null ? '—' : formatPace(point.incomingSegment.paceSecondsPerKm),
        stop: point.stopDurationSeconds === 0 ? '—' : formatElapsed(point.stopDurationSeconds),
        margin:
          cutoff === undefined ? (
            '—'
          ) : (
            <StatusBadge tone={MARGIN_TONE[cutoff.status] ?? 'neutral'}>
              {formatSigned(cutoff.marginSeconds)} · {MARGIN_LABEL[cutoff.status] ?? cutoff.status}
            </StatusBadge>
          ),
      },
    };
  });

  return (
    <>
      <PlanSummary participantRaceId={participantRaceId} overview={overview} timezone={timezone} />

      <Divider spaced />

      <Table
        caption="Points du parcours"
        stickyHeader
        columns={[
          { key: 'name', label: 'Point' },
          { key: 'distance', label: 'Distance', align: 'numeric', unit: 'km' },
          { key: 'section', label: 'Section', align: 'numeric' },
          { key: 'pace', label: 'Allure', align: 'numeric', unit: '/km' },
          { key: 'elapsed', label: 'Temps écoulé', align: 'numeric' },
          { key: 'clock', label: 'Heure prévue', align: 'numeric' },
          { key: 'stop', label: 'Arrêt', align: 'numeric' },
          { key: 'margin', label: 'Marge' },
        ]}
        rows={rows}
      />

      <Divider spaced />

      <MicroLabel>Ajuster le Plan</MicroLabel>
      <div style={{ display: 'grid', gap: 'var(--space-6)', marginTop: 'var(--space-3)' }}>
        {overview.points.map((point) => (
          <PointEditor
            key={point.raceWaypointId}
            participantRaceId={participantRaceId}
            point={point}
          />
        ))}
      </div>
    </>
  );
}

/**
 * Objectif, arrivée, dérive, et les deux modes de §22.
 *
 * §27 admet explicitement un Plan dont l'arrivée diverge de l'objectif : la
 * dérive est affichée telle quelle, sans être présentée comme une anomalie.
 * Les deux boutons qui la résolvent sont deux décisions distinctes, et §65 en
 * donne les mots.
 */
function PlanSummary({
  participantRaceId,
  overview,
  timezone,
}: {
  readonly participantRaceId: string;
  readonly overview: PlanOverview;
  readonly timezone: string;
}) {
  const [targetState, changeTarget] = useActionState(changePlanTargetAction, INITIAL);
  const [rebalanceState, rebalance] = useActionState(rebalancePlanAction, INITIAL);
  const [preserveState, preserve] = useActionState(preservePlanAction, INITIAL);

  const finishAt = overview.points[overview.points.length - 1]?.plannedArrivalAt;

  return (
    <section>
      <div style={{ display: 'flex', gap: 'var(--space-10)', flexWrap: 'wrap' }}>
        <DataValue
          label="Objectif"
          value={formatElapsed(overview.targetDurationSeconds)}
          emphasis="strong"
        />
        <DataValue
          label="Arrivée du Plan"
          value={formatElapsed(overview.finishElapsedSeconds)}
          emphasis="strong"
        />
        {finishAt === undefined ? null : (
          <DataValue label="Heure prévue" value={formatClock(finishAt, timezone)} />
        )}
        {overview.driftSeconds === 0 ? null : (
          <DataValue label="Écart à l’objectif" value={formatSigned(overview.driftSeconds)} />
        )}
      </div>

      {overview.tightestCutoff === null ? null : (
        <p className="pk-body" style={{ marginTop: 'var(--space-4)' }}>
          Marge la plus faible : {overview.tightestCutoff.waypointName},{' '}
          {formatSigned(overview.tightestCutoff.marginSeconds)}.
        </p>
      )}

      <form action={changeTarget} style={{ marginTop: 'var(--space-5)' }}>
        <input type="hidden" name="participantRaceId" value={participantRaceId} />
        <Input
          id="plan-target"
          name="target"
          label="Nouvel objectif"
          hint="Format HH:MM. L’objectif reste votre décision."
          defaultValue={formatElapsed(overview.targetDurationSeconds)}
          {...(targetState.error === undefined ? {} : { error: targetState.error })}
        />
        <Button type="submit" variant="secondary">
          Changer l’objectif
        </Button>
      </form>

      {overview.driftSeconds === 0 ? null : (
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-3)',
            flexWrap: 'wrap',
            marginTop: 'var(--space-5)',
          }}
        >
          {/* §22.2 puis §22.1 — deux formulaires, deux décisions. */}
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
      )}

      <ActionError state={rebalanceState} />
      <ActionError state={preserveState} />
    </section>
  );
}

/**
 * Édition d'un point : durée de la section qui y mène, et arrêt.
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

  return (
    <section
      style={{
        borderTop: '1px solid var(--pk-hairline)',
        paddingTop: 'var(--space-4)',
      }}
    >
      <h3 className="pk-h2" style={{ margin: '0 0 var(--space-3)' }}>
        {point.name}
      </h3>

      {point.incomingSegment === null ? null : (
        <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <form action={updateSegment}>
            <input type="hidden" name="participantRaceId" value={participantRaceId} />
            <input type="hidden" name="raceSegmentId" value={point.incomingSegment.raceSegmentId} />
            <Input
              id={`section-${point.raceWaypointId}`}
              name="duration"
              label="Durée de la section"
              hint="Format HH:MM. Cette durée ne sera plus recalculée."
              defaultValue={formatElapsed(point.incomingSegment.plannedDurationSeconds)}
              {...(segmentState.error === undefined ? {} : { error: segmentState.error })}
            />
            <Button type="submit" variant="secondary">
              Imposer cette durée
            </Button>
          </form>

          {point.incomingSegment.manualOverride ? (
            <form action={removeOverride} style={{ alignSelf: 'end' }}>
              <input type="hidden" name="participantRaceId" value={participantRaceId} />
              <input
                type="hidden"
                name="raceSegmentId"
                value={point.incomingSegment.raceSegmentId}
              />
              <Button type="submit" variant="secondary">
                Revenir à la proposition PLUKA
              </Button>
              <ActionError state={removeState} />
            </form>
          ) : null}
        </div>
      )}

      <form action={updateStop} style={{ marginTop: 'var(--space-4)' }}>
        <input type="hidden" name="participantRaceId" value={participantRaceId} />
        <input type="hidden" name="raceWaypointId" value={point.raceWaypointId} />
        <Input
          id={`stop-${point.raceWaypointId}`}
          name="minutes"
          type="number"
          label="Arrêt"
          hint="En minutes. Zéro retire l’arrêt."
          defaultValue={formatMinutes(point.stopDurationSeconds)}
          {...(stopState.error === undefined ? {} : { error: stopState.error })}
        />
        <Button type="submit" variant="secondary">
          Enregistrer l’arrêt
        </Button>
      </form>
    </section>
  );
}

function ActionError({ state }: { readonly state: ActionState }) {
  if (state.error === undefined) return null;

  return (
    <p className="pk-field-error" role="alert" style={{ marginTop: 'var(--space-2)' }}>
      {state.error}
    </p>
  );
}
