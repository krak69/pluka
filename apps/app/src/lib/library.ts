import { createEntitlementRepositories, createLibraryRepositories } from '@pluka/db';
import type { LibraryContext } from '@pluka/domain';

import type { Session } from '@/lib/session';
import { createDataClient } from '@/lib/supabase/data';

/**
 * Contexte des use cases de la bibliothèque, sous la session du coureur. Le
 * droit d'écrire (PLUKA+, `library.edit`) est résolu par le domaine ; la RLS
 * borne chaque modèle à son propriétaire (0005).
 */
export function libraryContext(session: Session): LibraryContext {
  const client = createDataClient(session.accessToken);

  return {
    repositories: {
      ...createLibraryRepositories({ client }),
      ...createEntitlementRepositories({ client }),
    },
    actor: { userId: session.userId },
    now: () => new Date(),
  };
}
