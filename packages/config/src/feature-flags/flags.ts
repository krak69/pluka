import { z } from 'zod';

import { booleanEnv } from '../env/primitives.js';

/**
 * Feature flags de la release — liste figée par `01_ARCHITECTURE.md` §41.
 *
 * Un flag répond à « cette fonctionnalité existe-t-elle dans cette release ? ».
 * Il ne répond jamais à « cet utilisateur a-t-il le droit de l'utiliser ? » :
 * c'est le rôle de l'EntitlementService (01_ARCHITECTURE §11, AGENTS §47,
 * ACCEPTANCE AC-ENT-08).
 *
 * Ajouter un flag ici suppose une décision documentée dans l'architecture : la
 * liste n'est pas un fourre-tout de configuration.
 */
export const FEATURE_FLAGS = [
  'repere_pluka',
  'race_intelligence',
  'community',
  'advanced_offline',
] as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

export type FeatureFlagSet = Readonly<Record<FeatureFlag, boolean>>;

/**
 * Défaut : tout est éteint.
 *
 * Un moteur non spécifié ou non calibré reste inaccessible tant qu'un
 * environnement ne l'active pas explicitement côté serveur — cas de Race
 * Intelligence (ADR-012, ACCEPTANCE §38).
 */
export const DEFAULT_FEATURE_FLAGS: FeatureFlagSet = {
  repere_pluka: false,
  race_intelligence: false,
  community: false,
  advanced_offline: false,
};

/** Nom de la variable d'environnement portant un flag : `advanced_offline` → `FLAG_ADVANCED_OFFLINE`. */
export function featureFlagEnvKey(flag: FeatureFlag): string {
  return `FLAG_${flag.toUpperCase()}`;
}

/**
 * Lecture des flags depuis l'environnement.
 *
 * La correspondance flag → variable est écrite explicitement plutôt que dérivée,
 * pour que le schéma reste vérifiable à la lecture. `tests/feature-flags` vérifie
 * que chaque entrée de `FEATURE_FLAGS` est bien couverte.
 */
export const featureFlagEnvSchema = z
  .object({
    FLAG_REPERE_PLUKA: booleanEnv('FLAG_REPERE_PLUKA', DEFAULT_FEATURE_FLAGS.repere_pluka),
    FLAG_RACE_INTELLIGENCE: booleanEnv(
      'FLAG_RACE_INTELLIGENCE',
      DEFAULT_FEATURE_FLAGS.race_intelligence,
    ),
    FLAG_COMMUNITY: booleanEnv('FLAG_COMMUNITY', DEFAULT_FEATURE_FLAGS.community),
    FLAG_ADVANCED_OFFLINE: booleanEnv(
      'FLAG_ADVANCED_OFFLINE',
      DEFAULT_FEATURE_FLAGS.advanced_offline,
    ),
  })
  .transform((raw): FeatureFlagSet => ({
    repere_pluka: raw.FLAG_REPERE_PLUKA,
    race_intelligence: raw.FLAG_RACE_INTELLIGENCE,
    community: raw.FLAG_COMMUNITY,
    advanced_offline: raw.FLAG_ADVANCED_OFFLINE,
  }));
