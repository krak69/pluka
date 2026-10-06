import { createOrganizationTeamRepositories } from '@pluka/db';
import { createServerClient } from '@pluka/db/server';
import type { OrganizationTeamContext } from '@pluka/domain';

import { publicEnv } from '@/lib/env';
import type { Session } from '@/lib/session';
import { createDataClient } from '@/lib/supabase/data';

/**
 * Contextes de l'invitation d'équipe — migration 0033.
 *
 * Anonyme pour l'aperçu, qui précède la connexion (§115) : la fonction SQL
 * n'en rend que le nom de l'organisation, le rôle et l'état du lien. Avec la
 * session pour l'acceptation, qui exige l'adresse invitée (§117). Aucune clé
 * de service dans les deux cas.
 */
export function anonymousTeamContext(): OrganizationTeamContext {
  const env = publicEnv();

  return {
    repositories: createOrganizationTeamRepositories({
      client: createServerClient({
        url: env.NEXT_PUBLIC_SUPABASE_URL,
        publishableKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      }),
    }),
    actor: { userId: 'anonymous' },
  };
}

export function sessionTeamContext(session: Session): OrganizationTeamContext {
  return {
    repositories: createOrganizationTeamRepositories({
      client: createDataClient(session.accessToken),
    }),
    actor: { userId: session.userId },
  };
}
