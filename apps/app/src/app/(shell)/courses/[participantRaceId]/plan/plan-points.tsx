'use client';

import type { PlanCutoffView, PlanOverview, PlanPointView } from '@pluka/domain';
import { Button, Input, StatusBadge } from '@pluka/ui';
import { useActionState, useId, useState } from 'react';

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
  AidDrinkChoice,
  AidInfo,
} from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-aid';
import { MilestoneEditor } from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-views';
import { usePlanBoard } from '@/app/(shell)/courses/[participantRaceId]/plan/plan-board';
import { lockWaypointAction, resetPlanAction } from '@/app/profile-actions';
import { Icon } from '@/components/icon';
import type {
  AidLine,
  EditableProduct,
  MilestoneLine,
  TimelineNutrition,
} from '@/lib/nutrition-format';
import {
  formatClock,
  formatDistance,
  formatDuration,
  formatElapsed,
  formatMeters,
  formatMinutes,
  formatPace,
  formatRelief,
  formatSigned,
  formatSpeed,
  shiftedDuration,
  shiftedStop,
  waypointKind,
} from '@/lib/plan-format';

/**
 * Frise des passages et réglages du Plan — PLAN_ENGINE §64, §65 ;
 * 06_DESIGN_SYSTEM.md §53 ; prototype, `tab: 'plan'`, « Ma stratégie ».
 *
 * L'heure prévue à gauche (et la barrière dessous), un repère sur le fil, une
 * carte par point ; entre deux points, la section qui les relie — distance,
 * relief, allure, durée réglable — puis les prises Nutrition qui y tombent.
 * §64 énumère ce qui doit être affichable — durée de chaque section, ETA de
 * chaque point, temps écoulé, arrêt, verrou, marge à la barrière — et tout y
 * est.
 *
 * RIEN N'EST CALCULÉ ICI
 *
 * Chaque valeur affichée vient de `getPlanOverview` — horaires, allures,
 * marges, dérive. Les boutons −/+ envoient une durée que `lib/plan-format`
 * met en forme ; c'est le serveur qui recalcule le Plan (§35 du moteur).
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

/** L'état Nutrition d'une section, dit en mots (§185). */
const SECTION_STATUS: Readonly<Record<'ok' | 'low' | 'high', string>> = {
  ok: 'Nutrition prête',
  low: 'Nutrition à compléter',
  high: 'Nutrition au-dessus de la cible',
};

/** Les points où l'on se ravitaille : un anneau sur le fil, comme au prototype. */
const AID_TYPES: ReadonlySet<string> = new Set(['aid_station', 'water', 'assistance']);

/** Ce que la frise montre de la Nutrition ; nulle quand elle est éteinte. */
export interface PlanTimelineNutrition {
  readonly marks: TimelineNutrition;
  readonly products: readonly EditableProduct[];
  readonly aid: readonly AidLine[];
  /** Nul sans flasques prévues : le choix de la boisson du ravito ne se pose pas. */
  readonly hasDrink: boolean | null;
  readonly canEdit: boolean;
}

export interface PlanPointsProps {
  readonly participantRaceId: string;
  readonly overview: PlanOverview;
  readonly timezone: string;
  readonly nutrition?: PlanTimelineNutrition | null;
}

export function PlanPoints({
  participantRaceId,
  overview,
  timezone,
  nutrition = null,
}: PlanPointsProps) {
  const board = usePlanBoard();
  // La barrière la plus serrée de chaque point : le repository les trie par marge croissante.
  const cutoffByWaypoint = new Map<string, PlanCutoffView>();
  for (const cutoff of overview.cutoffs) {
    if (!cutoffByWaypoint.has(cutoff.raceWaypointId)) {
      cutoffByWaypoint.set(cutoff.raceWaypointId, cutoff);
    }
  }
  const lastIndex = overview.points.length - 1;
  // Sans Nutrition, il n'y a pas d'onglets : la frise reste visible, quel que soit
  // l'onglet choisi avant de la désactiver. Sans flasques, « Mes flasques » n'existe plus.
  const shown =
    nutrition === null ||
    board.view === 'strategie' ||
    (board.view === 'flasques' && nutrition.hasDrink === null);

  return (
    <section aria-labelledby="pl-points-title" className="pl-timeline-wrap" hidden={!shown}>
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
            cutoff={cutoffByWaypoint.get(point.raceWaypointId)}
            tightest={overview.tightestCutoff?.raceWaypointId === point.raceWaypointId}
            edge={index === 0 || index === lastIndex}
            nutrition={nutrition}
          />
        ))}
      </ol>
    </section>
  );
}

/**
 * Un Plan dont l'arrivée diverge de l'objectif — §27 l'admet, et les deux
 * boutons qui la résolvent sont deux décisions distinctes (§22, §65).
 */
export function DriftDecision({
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

/** Réglages du Plan : l'objectif, et la remise à zéro. */
export function PlanSettings({
  participantRaceId,
  overview,
}: {
  readonly participantRaceId: string;
  readonly overview: PlanOverview;
}) {
  return (
    <section id="reglages" aria-labelledby="pl-settings-title" className="pl-settings">
      <h2 id="pl-settings-title" className="pl-settings-title">
        Réglages du plan
      </h2>
      <div className="pl-settings-grid">
        <TargetForm participantRaceId={participantRaceId} overview={overview} />
        <ResetPlan participantRaceId={participantRaceId} />
      </div>
    </section>
  );
}

function TimelineItem({
  participantRaceId,
  point,
  timezone,
  cutoff,
  tightest,
  edge,
  nutrition,
}: {
  readonly participantRaceId: string;
  readonly point: PlanPointView;
  readonly timezone: string;
  readonly cutoff: PlanCutoffView | undefined;
  readonly tightest: boolean;
  /** Le départ ou l'arrivée : pas d'arrêt à régler. */
  readonly edge: boolean;
  readonly nutrition: PlanTimelineNutrition | null;
}) {
  const board = usePlanBoard();
  const segment = point.incomingSegment;
  const intakes = nutrition?.marks.intakes[point.raceWaypointId] ?? [];
  const section = nutrition?.marks.sections[point.raceWaypointId];

  return (
    <li className="pl-item">
      {segment === null ? null : (
        <SegmentRow
          participantRaceId={participantRaceId}
          segment={segment}
          section={section}
          onSection={board.showSection}
        />
      )}

      {nutrition === null
        ? null
        : intakes.map((line) => (
            <IntakeRow
              key={line.key}
              participantRaceId={participantRaceId}
              line={line}
              nutrition={nutrition}
              hidden={board.intakesHidden}
              targeted={board.target?.anchor === line.anchor}
            />
          ))}

      <PointRow
        participantRaceId={participantRaceId}
        point={point}
        timezone={timezone}
        cutoff={cutoff}
        tightest={tightest}
        edge={edge}
        nutrition={nutrition}
        intakesHidden={board.intakesHidden}
        onShowFlasks={() => board.setView('flasques')}
      />
    </li>
  );
}

/**
 * La section qui mène à un point — prototype `p.seg` : distance et relief,
 * allure, durée réglable de trois en trois minutes, état Nutrition. Une durée
 * changée ici devient imposée (§21.3) : le moteur ne la recalcule plus.
 */
function SegmentRow({
  participantRaceId,
  segment,
  section,
  onSection,
}: {
  readonly participantRaceId: string;
  readonly segment: NonNullable<PlanPointView['incomingSegment']>;
  readonly section: { readonly key: string; readonly status: 'ok' | 'low' | 'high' } | undefined;
  readonly onSection: (key: string) => void;
}) {
  const [state, update, pending] = useActionState(updateSegmentDurationAction, INITIAL);
  const relief = formatRelief(segment.elevationGainM, segment.elevationLossM);
  const speed = formatSpeed(segment.paceSecondsPerKm);
  const duration = formatDuration(segment.plannedDurationSeconds);

  return (
    <div className="pl-tl pl-tl-seg">
      <span className="pl-tl-time" aria-hidden="true" />
      <span className="pl-tl-rail pl-tl-rail-dashed" aria-hidden="true" />
      <div className="pl-tl-body">
        <div className="pl-seg">
          <span className="pl-seg-dist">
            <span>{formatDistance(segment.distanceKm)}</span> km
            {relief === null ? null : ` · ${relief}`}
          </span>
          <span className="pl-seg-pace">
            {formatPace(segment.paceSecondsPerKm)} /km{speed === null ? null : ` · ${speed}`}
          </span>
          <form action={update} className="pl-seg-duration" aria-busy={pending}>
            <input type="hidden" name="participantRaceId" value={participantRaceId} />
            <input type="hidden" name="raceSegmentId" value={segment.raceSegmentId} />
            <span className="pl-seg-value">
              <span className="pk-visually-hidden">Durée de la section : </span>
              {duration}
            </span>
            <button
              type="submit"
              name="duration"
              value={shiftedDuration(segment.plannedDurationSeconds, -3)}
              className="pl-step"
              aria-label="Trois minutes de moins sur cette section"
              disabled={pending}
            >
              −
            </button>
            <button
              type="submit"
              name="duration"
              value={shiftedDuration(segment.plannedDurationSeconds, 3)}
              className="pl-step"
              aria-label="Trois minutes de plus sur cette section"
              disabled={pending}
            >
              +
            </button>
          </form>
          {segment.manualOverride ? <span className="pl-chip">Durée imposée</span> : null}
          {section === undefined ? null : (
            <button
              type="button"
              className={`pl-seg-nut pl-seg-nut-${section.status}`}
              onClick={() => onSection(section.key)}
            >
              <Icon name="ForkKnife" size={13} />
              {SECTION_STATUS[section.status]}
              <Icon name="ArrowRight" size={12} />
            </button>
          )}
        </div>
        <ActionError state={state} />
      </div>
    </div>
  );
}

/** Ce qu'une prise dit sur une ligne : ses produits, sinon son besoin. */
function intakeWhat(line: MilestoneLine): string {
  if (line.items.length > 0) return line.items.join(' + ');
  return line.customized ? 'Rien à cette prise' : line.need;
}

/**
 * Une prise entre deux points — prototype `seg.jalons` : « NUTRITION », ce
 * qu'il faut prendre, le kilomètre. Ouverte, elle dit pourquoi elle est là et
 * se modifie (§58).
 */
function IntakeRow({
  participantRaceId,
  line,
  nutrition,
  hidden,
  targeted,
}: {
  readonly participantRaceId: string;
  readonly line: MilestoneLine;
  readonly nutrition: PlanTimelineNutrition;
  readonly hidden: boolean;
  readonly targeted: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const canModify = nutrition.canEdit && line.editable && nutrition.products.length > 0;

  return (
    <div
      id={line.anchor}
      className={targeted ? 'pl-tl pl-tl-take pl-tl-target' : 'pl-tl pl-tl-take'}
      hidden={hidden}
    >
      <span className="pl-tl-time pl-tl-time-take">{line.clock}</span>
      <span className="pl-tl-rail" aria-hidden="true">
        <span className="pl-tl-ring" />
      </span>
      <div className="pl-tl-body">
        <div className="pl-take">
          <button
            type="button"
            className="pl-take-row"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((current) => !current)}
          >
            <span className="pk-label">Nutrition</span>
            <span className="pl-take-what">{intakeWhat(line)}</span>
            {line.customized ? <span className="nu-custom">Modifiée par toi</span> : null}
            {line.conditions.map((condition) => (
              <span key={condition} className="nu-cond-tag">
                {condition}
              </span>
            ))}
            <span className="pl-take-km">{line.km}</span>
          </button>
          <div id={panelId} className="pl-take-panel" hidden={!open}>
            <p className="nu-reason">
              {line.reason} · besoin depuis la prise précédente : {line.need}
            </p>
            {open && canModify ? (
              <MilestoneEditor
                participantRaceId={participantRaceId}
                line={line}
                products={nutrition.products}
                onDone={() => setOpen(false)}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function PointRow({
  participantRaceId,
  point,
  timezone,
  cutoff,
  tightest,
  edge,
  nutrition,
  intakesHidden,
  onShowFlasks,
}: {
  readonly participantRaceId: string;
  readonly point: PlanPointView;
  readonly timezone: string;
  readonly cutoff: PlanCutoffView | undefined;
  readonly tightest: boolean;
  readonly edge: boolean;
  readonly nutrition: PlanTimelineNutrition | null;
  readonly intakesHidden: boolean;
  readonly onShowFlasks: () => void;
}) {
  const [open, setOpen] = useState(false);
  const editorId = useId();
  const kind = waypointKind(point.waypointType, point.name);
  const supply = nutrition?.marks.supplies[point.raceWaypointId];
  const aid = nutrition?.marks.aid[point.raceWaypointId];
  // Prototype : l'Aube pour une barrière qui serre, plein pour le départ, l'arrivée et une barrière confortable.
  const dot =
    cutoff !== undefined && cutoff.status !== 'comfortable'
      ? 'cutoff'
      : edge || cutoff !== undefined
        ? 'end'
        : AID_TYPES.has(point.waypointType)
          ? 'aid'
          : 'minor';
  // L'arrêt se règle d'un geste là où l'on s'arrête : un ravito, un sac, un accompagnant,
  // ou un arrêt déjà prévu. Ailleurs, il reste dans « Ouvrir ».
  const stops =
    !edge &&
    (AID_TYPES.has(point.waypointType) || point.stopDurationSeconds > 0 || supply !== undefined);

  return (
    <div className="pl-tl pl-tl-point">
      <span className="pl-tl-time">
        <span className="pl-tl-clock">{formatClock(point.plannedArrivalAt, timezone)}</span>
        {cutoff?.cutoffAt === null || cutoff?.cutoffAt === undefined ? null : (
          <span className="pl-tl-cutoff">Barrière {formatClock(cutoff.cutoffAt, timezone)}</span>
        )}
      </span>
      <span className="pl-tl-rail" aria-hidden="true">
        <span className="pl-tl-dot" data-dot={dot} />
      </span>
      <div className="pl-tl-body">
        <article className={tightest ? 'pl-card pl-card-tight' : 'pl-card'}>
          <header className="pl-card-head">
            <h3 className="pl-name">{point.name}</h3>
            {kind === null ? null : <span className="pl-kind">{kind}</span>}
            {point.isLocked ? (
              <span className="pl-chip pl-chip-lock">
                <Icon name="LockSimple" size={12} />
                Heure verrouillée
              </span>
            ) : null}
            {cutoff === undefined ? null : (
              <span className="pl-card-margin">
                <StatusBadge tone={MARGIN_TONE[cutoff.status] ?? 'neutral'}>
                  Marge {formatSigned(cutoff.marginSeconds)} ·{' '}
                  {MARGIN_LABEL[cutoff.status] ?? cutoff.status}
                </StatusBadge>
              </span>
            )}
          </header>
          <p className="pl-facts">
            km <span>{formatDistance(point.distanceKm)}</span>
            {point.gainFromStartM === null ? '' : ` · D+ ${formatMeters(point.gainFromStartM)}`}
            {point.altitudeM === null ? '' : ` · alt. ${formatMeters(point.altitudeM)}`}
            {point.incomingSegment === null
              ? ''
              : ` · ${formatElapsed(point.plannedElapsedSeconds)} de course`}
          </p>

          <div className="pl-card-row">
            {stops ? <StopStepper participantRaceId={participantRaceId} point={point} /> : null}
            {(supply?.assistants ?? []).map((name) => (
              <span key={name} className="pl-tag pl-tag-assist">
                <Icon name="User" size={13} />
                {name}
              </span>
            ))}
            {supply?.bagName === null || supply?.bagName === undefined ? null : (
              <span className="pl-tag">
                <Icon name="Backpack" size={13} />
                {supply.bagName}
              </span>
            )}
            <button
              type="button"
              className="pl-open"
              aria-expanded={open}
              aria-controls={editorId}
              onClick={() => setOpen((current) => !current)}
            >
              {open ? 'Fermer' : 'Ouvrir'}
              <Icon name="CaretRight" size={12} />
            </button>
          </div>

          {aid === undefined || nutrition === null ? null : (
            <AidRow
              participantRaceId={participantRaceId}
              line={aid}
              nutrition={nutrition}
              hidden={intakesHidden}
              onShowFlasks={onShowFlasks}
            />
          )}

          <div id={editorId} className="pl-card-panel" hidden={!open}>
            <PointEditor participantRaceId={participantRaceId} point={point} />
          </div>
        </article>
      </div>
    </div>
  );
}

/**
 * Ce qu'on prend à un ravitaillement — prototype « Ravito nutrition ». Ouvert,
 * il dit ce que propose le ravito, la boisson choisie, et se modifie (§58).
 */
function AidRow({
  participantRaceId,
  line,
  nutrition,
  hidden,
  onShowFlasks,
}: {
  readonly participantRaceId: string;
  readonly line: MilestoneLine;
  readonly nutrition: PlanTimelineNutrition;
  readonly hidden: boolean;
  readonly onShowFlasks: () => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const aid =
    line.pointId === null
      ? undefined
      : nutrition.aid.find((entry) => entry.pointId === line.pointId);
  const canModify = nutrition.canEdit && line.editable && nutrition.products.length > 0;

  return (
    <div id={line.anchor} className="pl-take pl-take-aid" hidden={hidden}>
      <button
        type="button"
        className="pl-take-row"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="pl-take-label">
          <Icon name="ForkKnife" size={13} />
          Ravito nutrition
        </span>
        <span className="pl-take-what">{intakeWhat(line)}</span>
        {line.customized ? <span className="nu-custom">Modifiée par toi</span> : null}
        {line.conditions.map((condition) => (
          <span key={condition} className="nu-cond-tag">
            {condition}
          </span>
        ))}
      </button>
      <div id={panelId} className="pl-take-panel" hidden={!open}>
        <AidInfo line={aid} />
        {nutrition.hasDrink === null ? null : (
          <AidDrinkChoice
            participantRaceId={participantRaceId}
            line={aid}
            hasDrink={nutrition.hasDrink}
            canEdit={nutrition.canEdit}
            onShowFlasks={onShowFlasks}
          />
        )}
        {open && canModify ? (
          <MilestoneEditor
            participantRaceId={participantRaceId}
            line={line}
            products={nutrition.products}
            onDone={() => setOpen(false)}
          />
        ) : null}
      </div>
    </div>
  );
}

/** L'arrêt d'un point, minute par minute — prototype `stopMinus` / `stopPlus` (§21.3). */
function StopStepper({
  participantRaceId,
  point,
}: {
  readonly participantRaceId: string;
  readonly point: PlanPointView;
}) {
  const [state, update, pending] = useActionState(updateStopAction, INITIAL);
  const none = point.stopDurationSeconds === 0;

  return (
    <form action={update} className="pl-stepper" aria-busy={pending}>
      <input type="hidden" name="participantRaceId" value={participantRaceId} />
      <input type="hidden" name="raceWaypointId" value={point.raceWaypointId} />
      <span className="pl-stepper-label">Arrêt</span>
      <button
        type="submit"
        name="minutes"
        value={shiftedStop(point.stopDurationSeconds, -1)}
        className="pl-step"
        aria-label={`Réduire l’arrêt à ${point.name} d’une minute`}
        disabled={pending || none}
      >
        −
      </button>
      <span className="pl-stepper-value">{formatMinutes(point.stopDurationSeconds)} min</span>
      <button
        type="submit"
        name="minutes"
        value={shiftedStop(point.stopDurationSeconds, 1)}
        className="pl-step"
        aria-label={`Allonger l’arrêt à ${point.name} d’une minute`}
        disabled={pending}
      >
        +
      </button>
      {state.error === undefined ? null : (
        <span className="pk-field-error pl-stepper-error" role="alert">
          {state.error}
        </span>
      )}
    </form>
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
            id={`duree-${point.raceWaypointId}`}
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
