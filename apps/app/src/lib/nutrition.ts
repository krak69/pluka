import {
  createAssistanceRepositories,
  createBagRepositories,
  createEntitlementRepositories,
  createNutritionRepositories,
} from '@pluka/db';
import type { NutritionContext } from '@pluka/domain';

import type { Session } from '@/lib/session';
import { createDataClient } from '@/lib/supabase/data';

/**
 * Contexte de la Nutrition, sous la session du coureur. Le droit (lecture
 * gratuite, cibles au Race Pass) se résout dans le domaine (04 §44) ; la base
 * vérifie la propriété (0005, 0102).
 */
export function nutritionContext(session: Session): NutritionContext {
  const client = createDataClient(session.accessToken);

  return {
    repositories: {
      ...createNutritionRepositories({ client }),
      ...createEntitlementRepositories({ client }),
      // « À préparer » lit les sacs et les rendez-vous, sans les écrire (§53).
      bags: createBagRepositories({ client }).bags,
      assistance: createAssistanceRepositories({ client }).assistance,
    },
    actor: { userId: session.userId },
    now: () => new Date(),
  };
}
