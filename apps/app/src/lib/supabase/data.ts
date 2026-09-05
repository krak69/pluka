import type { PlukaClient } from '@pluka/db';
import { createServerClient } from '@pluka/db/server';

import { publicEnv } from '@/lib/env';

/**
 * Client de données typé, lié à la session de l'utilisateur.
 *
 * La clé utilisée est publiable : les droits viennent du jeton d'accès, donc
 * des policies RLS (01_ARCHITECTURE §9). Aucune clé de service n'entre dans
 * cette application — `createServerClient` refuserait d'ailleurs une clé
 * secrète présentée comme publiable.
 *
 * Une opération qui aurait réellement besoin d'une clé de service
 * appartiendrait au worker ou à un Route Handler dédié, et devrait revérifier
 * l'utilisateur, le rôle et l'état de l'objet elle-même : `service_role`
 * n'est jamais une autorisation métier (03_PRIVACY_RLS §8).
 */
export function createDataClient(accessToken: string): PlukaClient {
  const env = publicEnv();

  return createServerClient({
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    accessToken,
  });
}
