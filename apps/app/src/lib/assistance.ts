import { createAssistanceRepositories, createEntitlementRepositories } from '@pluka/db';
import type { AssistanceContext } from '@pluka/domain';

import type { Session } from '@/lib/session';
import { createDataClient } from '@/lib/supabase/data';

/**
 * Contexte des use cases de l'Assistance, sous la session du coureur.
 *
 * L'application ne se déclare ni propriétaire ni premium : la propriété et le
 * droit se résolvent dans le domaine (04_ENTITLEMENTS §46), la RLS borne
 * chaque ligne au coureur et en écarte l'organisation (0005, 03 §43).
 */
export function assistanceContext(session: Session): AssistanceContext {
  const client = createDataClient(session.accessToken);

  return {
    repositories: {
      ...createAssistanceRepositories({ client }),
      ...createEntitlementRepositories({ client }),
    },
    actor: { userId: session.userId },
    now: () => new Date(),
  };
}
