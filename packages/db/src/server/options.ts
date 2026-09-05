import type { SupabaseClientOptions } from '@supabase/supabase-js';

/**
 * Options d'un client serveur.
 *
 * Aucune session n'est persistée ni rafraîchie : côté serveur, chaque requête
 * porte son propre contexte d'authentification, et un état partagé entre deux
 * requêtes ferait fuir la session d'un utilisateur vers un autre.
 *
 * Le schéma est figé à `public` : le schéma `private` reste hors de portée
 * d'un client applicatif, y compris avec une clé de service
 * (02_DATA_MODEL §25, 01_ARCHITECTURE §9).
 */
export function buildServerClientOptions(accessToken?: string): SupabaseClientOptions<'public'> {
  return {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    db: { schema: 'public' },
    global: {
      headers: accessToken === undefined ? {} : { Authorization: `Bearer ${accessToken}` },
    },
  };
}
