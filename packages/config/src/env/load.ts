import type { z } from 'zod';

import { featureFlagEnvSchema, type FeatureFlagSet } from '../feature-flags/flags.js';
import { EnvValidationError, toEnvIssues, type EnvIssue } from './errors.js';
import {
  databaseEnvSchema,
  observabilityEnvSchema,
  providerEnvSchema,
  publicEnvSchema,
  supabaseServiceEnvSchema,
  type DatabaseEnv,
  type ObservabilityEnv,
  type ProviderEnv,
  type PublicEnv,
  type SupabaseServiceEnv,
} from './schemas.js';

/**
 * Source de configuration.
 *
 * Toujours passée explicitement (`process.env`, un objet littéral côté client,
 * une fixture de test) : aucun module de ce paquet ne lit un global. Cela rend
 * la lecture testable et évite un état implicite (AGENTS §11, §35).
 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

export type EnvParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly EnvIssue[] };

/** Validation d'un schéma d'environnement, sans exception. */
export function tryParseEnv<T>(schema: z.ZodType<T>, source: EnvSource): EnvParseResult<T> {
  const result = schema.safeParse(source);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, issues: toEnvIssues(result.error) };
}

/** Validation d'un schéma d'environnement. Lève `EnvValidationError`. */
export function parseEnv<T>(schema: z.ZodType<T>, source: EnvSource, context: string): T {
  const result = tryParseEnv(schema, source);
  if (!result.ok) throw new EnvValidationError(result.issues, context);
  return result.value;
}

/** Variables publiques uniquement — la seule lecture autorisée côté navigateur. */
export function loadPublicEnv(source: EnvSource): PublicEnv {
  return parseEnv(publicEnvSchema, source, 'environnement public');
}

/**
 * Flags de release.
 *
 * Résolus côté serveur. Une surface cliente reçoit un instantané transmis par le
 * serveur, elle ne lit pas les variables `FLAG_*` (ACCEPTANCE §38 point 11).
 */
export function loadFeatureFlags(source: EnvSource): FeatureFlagSet {
  return parseEnv(featureFlagEnvSchema, source, 'feature flags');
}

/**
 * Configuration serveur complète : Supabase `service_role`, base, providers,
 * observabilité, flags.
 *
 * Volontairement composée de groupes indépendants : une surface qui n'a pas
 * besoin de la clé `service_role` ni de `DATABASE_URL` — `apps/www`, une preview
 * Vercel — utilise `loadPublicEnv` et `loadFeatureFlags` plutôt que de se voir
 * imposer des secrets dont elle n'a pas l'usage (01_ARCHITECTURE §38).
 */
export interface ServerEnv {
  readonly public: PublicEnv;
  readonly supabase: SupabaseServiceEnv;
  readonly database: DatabaseEnv;
  readonly providers: ProviderEnv;
  readonly observability: ObservabilityEnv;
  readonly flags: FeatureFlagSet;
}

export function loadServerEnv(source: EnvSource): ServerEnv {
  const publicEnv = publicEnvSchema.safeParse(source);
  const supabase = supabaseServiceEnvSchema.safeParse(source);
  const database = databaseEnvSchema.safeParse(source);
  const providers = providerEnvSchema.safeParse(source);
  const observability = observabilityEnvSchema.safeParse(source);
  const flags = featureFlagEnvSchema.safeParse(source);

  // Tous les groupes sont évalués avant de lever : une configuration incomplète
  // doit se corriger en une passe, pas variable par variable.
  if (
    !publicEnv.success ||
    !supabase.success ||
    !database.success ||
    !providers.success ||
    !observability.success ||
    !flags.success
  ) {
    const issues = [publicEnv, supabase, database, providers, observability, flags].flatMap(
      (result) => (result.success ? [] : toEnvIssues(result.error)),
    );
    throw new EnvValidationError(issues, 'environnement serveur');
  }

  return {
    public: publicEnv.data,
    supabase: supabase.data,
    database: database.data,
    providers: providers.data,
    observability: observability.data,
    flags: flags.data,
  };
}
