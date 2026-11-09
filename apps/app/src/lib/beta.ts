import { createEntitlementRepositories } from '@pluka/db';

import type { Session } from '@/lib/session';
import { createDataClient } from '@/lib/supabase/data';

/**
 * L'accès bêta en cours du coureur — 04_ENTITLEMENTS §14, migration 0073.
 *
 * Lu sous sa session : la RLS ne lui rend que ses propres accès. Rend la date
 * de fin, ou `null` sans accès bêta global en cours. Sert à dire la vérité sur
 * l'offre ; la décision d'un droit reste au domaine.
 */
export async function activeBetaAccess(
  session: Session,
): Promise<{ readonly endsAt: string | null } | null> {
  const grants = await createEntitlementRepositories({
    client: createDataClient(session.accessToken),
  })
    .entitlements.listBetaGrantsByUser(session.userId)
    .catch(() => []);
  const now = Date.now();
  const grant = grants.find(
    (candidate) =>
      candidate.scopeType === 'global' &&
      candidate.status === 'active' &&
      Date.parse(candidate.startsAt) <= now &&
      (candidate.endsAt === null || Date.parse(candidate.endsAt) > now),
  );

  return grant === undefined ? null : { endsAt: grant.endsAt };
}
