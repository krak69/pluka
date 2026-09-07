import { loadWorkerEnv } from '@pluka/config';
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
 *
 * Sa configuration est lue une fois, ici, et transmise ensuite : `createPorts`
 * ne lit plus `process.env` de son côté. Un port dont la valeur dépend d'un
 * global est un port qu'on ne peut ni tester ni auditer.
 */

function main(): void {
  const env = loadWorkerEnv(process.env);

  const client = createServiceRoleClient({
    url: env.SUPABASE_URL,
    secretKey: env.SUPABASE_SERVICE_ROLE_KEY,
  });

  const ports = createPorts(client, { appUrl: env.APP_URL });
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
