import { organizerEmergencyContactRepository } from '@pluka/db';
import type { OrganizerEmergencyContactContext } from '@pluka/domain';

import type { Session } from '@/lib/session';
import { createDataClient } from '@/lib/supabase/data';

/**
 * Contexte organisateur du contact d'urgence (0101), sous la session du membre.
 * Le rôle (propriétaire ou admin) et le consentement du coureur sont vérifiés
 * par la base, qui journalise chaque consultation.
 */
export function organizerEmergencyContext(session: Session): OrganizerEmergencyContactContext {
  return {
    repositories: {
      organizerEmergencyContacts: organizerEmergencyContactRepository({
        client: createDataClient(session.accessToken),
      }),
    },
  };
}
