import type { PlanIssue, PlanIssueCode, PlanIssueLevel } from './contracts.js';

/**
 * Erreurs, warnings et conflits — docs/engines/PLAN_ENGINE.md §48, §49.
 *
 * Trois niveaux, trois conséquences produit :
 *
 * - `ERROR` empêche la confirmation du résultat ;
 * - `WARNING` laisse le calcul possible mais doit être exposé ;
 * - `CONFLICT` signale des contraintes explicites incompatibles, et demande une
 *   décision de l'utilisateur.
 *
 * La distinction entre les deux derniers n'est pas cosmétique. §24 : « le
 * moteur ne doit jamais résoudre un conflit en supprimant automatiquement une
 * contrainte utilisateur ». Un conflit remonte donc tel quel, en nommant la
 * contrainte en cause, pour que l'utilisateur tranche.
 */

const LEVEL_BY_CODE: Readonly<Record<PlanIssueCode, PlanIssueLevel>> = {
  GPX_INVALID: 'error',
  WAYPOINT_OFF_ROUTE: 'error',
  TARGET_TOO_SHORT: 'error',
  ANCHOR_ORDER_CONFLICT: 'conflict',
  FIXED_DURATION_CONFLICT: 'conflict',
  GPX_DISTANCE_MISMATCH: 'warning',
  GPX_GAIN_MISMATCH: 'warning',
  // Sans D+ mesuré, le contrôle d'écart ne se dégrade pas : il ne s'exécute
  // pas. Un parcours qu'on ne peut pas contrôler n'est pas un parcours
  // approximatif (§9.0).
  GPX_GAIN_MISSING: 'error',
  CUTOFF_CRITICAL: 'warning',
  CUTOFF_MISSED: 'warning',
  EXTREME_REBALANCE: 'warning',
};

export function planIssue(
  code: PlanIssueCode,
  message: string,
  subject: Omit<PlanIssue, 'code' | 'level' | 'message'> = {},
): PlanIssue {
  return { code, level: LEVEL_BY_CODE[code], message, ...subject };
}

export function issueLevel(code: PlanIssueCode): PlanIssueLevel {
  return LEVEL_BY_CODE[code];
}

/**
 * Erreur d'entrée du moteur.
 *
 * §7 : « une violation structurante produit une ERROR, pas une approximation
 * silencieuse. » Une précondition non tenue interrompt donc le calcul plutôt
 * que de produire un Plan dont personne ne pourrait dire ce qu'il vaut.
 */
export class PlanEngineError extends Error {
  readonly issue: PlanIssue;

  constructor(issue: PlanIssue) {
    super(`[${issue.code}] ${issue.message}`);
    this.name = 'PlanEngineError';
    this.issue = issue;
  }
}
