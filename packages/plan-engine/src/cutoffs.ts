import type { PlanEngineConfig } from './config.js';
import type {
  CutoffMarginStatus,
  PlanCutoffInput,
  PlanCutoffStatusResult,
  PlanIssue,
  PlanWaypointResult,
} from './contracts.js';
import { planIssue } from './issues.js';

/**
 * Barrières horaires et marges — docs/engines/PLAN_ENGINE.md §25, §26.
 *
 * « Une barrière appartient au référentiel Course. Sa marge appartient au
 * Plan. »
 *
 * ```text
 * planned_reference = arrival    si basis = arrival
 *                     departure  si basis = departure
 * margin_seconds    = cutoff - planned_reference
 * ```
 *
 * Le `basis` n'est pas un détail : une barrière posée à la sortie d'un ravito
 * se compare au départ, donc `arrival + stop`. La comparer à l'arrivée seule
 * offrirait au coureur une marge qu'il n'a pas.
 *
 * §26.1 borne l'interprétation : une barrière dépassée « ne rend pas
 * automatiquement le calcul mathématique invalide », elle « produit un warning
 * fort ». Le moteur ne décide pas que le coureur ne finira pas.
 */
export interface CutoffEvaluation {
  readonly statuses: readonly PlanCutoffStatusResult[];
  readonly warnings: readonly PlanIssue[];
}

export function evaluateCutoffs(
  cutoffs: readonly PlanCutoffInput[],
  waypoints: readonly PlanWaypointResult[],
  config: PlanEngineConfig,
): CutoffEvaluation {
  const byWaypoint = new Map(waypoints.map((waypoint) => [waypoint.raceWaypointId, waypoint]));

  const statuses: PlanCutoffStatusResult[] = [];
  const warnings: PlanIssue[] = [];

  // Tri explicite : §35 interdit une itération dont l'ordre dépendrait de la
  // structure plutôt que du métier.
  const ordered = [...cutoffs].sort((left, right) => {
    const leftWaypoint = byWaypoint.get(left.waypointId);
    const rightWaypoint = byWaypoint.get(right.waypointId);
    const leftOrder = leftWaypoint?.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = rightWaypoint?.sortOrder ?? Number.MAX_SAFE_INTEGER;

    if (leftOrder !== rightOrder) return leftOrder - rightOrder;

    return left.id.localeCompare(right.id);
  });

  for (const cutoff of ordered) {
    const waypoint = byWaypoint.get(cutoff.waypointId);
    if (waypoint === undefined) continue;

    const reference =
      cutoff.basis === 'departure'
        ? waypoint.plannedDepartureElapsedSeconds
        : waypoint.plannedElapsedSeconds;

    const marginSeconds = cutoff.cutoffElapsedSeconds - reference;
    const status = marginStatus(marginSeconds, config);

    statuses.push({
      cutoffId: cutoff.id,
      raceWaypointId: cutoff.waypointId,
      basis: cutoff.basis,
      cutoffElapsedSeconds: cutoff.cutoffElapsedSeconds,
      plannedReferenceElapsedSeconds: reference,
      marginSeconds,
      status,
    });

    if (status === 'beyond') {
      warnings.push(
        planIssue('CUTOFF_MISSED', `passage calculé ${-marginSeconds} s après la barrière`, {
          waypointId: cutoff.waypointId,
          cutoffId: cutoff.id,
        }),
      );
    } else if (status === 'critical') {
      warnings.push(
        planIssue('CUTOFF_CRITICAL', `marge de ${marginSeconds} s à la barrière`, {
          waypointId: cutoff.waypointId,
          cutoffId: cutoff.id,
        }),
      );
    }
  }

  return { statuses, warnings };
}

/**
 * Statuts de marge — §26.
 *
 * Le quatrième statut se nomme `beyond` et non `exceeded` : §26 renvoie au
 * vocabulaire réellement déployé, et l'enum `cutoff_margin_status` de la
 * migration 0001 utilise `beyond`.
 */
export function marginStatus(marginSeconds: number, config: PlanEngineConfig): CutoffMarginStatus {
  if (marginSeconds < 0) return 'beyond';
  if (marginSeconds >= config.cutoffThresholds.comfortableSeconds) return 'comfortable';
  if (marginSeconds >= config.cutoffThresholds.watchSeconds) return 'watch';

  return 'critical';
}
