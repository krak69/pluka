import { z } from 'zod';

import { httpUrl, optionalText, postgresUrl, requiredText } from './primitives.js';

/**
 * Variables exposées au navigateur.
 *
 * Tout ce qui est préfixé `NEXT_PUBLIC_` est inliné dans le bundle client :
 * aucune de ces variables ne peut être un secret (ACCEPTANCE AC-SEC-02).
 * Côté client, Next.js ne fournit pas `process.env` complet : passer un objet
 * littéral listant explicitement chaque variable (voir README).
 */
export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: httpUrl('NEXT_PUBLIC_SUPABASE_URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: requiredText('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  NEXT_PUBLIC_SITE_URL: httpUrl('NEXT_PUBLIC_SITE_URL'),
  NEXT_PUBLIC_APP_URL: httpUrl('NEXT_PUBLIC_APP_URL'),
  NEXT_PUBLIC_ADMIN_URL: httpUrl('NEXT_PUBLIC_ADMIN_URL'),
  NEXT_PUBLIC_SENTRY_DSN: optionalText(),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

/**
 * Clé `service_role`.
 *
 * Réservée au worker, aux Server Actions et aux Route Handlers. Elle contourne
 * techniquement la RLS : toute utilisation reste soumise aux vérifications
 * métier serveur (AGENTS §26, ACCEPTANCE AC-PRIV-04 / AC-PRIV-15).
 */
export const supabaseServiceEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: requiredText('SUPABASE_SERVICE_ROLE_KEY'),
});

export type SupabaseServiceEnv = z.infer<typeof supabaseServiceEnvSchema>;

/** Accès PostgreSQL direct : migrations, worker, tests d'intégration. */
export const databaseEnvSchema = z.object({
  DATABASE_URL: postgresUrl('DATABASE_URL'),
});

export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;

/**
 * Providers externes.
 *
 * Tous facultatifs : le choix des fournisseurs IA, météo, email et paiement
 * n'est pas figé en V1 (01_ARCHITECTURE §28, AGENTS §68). Une brique dont le
 * provider n'est pas configuré doit se désactiver proprement, pas fabriquer une
 * valeur (AGENTS §38).
 *
 * Seule règle appliquée ici : un provider nommé sans ses identifiants est une
 * erreur de configuration, jamais un provider à moitié actif.
 */
export const providerEnvSchema = z
  .object({
    AI_PROVIDER: optionalText(),
    AI_API_KEY: optionalText(),

    WEATHER_PROVIDER: optionalText(),
    WEATHER_API_KEY: optionalText(),

    EMAIL_PROVIDER: optionalText(),
    EMAIL_API_KEY: optionalText(),
    EMAIL_FROM: optionalText(),

    BILLING_PROVIDER: optionalText(),
    BILLING_API_KEY: optionalText(),
    BILLING_WEBHOOK_SECRET: optionalText(),
  })
  .superRefine((env, ctx) => {
    const requireCompanions = (
      providerKey: string,
      providerValue: string | undefined,
      companions: readonly (readonly [string, string | undefined])[],
    ): void => {
      if (providerValue === undefined) return;

      for (const [key, value] of companions) {
        if (value === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} : requis dès que ${providerKey} est défini`,
          });
        }
      }
    };

    requireCompanions('AI_PROVIDER', env.AI_PROVIDER, [['AI_API_KEY', env.AI_API_KEY]]);
    requireCompanions('WEATHER_PROVIDER', env.WEATHER_PROVIDER, [
      ['WEATHER_API_KEY', env.WEATHER_API_KEY],
    ]);
    requireCompanions('EMAIL_PROVIDER', env.EMAIL_PROVIDER, [
      ['EMAIL_API_KEY', env.EMAIL_API_KEY],
      ['EMAIL_FROM', env.EMAIL_FROM],
    ]);
    // La signature du webhook est la frontière entre un événement de paiement et
    // un entitlement PLUKA : un provider de paiement sans secret de webhook
    // ouvrirait la porte à un droit créé sans confirmation (ACCEPTANCE AC-ENT-12).
    requireCompanions('BILLING_PROVIDER', env.BILLING_PROVIDER, [
      ['BILLING_API_KEY', env.BILLING_API_KEY],
      ['BILLING_WEBHOOK_SECRET', env.BILLING_WEBHOOK_SECRET],
    ]);
  });

export type ProviderEnv = z.infer<typeof providerEnvSchema>;

/** Observabilité serveur. Le DSN navigateur appartient au schéma public. */
export const observabilityEnvSchema = z.object({
  SENTRY_DSN: optionalText(),
});

export type ObservabilityEnv = z.infer<typeof observabilityEnvSchema>;
