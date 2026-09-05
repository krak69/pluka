import { createClient } from '@supabase/supabase-js';

import { DbError } from '../errors.js';
import { classifySupabaseKey } from '../keys.js';
import type { Database, PlukaClient } from '../types.js';
import { assertSupabaseUrl } from '../url.js';
import { buildBrowserClientOptions } from './options.js';

export interface BrowserClientConfig {
  readonly url: string;
  /**
   * Clé publiable, inlinée dans le bundle. Elle n'est pas un secret : les
   * droits viennent de la session de l'utilisateur, donc des policies RLS.
   */
  readonly publishableKey: string;
}

/**
 * Client navigateur, sous RLS.
 *
 * Une clé prouvée secrète est refusée à la construction. C'est la dernière
 * barrière avant un bundle qui embarquerait `service_role` : la précédente est
 * `@pluka/config`, qui refuse déjà qu'un secret serveur porte un préfixe
 * `NEXT_PUBLIC_` (03_PRIVACY_RLS §8).
 *
 * Une clé de forme inconnue passe : elle n'est pas une preuve, et refuser le
 * démarrage sur une supposition casserait un déploiement légitime. C'est
 * `sb_secret_*` et `role: service_role` qui sont des preuves.
 */
export function createBrowserClient(config: BrowserClientConfig): PlukaClient {
  const operation = 'createBrowserClient';
  const url = assertSupabaseUrl(config.url, operation);

  if (classifySupabaseKey(config.publishableKey) === 'secret') {
    throw new DbError({
      code: 'invalid_configuration',
      operation,
      message: 'clé secrète refusée côté navigateur : elle contournerait la RLS',
    });
  }

  return createClient<Database, 'public'>(url, config.publishableKey, buildBrowserClientOptions());
}
