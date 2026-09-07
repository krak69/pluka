/**
 * `@pluka/config` — lecture typée et validée de la configuration.
 *
 * Périmètre : variables d'environnement et feature flags. Ce paquet ne contient
 * aucune règle produit, aucun seuil métier et aucune décision d'entitlement.
 */

export { EnvValidationError, type EnvIssue } from './env/errors.js';
export {
  loadFeatureFlags,
  loadPublicEnv,
  loadServerEnv,
  loadWorkerEnv,
  parseEnv,
  tryParseEnv,
  type EnvParseResult,
  type EnvSource,
  type ServerEnv,
} from './env/load.js';
export { booleanEnv, httpUrl, optionalText, postgresUrl, requiredText } from './env/primitives.js';
export {
  databaseEnvSchema,
  observabilityEnvSchema,
  providerEnvSchema,
  publicEnvSchema,
  supabaseServiceEnvSchema,
  workerEnvSchema,
  type DatabaseEnv,
  type ObservabilityEnv,
  type ProviderEnv,
  type PublicEnv,
  type SupabaseServiceEnv,
} from './env/schemas.js';
export {
  assertNoLeakedServerSecrets,
  findLeakedServerSecrets,
  PUBLIC_ENV_PREFIX,
  SERVER_ONLY_ENV_KEYS,
  type LeakedSecret,
} from './env/secrets.js';
export {
  DEFAULT_FEATURE_FLAGS,
  FEATURE_FLAGS,
  featureFlagEnvKey,
  featureFlagEnvSchema,
  type FeatureFlag,
  type FeatureFlagSet,
} from './feature-flags/flags.js';
export {
  assertFeatureEnabled,
  FeatureDisabledError,
  isFeatureEnabled,
} from './feature-flags/resolve.js';
