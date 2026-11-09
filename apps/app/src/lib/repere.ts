import { loadFeatureFlags } from '@pluka/config';
import {
  createPlanRepositories,
  createRepereCalibrationRepositories,
  createRepereRepositories,
} from '@pluka/db';
import type { RepereCalibrationContext, RepereContext } from '@pluka/domain';

import type { Session } from '@/lib/session';
import { createDataClient } from '@/lib/supabase/data';

/**
 * Repère PLUKA — docs/engines/REPERE_PLUKA.md.
 *
 * Bêta non calibrée : le flag `repere_pluka` est allumé en local et pour les
 * testeurs, coupé en production (§5). Lu côté serveur seulement.
 */
export function repereEnabled(): boolean {
  return loadFeatureFlags({ FLAG_REPERE_PLUKA: process.env.FLAG_REPERE_PLUKA }).repere_pluka;
}

export function repereContext(session: Session): RepereContext {
  const client = createDataClient(session.accessToken);

  return {
    repositories: {
      ...createPlanRepositories({ client }),
      ...createRepereRepositories({ client }),
    },
    actor: { userId: session.userId },
    now: () => new Date(),
  };
}

/** Les couples de calibrage du coureur (0074), sous sa session. */
export function repereCalibrationContext(session: Session): RepereCalibrationContext {
  return {
    repositories: createRepereCalibrationRepositories({
      client: createDataClient(session.accessToken),
    }),
    actor: { userId: session.userId },
    now: () => new Date(),
  };
}
