import { createParticipationRepositories } from '@pluka/db';
import {
  listOwnParticipations,
  type OwnParticipationSummary,
  type ParticipationContext,
} from '@pluka/domain';

import type { Session } from '@/lib/session';
import { createDataClient } from '@/lib/supabase/data';

/**
 * Contexte d'exécution des use cases de participation.
 *
 * Même forme que `planContext` : `actor` ne porte qu'un `userId`, et la
 * propriété des participations est résolue par `@pluka/domain` sur la foi de la
 * RLS (03_PRIVACY_RLS §11). L'application ne peut pas se déclarer propriétaire
 * d'une participation.
 */
export function participationContext(session: Session): ParticipationContext {
  return {
    repositories: createParticipationRepositories({
      client: createDataClient(session.accessToken),
    }),
    actor: { userId: session.userId },
    now: () => new Date(),
  };
}

/**
 * Les courses du coureur, pour le sélecteur de l'en-tête.
 *
 * Passe par le use case, jamais par une requête d'écran. `tests/no-direct-sql.test.ts`
 * l'impose, et à raison : une lecture directe ici aurait contourné la seule
 * frontière où la propriété d'une participation est vérifiée deux fois — par la
 * policy et par le domaine.
 */
export async function listMyRaces(session: Session): Promise<readonly OwnParticipationSummary[]> {
  return listOwnParticipations(participationContext(session));
}
