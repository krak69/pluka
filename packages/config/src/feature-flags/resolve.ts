import type { FeatureFlag, FeatureFlagSet } from './flags.js';

/** Fonctionnalité absente de cette release. */
export class FeatureDisabledError extends Error {
  readonly code = 'FEATURE_DISABLED';
  readonly flag: FeatureFlag;

  constructor(flag: FeatureFlag) {
    super(`Fonctionnalité désactivée dans cette release : ${flag}`);
    this.name = 'FeatureDisabledError';
    this.flag = flag;
  }
}

/** Fonction pure : même jeu de flags, même réponse. */
export function isFeatureEnabled(flags: FeatureFlagSet, flag: FeatureFlag): boolean {
  return flags[flag];
}

/**
 * Garde de release.
 *
 * À distinguer d'un refus d'entitlement : ici la fonctionnalité n'existe pas
 * dans cette release, il n'y a donc rien à vendre ni à débloquer et l'UI ne doit
 * pas proposer d'upgrade (AGENTS §47).
 */
export function assertFeatureEnabled(flags: FeatureFlagSet, flag: FeatureFlag): void {
  if (!isFeatureEnabled(flags, flag)) {
    throw new FeatureDisabledError(flag);
  }
}
