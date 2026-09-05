import { loadPublicEnv, type PublicEnv } from '@pluka/config';

let cached: PublicEnv | undefined;

/**
 * Configuration publique de l'administration.
 *
 * Variables listées explicitement : Next n'inline que les
 * `process.env.NEXT_PUBLIC_*` écrits littéralement.
 *
 * Aucun secret ici, et notamment pas de `SUPABASE_SERVICE_ROLE_KEY` : cette
 * application travaille sous la session de l'administrateur, donc sous RLS
 * (01_ARCHITECTURE §9). C'est la migration 0007 qui donne à `pluka_admin` le
 * droit d'écrire sur le référentiel de course, pas une clé qui contournerait
 * la barrière.
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
