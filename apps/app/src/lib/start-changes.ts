import { createStartChangeRepositories } from '@pluka/db';
import type { StartChangeContext } from '@pluka/domain';

import type { Session } from '@/lib/session';
import { createDataClient } from '@/lib/supabase/data';

/**
 * Alertes d'heure de départ du coureur — migration 0082.
 *
 * Sous sa session : la RLS ne rend que les siennes. Le client reste ici, hors
 * des écrans.
 */
export function startChangeContext(session: Session): StartChangeContext {
  return {
    repositories: createStartChangeRepositories({
      client: createDataClient(session.accessToken),
    }),
  };
}
