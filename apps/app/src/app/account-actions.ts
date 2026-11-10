'use server';

import type { AccountDeletionBlocker } from '@pluka/db';
import { redirect } from 'next/navigation';

import { accountClosure } from '@/lib/account';
import { requireSession } from '@/lib/session';
import { createAuthClient } from '@/lib/supabase/auth';

/**
 * Fermer son compte — migration 0078, docs/03_PRIVACY_RLS.md §94.
 *
 * La base décide si le compte peut partir et date l'effacement. Ici, deux
 * gestes : dire pourquoi quand elle refuse ; sinon couper toutes les sessions,
 * pour que le compte soit fermé dès maintenant et pas seulement dans 30 jours.
 */

export interface AccountActionState {
  readonly error?: string;
}

const BLOCKED: Readonly<Record<AccountDeletionBlocker, string>> = {
  sole_owner:
    'Tu es le seul propriétaire d’une organisation : nomme un autre propriétaire dans son équipe, ou écris-nous pour la fermer, avant de supprimer ton compte.',
  publisher:
    'Ton compte a publié des informations officielles de course : écris-nous pour le supprimer, l’historique de publication doit rester.',
  pluka_staff: 'Un compte de l’équipe PLUKA se supprime par le support.',
};

export async function requestAccountDeletionAction(
  _previous: AccountActionState,
  form: FormData,
): Promise<AccountActionState> {
  const session = await requireSession('/profil');
  if (form.get('confirmed') !== 'on') return { error: 'Confirme la suppression.' };

  let outcome;
  try {
    outcome = await accountClosure(session).requestDeletion();
  } catch {
    return { error: 'La demande n’a pas pu être enregistrée. Réessaie dans un instant.' };
  }

  if (outcome.status === 'blocked') return { error: BLOCKED[outcome.reason] };

  // Toutes les sessions, sur tous les appareils : le compte est fermé.
  const auth = await createAuthClient();
  await auth.auth.signOut({ scope: 'global' });

  redirect('/connexion?etat=compte-ferme');
}
