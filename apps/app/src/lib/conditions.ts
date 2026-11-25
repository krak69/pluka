import { loadFeatureFlags } from '@pluka/config';
import {
  conditionsRepository,
  createEntitlementRepositories,
  createPlanRepositories,
  raceWaypointRepository,
} from '@pluka/db';
import type { ConditionsContext } from '@pluka/domain';

import type { Session } from '@/lib/session';
import { createDataClient } from '@/lib/supabase/data';

/**
 * Conditions J-14 — WEATHER_CONDITIONS ; 0113.
 *
 * Le flag `weather_conditions` dit si la fonctionnalité existe dans cette
 * release (01_ARCHITECTURE §41) : coupé en production tant que l'abonnement
 * au fournisseur n'est pas pris. Lu côté serveur seulement. Les droits du
 * coureur, eux, se décident dans le domaine.
 */
export function conditionsEnabled(): boolean {
  return loadFeatureFlags({ FLAG_WEATHER_CONDITIONS: process.env.FLAG_WEATHER_CONDITIONS })
    .weather_conditions;
}

/** Contexte des Conditions, sous la session du coureur : la RLS ne lui ouvre que ses runs. */
export function conditionsContext(session: Session): ConditionsContext {
  const client = createDataClient(session.accessToken);
  const plan = createPlanRepositories({ client });

  return {
    repositories: {
      ...createEntitlementRepositories({ client }),
      conditions: conditionsRepository({ client }),
      racePlans: plan.racePlans,
      races: plan.races,
      waypoints: raceWaypointRepository({ client }),
    },
    actor: { userId: session.userId },
    now: () => new Date(),
  };
}
