import {
  createEntitlementRepositories,
  createLibraryRepositories,
  createPreparationRepositories,
  createRaceInformationRepositories,
} from '@pluka/db';
import type { PreparationContext } from '@pluka/domain';

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
