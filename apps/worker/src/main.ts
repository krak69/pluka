import { loadPublicEnv, parseEnv, supabaseServiceEnvSchema } from '@pluka/config';
import { createServiceRoleClient } from '@pluka/db/server';

import { DEFAULT_LOOP_OPTIONS, run } from './loop.js';
import { createPorts } from './ports-supabase.js';

/**
 * Point d'entrée du worker — 01_ARCHITECTURE §4.4.
 *
 * « Processus Node.js durable consommant les jobs asynchrones. Il ne contient
 * pas une copie des règles métier : il appelle les mêmes services de domaine
 * et moteurs que les applications web. »
 *
 * Ici le moteur est `@pluka/gpx`, appelé tel quel. Le worker n'a aucune règle
 * de traitement propre : il orchestre file, stockage et persistance.
 *
 * Il est le seul processus à porter la clé de service (03_PRIVACY_RLS §8), et
 * n'est jamais invoqué depuis une requête HTTP.
 */

function main(): void {
  const publicEnv = loadPublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_ADMIN_URL: process.env.NEXT_PUBLIC_ADMIN_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  });

  const service = parseEnv(supabaseServiceEnvSchema, process.env, 'worker');

  const client = createServiceRoleClient({
    url: publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    secretKey: service.SUPABASE_SERVICE_ROLE_KEY,
  });

  const ports = createPorts(client);
  const controller = new AbortController();

  // Arrêt propre : le tour en cours va à son terme, aucun message n'est
  // abandonné au milieu de son traitement.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      ports.logger.info('arrêt demandé', { signal });
      controller.abort();
    });
  }

  void run(ports, { ...DEFAULT_LOOP_OPTIONS, signal: controller.signal }).catch(
    (error: unknown) => {
      ports.logger.error('boucle interrompue', {
        message: error instanceof Error ? error.name : 'inconnu',
      });
      process.exitCode = 1;
    },
  );
}

main();
