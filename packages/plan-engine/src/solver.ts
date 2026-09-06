import type {
  PlanCalculationInput,
  PlanIssue,
  PlanSegmentResult,
  PlanWaypointInput,
} from './contracts.js';
import { PlanEngineError, planIssue } from './issues.js';
import { distributeSeconds, type RoundingItem } from './rounding.js';
import type { SegmentWeight } from './weights.js';

/**
 * Solveur — docs/engines/PLAN_ENGINE.md §15, §18, §19, §20, §22.
 *
 * DEUX PASSES
 *
 * 1. **Proposition de référence.** Le budget mobile — objectif moins les arrêts
 *    de référence — est réparti sur tous les segments au prorata de leur poids
 *    (§15). C'est ce que PLUKA propose à partir du seul parcours, et c'est
 *    l'`initialDurationSeconds` de §32.
 *
 * 2. **Résolution sous contraintes.** Les ancres découpent le parcours en
 *    intervalles (§18), et chacun distribue son budget sur ses seuls segments
 *    flexibles (§19).
 *
 * POURQUOI DEUX PASSES
 *
 * Parce que §22 demande deux comportements. En `rebalance_to_target`, l'arrivée
 * est une ancre et les segments flexibles absorbent le delta. En
 * `preserve_manual_changes`, il n'y a pas d'ancre finale : les segments
 * flexibles gardent leur durée de référence, et l'arrivée dérive de ce que
 * l'utilisateur a imposé — « segment +10 min → finish ≈ +10 min ».
 *
 * Sans la première passe, le mode dérive n'aurait rien à conserver : il
 * renormaliserait, et l'arrivée reviendrait à l'objectif. C'est exactement ce
 * que §22.1 refuse.
 *
 * LES ARRÊTS DE RÉFÉRENCE
 *
 * La proposition de référence n'utilise que les arrêts `origin: 'default'` —
 * ceux que PLUKA propose. Un arrêt `manual` est un choix explicite de
 * l'utilisateur, au même titre qu'un override : en mode dérive il déplace
 * l'arrivée, en mode rééquilibrage il est absorbé par les segments flexibles.
 * §21.6 confirme la lecture en parlant de « restauration du stop de référence ».
 */

export interface SolvedPlan {
  readonly segments: readonly PlanSegmentResult[];
  readonly conflicts: readonly PlanIssue[];
  readonly solvedIntervals: number;
  readonly stopBudgetSeconds: number;
  readonly fixedSegmentBudgetSeconds: number;
  readonly changedRange: { readonly fromWaypointId: string; readonly toWaypointId: string } | null;
}

interface Anchor {
  readonly waypointIndex: number;
  readonly elapsedSeconds: number;
}

export function stopSeconds(input: PlanCalculationInput, waypointId: string): number {
  return input.stops
    .filter((stop) => stop.waypointId === waypointId)
    .reduce((sum, stop) => sum + stop.durationSeconds, 0);
}

function defaultStopBudget(input: PlanCalculationInput): number {
  return input.stops
    .filter((stop) => stop.origin === 'default')
    .reduce((sum, stop) => sum + stop.durationSeconds, 0);
}

function totalStopBudget(input: PlanCalculationInput): number {
  return input.stops.reduce((sum, stop) => sum + stop.durationSeconds, 0);
}

/**
 * Passe 1 — génération initiale (§15).
 *
 * ```text
 * moving_budget      = target_duration - stop_budget
 * seconds_per_weight = moving_budget / Σ weight_i
 * ```
 *
 * L'arrondi est celui de §16 : la somme des durées entières vaut exactement le
 * budget mobile, donc l'arrivée de la proposition tombe pile sur l'objectif.
 */
export function referenceDurations(
  input: PlanCalculationInput,
  weights: readonly SegmentWeight[],
): ReadonlyMap<string, number> {
  const movingBudget = input.targetDurationSeconds - defaultStopBudget(input);
  const weightSum = weights.reduce((sum, segment) => sum + segment.weight, 0);

  if (weightSum <= 0) {
    throw new PlanEngineError(
      planIssue('GPX_INVALID', 'poids total nul : le parcours ne porte aucune distance'),
    );
  }

  const secondsPerWeight = movingBudget / weightSum;

  const items: RoundingItem[] = weights.map((segment) => ({
    key: segment.raceSegmentId,
    sortOrder: segment.sortOrder,
    exactSeconds: secondsPerWeight * segment.weight,
  }));

  return new Map(
    distributeSeconds(items, Math.max(0, Math.round(movingBudget))).map((item) => [
      item.key,
      item.seconds,
    ]),
  );
}

/**
 * Ancres du calcul — §18, §18.1.
 *
 * Le départ est toujours ancré à `elapsed = 0`. Les waypoints verrouillés sont
 * des ancres dures. L'arrivée n'est ancrée que si le mode demande un
 * rééquilibrage : « l'arrivée est ancrée à l'objectif seulement lorsque le mode
 * demande un rééquilibrage vers cet objectif ».
 */
function buildAnchors(
  input: PlanCalculationInput,
  waypoints: readonly PlanWaypointInput[],
): readonly Anchor[] {
  const indexById = new Map(waypoints.map((waypoint, index) => [waypoint.id, index]));
  const anchors = new Map<number, number>([[0, 0]]);

  for (const anchor of input.anchors) {
    const index = indexById.get(anchor.waypointId);
    if (index === undefined) continue;

    anchors.set(index, anchor.arrivalElapsedSeconds);
  }

  if (input.mode === 'rebalance_to_target') {
    const finishIndex = waypoints.length - 1;
    const explicit = anchors.get(finishIndex);

    // Une ancre utilisateur sur l'arrivée qui contredit l'objectif n'est pas
    // arbitrée en silence : §24, « le moteur ne doit jamais résoudre un conflit
    // en supprimant automatiquement une contrainte utilisateur ».
    if (explicit !== undefined && explicit !== input.targetDurationSeconds) {
      throw new PlanEngineError(
        planIssue(
          'ANCHOR_ORDER_CONFLICT',
          `l’arrivée est verrouillée à ${explicit} s, incompatible avec l’objectif de ${input.targetDurationSeconds} s`,
          { waypointId: waypoints[finishIndex]?.id ?? '' },
        ),
      );
    }

    anchors.set(finishIndex, input.targetDurationSeconds);
  }

  return [...anchors.entries()]
    .map(([waypointIndex, elapsedSeconds]) => ({ waypointIndex, elapsedSeconds }))
    .sort((left, right) => left.waypointIndex - right.waypointIndex);
}

/** §20 — deux ancres dont l'ordre du parcours et l'ordre du temps divergent. */
function assertAnchorOrder(
  anchors: readonly Anchor[],
  waypoints: readonly PlanWaypointInput[],
): void {
  for (let index = 1; index < anchors.length; index += 1) {
    const previous = anchors[index - 1] as Anchor;
    const current = anchors[index] as Anchor;

    if (current.elapsedSeconds <= previous.elapsedSeconds) {
      throw new PlanEngineError(
        planIssue(
          'ANCHOR_ORDER_CONFLICT',
          `l’ancre à ${current.elapsedSeconds} s est située après une ancre à ${previous.elapsedSeconds} s sur le parcours`,
          { waypointId: waypoints[current.waypointIndex]?.id ?? '' },
        ),
      );
    }
  }
}

export function solve(
  input: PlanCalculationInput,
  weights: readonly SegmentWeight[],
  waypoints: readonly PlanWaypointInput[],
): SolvedPlan {
  const stopBudgetSeconds = totalStopBudget(input);

  // §15 — condition bloquante : `moving_budget <= 0 → TARGET_TOO_SHORT`.
  if (input.targetDurationSeconds - stopBudgetSeconds <= 0) {
    throw new PlanEngineError(
      planIssue(
        'TARGET_TOO_SHORT',
        `les arrêts (${stopBudgetSeconds} s) absorbent tout l’objectif (${input.targetDurationSeconds} s)`,
      ),
    );
  }

  const reference = referenceDurations(input, weights);
  const overrides = new Map(
    input.segmentOverrides.map((override) => [override.segmentId, override.durationSeconds]),
  );
  const fixedSegmentBudgetSeconds = [...overrides.values()].reduce((sum, value) => sum + value, 0);

  const anchors = buildAnchors(input, waypoints);
  assertAnchorOrder(anchors, waypoints);

  const planned = new Map<string, number>();
  const conflicts: PlanIssue[] = [];
  let solvedIntervals = 0;

  for (let index = 1; index < anchors.length; index += 1) {
    const from = anchors[index - 1] as Anchor;
    const to = anchors[index] as Anchor;

    solveInterval({ input, weights, waypoints, from, to, overrides, planned, conflicts });
    solvedIntervals += 1;
  }

  // §22.1 — au-delà de la dernière ancre, rien n'impose l'arrivée : les
  // segments flexibles conservent leur durée de référence, et le finish dérive.
  const lastAnchor = anchors[anchors.length - 1] as Anchor;
  for (let index = lastAnchor.waypointIndex; index < weights.length; index += 1) {
    const segment = weights[index] as SegmentWeight;
    planned.set(
      segment.raceSegmentId,
      overrides.get(segment.raceSegmentId) ?? (reference.get(segment.raceSegmentId) as number),
    );
  }

  const segments: PlanSegmentResult[] = weights.map((segment) => ({
    raceSegmentId: segment.raceSegmentId,
    sortOrder: segment.sortOrder,
    initialDurationSeconds: reference.get(segment.raceSegmentId) as number,
    plannedDurationSeconds: planned.get(segment.raceSegmentId) as number,
    manualOverride: overrides.has(segment.raceSegmentId),
    relativeWeight: segment.weight,
  }));

  return {
    segments,
    conflicts,
    solvedIntervals,
    stopBudgetSeconds,
    fixedSegmentBudgetSeconds,
    changedRange: computeChangedRange(input, waypoints, anchors),
  };
}

interface IntervalContext {
  readonly input: PlanCalculationInput;
  readonly weights: readonly SegmentWeight[];
  readonly waypoints: readonly PlanWaypointInput[];
  readonly from: Anchor;
  readonly to: Anchor;
  readonly overrides: ReadonlyMap<string, number>;
  readonly planned: Map<string, number>;
  readonly conflicts: PlanIssue[];
}

/**
 * Solveur d'un intervalle A → B — §19.
 *
 * ```text
 * interval_budget = arrival_B - departure_A - Σ stops internes - Σ durées fixes
 * flexible_scale  = interval_budget / Σ flexible_weights
 * ```
 *
 * « Un temps ne doit être soustrait qu'une fois » : l'arrêt de A est consommé
 * par `departure_A`, ceux des waypoints intérieurs sont retirés du budget, et
 * celui de B appartient à l'intervalle suivant (§17, « les stops appartiennent
 * au waypoint d'arrivée et sont consommés avant le segment suivant »).
 */
function solveInterval(context: IntervalContext): void {
  const { input, weights, waypoints, from, to, overrides, planned, conflicts } = context;

  const fromWaypoint = waypoints[from.waypointIndex] as PlanWaypointInput;
  const departureA = from.elapsedSeconds + stopSeconds(input, fromWaypoint.id);

  let internalStops = 0;
  for (let index = from.waypointIndex + 1; index < to.waypointIndex; index += 1) {
    internalStops += stopSeconds(input, (waypoints[index] as PlanWaypointInput).id);
  }

  const intervalSegments = weights.slice(from.waypointIndex, to.waypointIndex);
  const fixed = intervalSegments.filter((segment) => overrides.has(segment.raceSegmentId));
  const flexible = intervalSegments.filter((segment) => !overrides.has(segment.raceSegmentId));

  const fixedTotal = fixed.reduce(
    (sum, segment) => sum + (overrides.get(segment.raceSegmentId) as number),
    0,
  );

  for (const segment of fixed) {
    planned.set(segment.raceSegmentId, overrides.get(segment.raceSegmentId) as number);
  }

  const flexibleBudget = to.elapsedSeconds - departureA - internalStops - fixedTotal;

  if (flexible.length === 0) {
    // Rien à ajuster : les durées imposées doivent tomber juste sur l'ancre.
    if (flexibleBudget !== 0) {
      conflicts.push(
        planIssue(
          'FIXED_DURATION_CONFLICT',
          `entre ${fromWaypoint.id} et ${(waypoints[to.waypointIndex] as PlanWaypointInput).id}, les durées imposées et les arrêts manquent l’ancre de ${flexibleBudget} s`,
          { waypointId: (waypoints[to.waypointIndex] as PlanWaypointInput).id },
        ),
      );
    }
    return;
  }

  const flexibleWeight = flexible.reduce((sum, segment) => sum + segment.weight, 0);

  // §20 : « le budget d'un intervalle ne permet pas de contenir les stops
  // fixes » ou « les durées de segments fixes dépassent le budget ». Le moteur
  // ne retire aucune contrainte pour s'en sortir — il rend le conflit.
  if (flexibleBudget < flexible.length || flexibleWeight <= 0) {
    conflicts.push(
      planIssue(
        'FIXED_DURATION_CONFLICT',
        `budget insuffisant entre ${fromWaypoint.id} et ${(waypoints[to.waypointIndex] as PlanWaypointInput).id} : ${flexibleBudget} s pour ${flexible.length} segment(s) flexible(s)`,
        { waypointId: (waypoints[to.waypointIndex] as PlanWaypointInput).id },
      ),
    );

    for (const segment of flexible) planned.set(segment.raceSegmentId, 0);
    return;
  }

  const scale = flexibleBudget / flexibleWeight;
  const items: RoundingItem[] = flexible.map((segment) => ({
    key: segment.raceSegmentId,
    sortOrder: segment.sortOrder,
    exactSeconds: scale * segment.weight,
  }));

  for (const item of distributeSeconds(items, flexibleBudget)) {
    planned.set(item.key, item.seconds);
  }
}

/**
 * Portée du recalcul — §23.
 *
 * « Une modification ne doit pas recalculer inutilement toute la course si les
 * contraintes permettent un scope plus petit », et « le résultat doit exposer
 * un `changedRange` pour les consommateurs downstream ».
 *
 * Ce que le moteur peut déterminer sans mémoire du Plan précédent, ce sont les
 * contraintes explicites présentes dans l'entrée. Une génération initiale n'en
 * contient aucune : le scope est alors `null`, et non « toute la course »,
 * parce que rien n'a changé.
 *
 * §23 donne deux règles distinctes, et elles ne se confondent pas :
 *
 * - « Stop modifié sans ancre intermédiaire → changedRange = waypoint modifié
 *   → arrivée. » Un arrêt décale tout ce qui le suit, à partir de lui-même.
 * - « Segment modifié + arrivée réancrée → changedRange = intervalle d'ancres
 *   contenant le segment. » Un override est absorbé dans son intervalle, qui
 *   commence à son ancre d'entrée.
 */
function computeChangedRange(
  input: PlanCalculationInput,
  waypoints: readonly PlanWaypointInput[],
  anchors: readonly Anchor[],
): SolvedPlan['changedRange'] {
  const indexById = new Map(waypoints.map((waypoint, index) => [waypoint.id, index]));
  const touched: { index: number; startsAtBoundary: boolean }[] = [];

  // Un override remonte à l'ancre qui ouvre son intervalle : c'est là que
  // commence la redistribution qui l'absorbe.
  for (const override of input.segmentOverrides) {
    const segment = input.course.raceSegments.find((entry) => entry.id === override.segmentId);
    if (segment === undefined) continue;

    const index = indexById.get(segment.fromWaypointId);
    if (index !== undefined) touched.push({ index, startsAtBoundary: true });
  }

  // Un arrêt part de lui-même : rien avant lui n'a bougé.
  for (const stop of input.stops) {
    if (stop.origin !== 'manual') continue;

    const index = indexById.get(stop.waypointId);
    if (index !== undefined) touched.push({ index, startsAtBoundary: false });
  }

  if (touched.length === 0) return null;

  const boundaries = anchors.map((anchor) => anchor.waypointIndex);
  const lastIndex = waypoints.length - 1;

  let from = lastIndex;
  let to = 0;

  for (const { index, startsAtBoundary } of touched) {
    const lower = startsAtBoundary
      ? ([...boundaries].reverse().find((boundary) => boundary <= index) ?? 0)
      : index;
    const upper = boundaries.find((boundary) => boundary > index) ?? lastIndex;

    if (lower < from) from = lower;
    if (upper > to) to = upper;
  }

  return {
    fromWaypointId: (waypoints[from] as PlanWaypointInput).id,
    toWaypointId: (waypoints[to] as PlanWaypointInput).id,
  };
}
