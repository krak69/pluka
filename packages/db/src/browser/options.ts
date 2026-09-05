import type { SupabaseClientOptions } from '@supabase/supabase-js';

/**
 * Options d'un client navigateur.
 *
 * À l'inverse du serveur, la session est persistée et rafraîchie : il n'y a
 * qu'un utilisateur devant l'onglet, et son jeton doit survivre à un
 * rechargement.
 *
 * `detectSessionInUrl` reste désactivé : l'échange du code d'authentification
 * appartient au Route Handler serveur, pour que le jeton ne transite jamais
 * par le fragment d'URL du navigateur (01_ARCHITECTURE §10).
 *
 * Le schéma est figé à `public`, comme côté serveur (02_DATA_MODEL §25).
 */
export function buildBrowserClientOptions(): SupabaseClientOptions<'public'> {
  return {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    db: { schema: 'public' },
  };
}
