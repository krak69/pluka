import type { PlukaClient } from '@pluka/db';

import type { WorkerPorts } from './ports.js';
import { fetchSource } from './fetcher.js';
import {
  createGeometryStore,
  createSourceStore,
  createJobStore,
  createLogger,
  createObjectStore,
  createOutboxDispatcher,
  createQueue,
} from './supabase.js';

/**
 * Assemble les frontières réelles du worker.
 *
 * Séparé de `main.ts` pour que le test de bout en bout puisse construire les
 * mêmes adaptateurs — donc exercer le vrai chemin SQL — sans démarrer le
 * processus ni sa boucle infinie.
 */
export function createPorts(client: PlukaClient): WorkerPorts {
  return {
    queue: createQueue(client),
    jobs: createJobStore(client),
    objects: createObjectStore(client),
    geometries: createGeometryStore(client),
    sources: createSourceStore(client, fetchSource),
    outbox: createOutboxDispatcher(client),
    logger: createLogger(),
  };
}
