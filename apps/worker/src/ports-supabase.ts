import {
  billingWebhookRepository,
  createEntitlementRepositories,
  type PlukaClient,
} from '@pluka/db';
import { can, resolveEntitlements } from '@pluka/domain';
import { OPEN_METEO, createOpenMeteoProvider } from '@pluka/weather';

import { createAccountNoticeStore } from './account-notices-store.js';
import { createBilling } from './billing/index.js';
import { createBillingInboxStore } from './billing-store.js';
import { createStartChangeStore } from './start-changes-store.js';
import { createWeatherStore } from './weather-store.js';
import { createAI } from './ai/index.js';
import { createDiscoveryStore } from './discoveries-store.js';
import { createEmail } from './email/index.js';
import { createNotificationStore } from './notifications-store.js';
import {
  createInvitationStore,
  createParticipantInvitationStore,
  createStaffInvitationStore,
} from './invitations-store.js';
import { createSiteContactStore } from './site-contacts-store.js';
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
  /** Base des liens d'invitation à l'équipe PLUKA. */
  readonly adminUrl: string;
  /** Site public : les pages légales citées par les courriels. */
  readonly siteUrl: string;
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
    invitations: createInvitationStore(client),
    staffInvitations: createStaffInvitationStore(client),
    participantInvitations: createParticipantInvitationStore(client),
    siteContacts: createSiteContactStore(client),
    accountNotices: createAccountNoticeStore(client),
    startChanges: createStartChangeStore(client),
    billing: {
      provider: createBilling(process.env),
      inbox: createBillingInboxStore(client),
      webhook: billingWebhookRepository({ client }),
    },
    weather: {
      store: createWeatherStore(client),
      // Offre gratuite d'Open-Meteo : évaluation et bêta ; un abonnement avant la mise en vente.
      provider: createOpenMeteoProvider({ fetch, now: () => new Date() }),
      identity: {
        provider: OPEN_METEO.provider,
        providerModel: OPEN_METEO.model,
        providerConfigVersion: OPEN_METEO.providerConfigVersion,
        normalizerVersion: OPEN_METEO.normalizerVersion,
      },
      // Les droits se décident dans le domaine, pour le coureur concerné.
      async entitled(userId, participantRaceId) {
        const context = await resolveEntitlements(
          {
            repositories: createEntitlementRepositories({ client }),
            actor: { userId },
            now: () => new Date(),
          },
          { participantRaceId },
        );
        return can(context, 'conditions.race.read').allowed;
      },
      now: () => new Date(),
    },
    discoveries: createDiscoveryStore(client),
    email: createEmail(process.env),
    appUrl: config.appUrl,
    adminUrl: config.adminUrl,
    siteUrl: config.siteUrl,
    ai,
    outbox: createOutboxDispatcher(client),
    logger: createLogger(),
  };
}
