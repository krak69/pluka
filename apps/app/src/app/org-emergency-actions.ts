'use server';

import { viewSharedEmergencyContact } from '@pluka/domain';

import { organizerEmergencyContext } from '@/lib/emergency-contacts';
import { requireSession } from '@/lib/session';

/**
 * Afficher le contact d'urgence qu'un participant a partagé — 0101.
 *
 * Chaque appel est journalisé par la base (qui, quand, quelle participation),
 * réservé au propriétaire et aux admins de l'organisation. Le contact revient
 * à l'écran qui l'a demandé, et nulle part ailleurs : ni liste, ni export.
 */
export interface EmergencyRevealState {
  readonly error?: string;
  readonly contact?: {
    readonly name: string;
    readonly phone: string;
    readonly relationship: string | null;
  };
}

export async function revealEmergencyContactAction(
  _previous: EmergencyRevealState,
  form: FormData,
): Promise<EmergencyRevealState> {
  const participantRaceId = String(form.get('participantRaceId') ?? '');
  const session = await requireSession('/org');

  try {
    const contact = await viewSharedEmergencyContact(organizerEmergencyContext(session), {
      participantRaceId,
    });
    if (contact === null) {
      return { error: 'Ce participant ne partage plus son contact d’urgence.' };
    }
    return {
      contact: {
        name: [contact.firstName, contact.lastName].filter(Boolean).join(' '),
        phone: contact.phone,
        relationship: contact.relationshipLabel,
      },
    };
  } catch {
    // Le détail reste dans les journaux de la base ; aucun numéro dans ceux de l'app.
    return { error: 'Le contact n’a pas pu être affiché.' };
  }
}
