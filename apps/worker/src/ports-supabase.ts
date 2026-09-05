import type { PlukaClient } from '@pluka/db';

import { createAI } from './ai/index.js';
import type { ConfiguredAI, WorkerPorts } from './ports.js';
import { fetchSource } from './fetcher.js';
import {
  createExtractionStore,
  createGeometryStore,
  createSourceStore,
  createJobStore,
  createLogger,
  createObjectStore,
  createOutboxDispatcher,
  createParsingStore,
  createQueue,
} from './supabase.js';

/**
 * Assemble les frontières réelles du worker.
 *
 * Séparé de `main.ts` pour que le test de bout en bout puisse construire les
 * mêmes adaptateurs — donc exercer le vrai chemin SQL — sans démarrer le
 * processus ni sa boucle infinie.
 *
 * Le fournisseur IA est le seul à pouvoir manquer, et c'est prévu : sans lui,
 * l'extraction reste déterministe (SOURCES_EXTRACTION §29).
 */
export function createPorts(
  client: PlukaClient,
  ai: ConfiguredAI | null = createAI(process.env),
): WorkerPorts {
  return {
    queue: createQueue(client),
    jobs: createJobStore(client),
    objects: createObjectStore(client),
    geometries: createGeometryStore(client),
    sources: createSourceStore(client, fetchSource),
    parsing: createParsingStore(client),
    extraction: createExtractionStore(client),
    ai,
    outbox: createOutboxDispatcher(client),
    logger: createLogger(),
  };
}
