import { loadFeatureFlags } from '@pluka/config';
import { createParticipantInvitationRepositories } from '@pluka/db';
import { createServerClient } from '@pluka/db/server';
import type { ParticipantInvitationContext } from '@pluka/domain';

import { publicEnv } from '@/lib/env';
import type { Session } from '@/lib/session';
import { createDataClient } from '@/lib/supabase/data';

/**
 * Invitations des participants — migration 0069.
 *
 * L'interrupteur `participant_invitations` reste coupé en production tant que
 * l'envoi d'emails aux inscrits n'est pas validé juridiquement : coupé, ni le
 * bouton, ni l'envoi, ni la page du lien n'existent. Lu côté serveur seulement.
 */
export function participantInvitationsEnabled(): boolean {
  return loadFeatureFlags({
    FLAG_PARTICIPANT_INVITATIONS: process.env.FLAG_PARTICIPANT_INVITATIONS,
  }).participant_invitations;
}

/** Anonyme pour l'aperçu, qui précède la connexion (§115). Aucune clé de service. */
export function anonymousParticipantInvitationContext(): ParticipantInvitationContext {
  const env = publicEnv();

  return {
    repositories: createParticipantInvitationRepositories({
      client: createServerClient({
        url: env.NEXT_PUBLIC_SUPABASE_URL,
        publishableKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      }),
    }),
    actor: { userId: 'anonymous' },
  };
}

export function sessionParticipantInvitationContext(
  session: Session,
): ParticipantInvitationContext {
  return {
    repositories: createParticipantInvitationRepositories({
      client: createDataClient(session.accessToken),
    }),
    actor: { userId: session.userId },
  };
}
