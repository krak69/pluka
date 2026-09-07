import type { PlukaClient } from '@pluka/db';

import { createAI } from './ai/index.js';
import { createEmail } from './email/index.js';
import { createNotificationStore } from './notifications-store.js';
import type { ConfiguredAI, WorkerPorts } from './ports.js';
import { fetchSource } from './fetcher.js';
import {
  createExtractionStore,
  createCoursePreprocessingStore,
  createGeometryStore,
  createImpactStore,
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
/**
 * Ce que les ports ont besoin de savoir du monde extérieur.
 *
 * Reçu plutôt que lu : `appUrl` venait de `process.env.NEXT_PUBLIC_APP_URL`,
 * avec un `?? 'http://localhost:3001'` qui fabriquait une valeur en production
 * dès que la variable manquait — un courriel serait parti vers localhost sans
 * que rien ne le signale (AGENTS §38).
 */
export interface PortsConfig {
  /** Base des liens envoyés au coureur. */
  readonly appUrl: string;
}

export function createPorts(
  client: PlukaClient,
  config: PortsConfig,
  ai: ConfiguredAI | null = createAI(process.env),
): WorkerPorts {
  return {
    queue: createQueue(client),
    jobs: createJobStore(client),
    objects: createObjectStore(client),
    geometries: createGeometryStore(client),
    coursePreprocessing: createCoursePreprocessingStore(client),
    sources: createSourceStore(client, fetchSource),
    parsing: createParsingStore(client),
    extraction: createExtractionStore(client),
    impacts: createImpactStore(client),
    notifications: createNotificationStore(client),
    email: createEmail(process.env),
    appUrl: config.appUrl,
    ai,
    outbox: createOutboxDispatcher(client),
    logger: createLogger(),
  };
}
