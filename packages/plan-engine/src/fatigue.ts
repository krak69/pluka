import type { PlanEngineConfig } from './config.js';

/**
 * Fatigue de progression — docs/engines/PLAN_ENGINE.md §13.
 *
 * ```text
 * fatigue_factor(p) = 1 + alpha × p²      alpha = 0.10, p ∈ [0,1]
 * ```
 *
 * L'effet est volontairement modeste : 1.00 au départ, 1.10 à l'arrivée.
 *
 * Et surtout, il ne rallonge rien. L'ensemble des poids est normalisé sur le
 * budget de l'utilisateur (§15), donc la fatigue « déplace légèrement
 * davantage de temps vers la seconde partie » sans jamais toucher à
 * l'objectif — ce que §67, critère 9, demande explicitement de vérifier.
 */
export function fatigueFactor(progress: number, config: PlanEngineConfig): number {
  const bounded = progress < 0 ? 0 : progress > 1 ? 1 : progress;

  return 1 + config.fatigueAlpha * bounded * bounded;
}
