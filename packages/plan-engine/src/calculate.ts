import type {
  PlanCalculationInput,
  PlanCalculationResult,
  PlanIssue,
  PlanSegmentResult,
  PlanWaypointInput,
} from './contracts.js';
import { evaluateCutoffs } from './cutoffs.js';
import { computeInputHash } from './hash.js';
import { PlanEngineError, planIssue } from './issues.js';
import { solve } from './solver.js';
import { buildTimeline } from './timeline.js';
import { validateInput } from './validation.js';
import { aggregateSegmentWeights, totalWeight } from './weights.js';

/**
 * `calculatePlan` — docs/engines/PLAN_ENGINE.md §28.
 *
 * Fonction pure. §28 et §35 : pas de React, pas de Next.js, pas de Supabase,
 * pas de réseau, pas d'IA, pas de `Math.random()`, pas de dépendance à
 * `Date.now()`. Le seul appel à `Date` sert à convertir un `startAt` reçu en
 * entrée vers des dates calendaires dérivées (§5.3) — il ne lit jamais
 * l'horloge de la machine.
 *
 * L'ordre est celui de §61 : poids, génération, timeline, barrières.
 *
 * §7 : une précondition non tenue rend un résultat en erreur, pas un Plan
 * approximatif. Le résultat porte alors ses issues et aucune timeline
 * confirmable (§31, « une erreur structurante peut retourner un résultat sans
 * timeline confirmable »).
 */
export function calculatePlan(input: PlanCalculationInput): PlanCalculationResult {
  try {
    return calculate(input);
  } catch (error) {
    if (error instanceof PlanEngineError) return errorResult(input, error.issue);

    throw error;
  }
}

function calculate(input: PlanCalculationInput): PlanCalculationResult {
  validateInput(input);

  // §35 : « les collections sont triées explicitement par sortOrder avant
  // calcul ». Tout ce qui suit raisonne sur ces copies ordonnées, jamais sur
  // l'ordre d'arrivée.
  const waypoints = [...input.course.waypoints].sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );

  const weights = aggregateSegmentWeights(
    input.course.microSegments,
    input.course.raceSegments,
    input.engineConfig,
  );

  const solved = solve(input, weights, waypoints);
  const planWaypoints = buildTimeline(input, waypoints, solved.segments);
  const cutoffs = evaluateCutoffs(input.course.cutoffs, planWaypoints, input.engineConfig);

  const warnings: PlanIssue[] = [
    ...cutoffs.warnings,
    ...extremeRebalanceWarnings(input, solved.segments),
  ];

  const finish = planWaypoints[planWaypoints.length - 1];

  return {
    // Un conflit n'est pas une erreur de calcul : la timeline existe, mais
    // elle ne satisfait pas toutes les contraintes, et §48.1 veut une décision
    // utilisateur avant confirmation.
    status: solved.conflicts.length === 0 ? 'ok' : 'error',
    targetDurationSeconds: input.targetDurationSeconds,
    finishElapsedSeconds: finish?.plannedElapsedSeconds ?? null,
    planSegments: solved.segments,
    planWaypoints,
    cutoffStatuses: cutoffs.statuses,
    warnings,
    conflicts: solved.conflicts,
    changedRange: solved.changedRange,
    calculationMetadata: {
      engineVersion: input.engineConfig.engineVersion,
      preprocessingVersion: input.course.preprocessingVersion,
      inputHash: computeInputHash(input),
      totalWeight: totalWeight(weights),
      stopBudgetSeconds: solved.stopBudgetSeconds,
      fixedSegmentBudgetSeconds: solved.fixedSegmentBudgetSeconds,
      solvedIntervals: solved.solvedIntervals,
      microSegmentCount: input.course.microSegments.length,
      raceSegmentCount: input.course.raceSegments.length,
      waypointCount: waypoints.length,
      anchorCount: input.anchors.length,
      overrideCount: input.segmentOverrides.length,
      stopCount: input.stops.length,
    },
  };
}

/**
 * `EXTREME_REBALANCE` — §49.
 *
 * « Le seuil précis doit rester dans la configuration calibrée. Aucun chiffre
 * non validé ne doit être inventé dans l'UI ou le domaine. »
 *
 * `extremeRebalanceRatio` vaut `null` dans `plan-v1.0.0` : le seuil n'est pas
 * calibré, donc le warning n'est pas émis. Le jour où la calibration le fixe,
 * la comparaison est déjà là — mais elle ne s'invente pas une valeur en
 * attendant.
 */
function extremeRebalanceWarnings(
  input: PlanCalculationInput,
  segments: readonly PlanSegmentResult[],
): readonly PlanIssue[] {
  const threshold = input.engineConfig.extremeRebalanceRatio;
  if (threshold === null) return [];

  return segments
    .filter((segment) => !segment.manualOverride && segment.initialDurationSeconds > 0)
    .filter((segment) => {
      const drift =
        Math.abs(segment.plannedDurationSeconds - segment.initialDurationSeconds) /
        segment.initialDurationSeconds;

      return drift > threshold;
    })
    .map((segment) =>
      planIssue(
        'EXTREME_REBALANCE',
        `la redistribution éloigne fortement ce segment de la proposition de référence`,
        { segmentId: segment.raceSegmentId },
      ),
    );
}

/**
 * Résultat en erreur.
 *
 * Il porte l'issue et rien d'autre : pas de timeline partielle, pas de
 * `finishElapsedSeconds` plausible. §7 : « une violation structurante produit
 * une ERROR, pas une approximation silencieuse. »
 */
function errorResult(input: PlanCalculationInput, issue: PlanIssue): PlanCalculationResult {
  const waypoints: readonly PlanWaypointInput[] = input.course.waypoints;

  return {
    status: 'error',
    targetDurationSeconds: input.targetDurationSeconds,
    finishElapsedSeconds: null,
    planSegments: [],
    planWaypoints: [],
    cutoffStatuses: [],
    warnings: issue.level === 'warning' ? [issue] : [],
    conflicts: issue.level === 'error' ? [issue] : [issue],
    changedRange: null,
    calculationMetadata: {
      engineVersion: input.engineConfig.engineVersion,
      preprocessingVersion: input.course.preprocessingVersion,
      inputHash: computeInputHash(input),
      totalWeight: 0,
      stopBudgetSeconds: 0,
      fixedSegmentBudgetSeconds: 0,
      solvedIntervals: 0,
      microSegmentCount: input.course.microSegments.length,
      raceSegmentCount: input.course.raceSegments.length,
      waypointCount: waypoints.length,
      anchorCount: input.anchors.length,
      overrideCount: input.segmentOverrides.length,
      stopCount: input.stops.length,
    },
  };
}
