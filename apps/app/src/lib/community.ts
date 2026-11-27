import { loadFeatureFlags } from '@pluka/config';
import {
  communityRepository,
  editionRepository,
  eventRepository,
  participantRaceRepository,
  raceRepository,
  raceWaypointRepository,
} from '@pluka/db';
import type { CommunityContext } from '@pluka/domain';

import type { Session } from '@/lib/session';
import { createDataClient } from '@/lib/supabase/data';

/**
 * Communauté d'édition — 00_PRODUCT_SPEC §21 ; 05_ROUTES_FLOWS §12.4 ; 0114.
 *
 * Le flag `community` dit si la fonctionnalité existe dans cette release
 * (01_ARCHITECTURE §41) : coupé, l'entrée du menu garde son écran « bientôt »
 * et les routes d'un sujet n'existent pas. Lu côté serveur seulement.
 */
export function communityEnabled(): boolean {
  return loadFeatureFlags({ FLAG_COMMUNITY: process.env.FLAG_COMMUNITY }).community;
}

/**
 * Contexte de la communauté, sous la session du coureur : les fonctions de
 * 0114 revérifient sa participation à chaque lecture et à chaque geste.
 */
export function communityContext(session: Session): CommunityContext {
  const client = createDataClient(session.accessToken);

  return {
    repositories: {
      community: communityRepository({ client }),
      participantRaces: participantRaceRepository({ client }),
      races: raceRepository({ client }),
      editions: editionRepository({ client }),
      events: eventRepository({ client }),
      waypoints: raceWaypointRepository({ client }),
    },
    actor: { userId: session.userId },
    now: () => new Date(),
  };
}
