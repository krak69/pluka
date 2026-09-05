import { loadPublicEnv, type PublicEnv } from '@pluka/config';

let cached: PublicEnv | undefined;

/**
 * Configuration publique du site.
 *
 * Les variables sont listées explicitement : Next n'inline que les
 * `process.env.NEXT_PUBLIC_*` écrits littéralement. Un `process.env` passé en
 * bloc serait vide côté client.
 *
 * La lecture est différée au premier rendu : une configuration invalide
 * échoue en nommant les variables fautives, plutôt qu'au chargement du module
 * avec une pile illisible.
 */
export function publicEnv(): PublicEnv {
  cached ??= loadPublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  });

  return cached;
}
