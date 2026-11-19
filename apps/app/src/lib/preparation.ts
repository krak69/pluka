import {
  createBagRepositories,
  createEntitlementRepositories,
  createLibraryRepositories,
  createPreparationRepositories,
  createRaceInformationRepositories,
  createTaskRepositories,
} from '@pluka/db';
import {
  getNutritionSupply,
  type BagsContext,
  type PreparationContext,
  type TasksContext,
} from '@pluka/domain';

import { nutritionContext } from '@/lib/nutrition';
import type { Session } from '@/lib/session';
import { createDataClient } from '@/lib/supabase/data';

/**
 * Contexte des use cases de la Préparation, sous la session du coureur.
 *
 * Comme pour le Plan, l'application ne se déclare ni propriétaire ni premium :
 * la propriété et le droit au matériel personnel sont résolus par le domaine
 * (04_ENTITLEMENTS §45), la RLS borne chaque ligne au coureur (0005, 0091).
 */
export function preparationContext(session: Session): PreparationContext {
  const client = createDataClient(session.accessToken);

  return {
    repositories: {
      ...createPreparationRepositories({ client }),
      ...createLibraryRepositories({ client }),
      ...createEntitlementRepositories({ client }),
      publishedFacts: createRaceInformationRepositories({ client }).publishedFacts,
    },
    actor: { userId: session.userId },
    now: () => new Date(),
  };
}

/**
 * Contexte des sacs (0095) : les mêmes dépôts, plus les sacs, le parcours —
 * pour les points de drop bag et d'assistance — et le choix « autonome ».
 */
export function bagsContext(session: Session): BagsContext {
  const client = createDataClient(session.accessToken);
  const course = createRaceInformationRepositories({ client });

  return {
    repositories: {
      ...createPreparationRepositories({ client }),
      ...createLibraryRepositories({ client }),
      ...createEntitlementRepositories({ client }),
      ...createBagRepositories({ client }),
      publishedFacts: course.publishedFacts,
      waypoints: course.waypoints,
    },
    actor: { userId: session.userId },
    now: () => new Date(),
    // Ce que la stratégie Nutrition range dans les sacs, calculé à la lecture (§54).
    nutritionSupply: (participantRaceId) =>
      getNutritionSupply(nutritionContext(session), { participantRaceId }),
  };
}

/**
 * Contexte de « À faire » (0097) : les tâches, et de quoi déduire les
 * suggestions — Plan, trace, matériel obligatoire, sacs.
 */
export function tasksContext(session: Session): TasksContext {
  const client = createDataClient(session.accessToken);

  return {
    repositories: {
      ...createTaskRepositories({ client }),
      ...createEntitlementRepositories({ client }),
      publishedFacts: createRaceInformationRepositories({ client }).publishedFacts,
    },
    actor: { userId: session.userId },
    now: () => new Date(),
  };
}
