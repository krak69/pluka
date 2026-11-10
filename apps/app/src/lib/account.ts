import { createAccountClosureRepositories, type AccountClosureRepository } from '@pluka/db';

import type { Session } from '@/lib/session';
import { createDataClient } from '@/lib/supabase/data';

/**
 * Suppression et export du compte — migration 0078.
 *
 * Sous la session du coureur : la base lit `auth.uid()` et ne rend ou ne ferme
 * que son propre compte. Le client reste ici, hors des écrans.
 */
export function accountClosure(session: Session): AccountClosureRepository {
  return createAccountClosureRepositories({
    client: createDataClient(session.accessToken),
  }).accountClosure;
}
