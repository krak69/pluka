'use server';

import { createParticipantRace, DomainError } from '@pluka/domain';
import { redirect } from 'next/navigation';

import { participationContext } from '@/lib/participations';
import { getSession } from '@/lib/session';

export interface AttachState {
  readonly error?: string;
}

/**
 * Validation de la course — `05_ROUTES_FLOWS.md` §1.7.
 *
 * « La participation naît quand le coureur valide sa course. » C'est cette
 * action, et c'est le seul endroit du produit qui crée un `participant_race`
 * depuis une visite.
 *
 * Sans session, retour à la connexion en conservant la fiche comme destination.
 * L'utilisateur revient exactement où il en était, et valide alors.
 *
 * Le refus reste lisible à côté du bouton : `createParticipantRace` refuse une
 * course en brouillon, privée ou annulée, et le dire vaut mieux qu'un bouton
 * absent (PLAN_ENGINE §45).
 */
export async function attachToRaceAction(
  _previous: AttachState,
  form: FormData,
): Promise<AttachState> {
  const raceId = form.get('raceId');
  const returnTo = form.get('returnTo');

  if (typeof raceId !== 'string' || raceId === '') {
    return { error: 'Épreuve inconnue.' };
  }

  const session = await getSession();

  if (session === null) {
    const destination = typeof returnTo === 'string' && returnTo !== '' ? returnTo : '/';
    redirect(`/connexion?returnTo=${encodeURIComponent(destination)}`);
  }

  let participantRaceId: string;

  try {
    const created = await createParticipantRace(participationContext(session), { raceId });
    participantRaceId = created.id;
  } catch (error) {
    if (error instanceof DomainError && error.code === 'conflict') {
      return { error: 'Cette course est déjà dans ton espace.' };
    }

    if (error instanceof DomainError) {
      return { error: 'Cette épreuve n’accepte pas de rattachement pour l’instant.' };
    }

    throw error;
  }

  // §1.7 : tout ce qui suit dans l'entonnoir est scopé à la participation.
  redirect(`/courses/${participantRaceId}/objectif`);
}
