import { createClient } from '@supabase/supabase-js';

import { DbError } from '../errors.js';
import { classifySupabaseKey } from '../keys.js';
import type { Database, PlukaClient } from '../types.js';
import { assertSupabaseUrl } from '../url.js';
import { buildServerClientOptions } from './options.js';

export interface ServerClientConfig {
  readonly url: string;
  /** Clé publiable. Les droits viennent de la session, pas de la clé. */
  readonly publishableKey: string;
  /**
   * Jeton d'accès de l'utilisateur. Absent, le client agit en `anon`.
   *
   * La lecture du cookie de session appartient à l'application : ce paquet ne
   * dépend ni de Next.js ni d'un mécanisme de stockage.
   */
  readonly accessToken?: string;
}

/**
 * Client serveur agissant pour un utilisateur, sous RLS.
 *
 * À privilégier partout où une requête peut passer par les policies : la RLS
 * reste la barrière de sécurité (01_ARCHITECTURE §9).
 */
export function createServerClient(config: ServerClientConfig): PlukaClient {
  const operation = 'createServerClient';
  const url = assertSupabaseUrl(config.url, operation);

  if (classifySupabaseKey(config.publishableKey) === 'secret') {
    throw new DbError({
      code: 'invalid_configuration',
      operation,
      message: 'clé secrète fournie comme clé publiable : elle contournerait la RLS',
    });
  }

  return createClient<Database, 'public'>(
    url,
    config.publishableKey,
    buildServerClientOptions(config.accessToken),
  );
}

export interface ServiceRoleClientConfig {
  readonly url: string;
  /** Clé `service_role` / `sb_secret_*`. Jamais livrée au navigateur. */
  readonly secretKey: string;
}

/**
 * Client de service : contourne techniquement la RLS.
 *
 * Nommé explicitement pour que son usage se voie en revue. Toute opération qui
 * l'emploie doit vérifier elle-même l'utilisateur, la propriété, l'appartenance
 * à l'organisation, le rôle, l'entitlement, la portée et l'état de l'objet :
 * `service_role` n'est jamais une autorisation métier
 * (03_PRIVACY_RLS §8, AGENTS §26).
 *
 * Réservé au worker, aux Server Actions et aux Route Handlers. Il ne vit que
 * derrière `@pluka/db/server`, et le test de frontière prouve qu'aucun chemin
 * d'import ne l'amène jusqu'au navigateur.
 */
export function createServiceRoleClient(config: ServiceRoleClientConfig): PlukaClient {
  const operation = 'createServiceRoleClient';
  const url = assertSupabaseUrl(config.url, operation);

  if (classifySupabaseKey(config.secretKey) === 'publishable') {
    throw new DbError({
      code: 'invalid_configuration',
      operation,
      message: 'clé publiable fournie comme clé de service',
    });
  }

  return createClient<Database, 'public'>(url, config.secretKey, buildServerClientOptions());
}
