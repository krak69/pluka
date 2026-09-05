import { loadPublicEnv, type PublicEnv } from '@pluka/config';

let cached: PublicEnv | undefined;

/**
 * Configuration publique de l'application.
 *
 * Variables listées explicitement : Next n'inline que les
 * `process.env.NEXT_PUBLIC_*` écrits littéralement, et un `process.env` passé
 * en bloc serait vide dans le proxy comme côté client.
 *
 * Aucun secret ici. `SUPABASE_SERVICE_ROLE_KEY` n'est jamais lu par cette
 * application : elle travaille sous la session de l'utilisateur, donc sous
 * RLS (01_ARCHITECTURE §9). Une opération qui aurait besoin d'une clé de
 * service appartiendrait au worker ou à un Route Handler dédié, et devrait
 * revérifier le métier elle-même (03_PRIVACY_RLS §8).
 */
export function publicEnv(): PublicEnv {
  cached ??= loadPublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_ADMIN_URL: process.env.NEXT_PUBLIC_ADMIN_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  });

  return cached;
}
