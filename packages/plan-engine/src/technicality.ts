import type { PlanEngineConfig, TechnicalityLevel } from './config.js';

/**
 * Facteur de technicité — docs/engines/PLAN_ENGINE.md §12.
 *
 * §12.1 est la règle importante : « si la technicité n'est pas connue,
 * technicality_factor = 1.00. Le moteur n'invente pas une technicité. »
 *
 * Absent ne veut donc pas dire « trail standard ». Un parcours dont la
 * technicité n'a pas été renseignée est traité comme neutre, et son Plan ne
 * prétend pas connaître le terrain.
 */
const NEUTRAL_FACTOR = 1.0;

export function technicalityFactor(
  level: TechnicalityLevel | null,
  config: PlanEngineConfig,
): number {
  if (level === null) return NEUTRAL_FACTOR;

  return config.technicalityFactors[level];
}
