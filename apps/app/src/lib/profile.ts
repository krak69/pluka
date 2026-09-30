import { createProfileRepositories } from '@pluka/db';
import type { ProfileContext } from '@pluka/domain';

import { requireSession, type Session } from '@/lib/session';
import { createDataClient } from '@/lib/supabase/data';

/**
 * Contexte d'exécution des use cases du Profil trailer.
 *
 * `actor` ne porte qu'un `userId` : 03_PRIVACY_RLS §13 ne prévoit aucune façon
 * de désigner le profil d'un autre coureur, et le use case de lecture n'accepte
 * d'ailleurs aucun paramètre.
 */
export function profileContext(session: Session): ProfileContext {
  return {
    repositories: createProfileRepositories({ client: createDataClient(session.accessToken) }),
    actor: { userId: session.userId },
    now: () => new Date(),
  };
}

export async function requireProfileContext(returnTo: string): Promise<ProfileContext> {
  return profileContext(await requireSession(returnTo));
}
