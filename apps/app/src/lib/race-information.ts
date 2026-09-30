import { createRaceInformationRepositories } from '@pluka/db';
import { createServerClient } from '@pluka/db/server';
import type { RaceInformationContext } from '@pluka/domain';

import { publicEnv } from '@/lib/env';
import { getSession, type Session } from '@/lib/session';

/**
 * Contexte de lecture de l'information d'une course.
 *
 * Deux formes, parce qu'il y a deux lecteurs — `05_ROUTES_FLOWS.md` §4.3 : la
 * fiche épreuve publique se lit sans session, l'onglet « La course » avec.
 *
 * Le client anonyme est construit avec la même clé publiable et sans jeton :
 * `createServerClient` agit alors en `anon`, et les policies
 * `race_facts__select__race_readable`, `race_fact_versions__select__published`
 * et `races__select__public` décident de ce qui sort. Aucune clé de service
 * n'entre ici — elle contournerait précisément la règle qui protège cette page.
 */
export function anonymousRaceContext(): RaceInformationContext {
  const env = publicEnv();

  return {
    repositories: createRaceInformationRepositories({
      client: createServerClient({
        url: env.NEXT_PUBLIC_SUPABASE_URL,
        publishableKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      }),
    }),
  };
}

export function sessionRaceContext(session: Session): RaceInformationContext {
  const env = publicEnv();

  return {
    repositories: createRaceInformationRepositories({
      client: createServerClient({
        url: env.NEXT_PUBLIC_SUPABASE_URL,
        publishableKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        accessToken: session.accessToken,
      }),
    }),
    actor: { userId: session.userId },
  };
}

/**
 * Contexte de la fiche publique.
 *
 * Avec session quand il y en a une, anonyme sinon. La distinction compte : un
 * coureur connecté voit sa course `private` importée, un visiteur non — et
 * c'est la RLS qui fait la différence, pas la page.
 */
export async function raceContext(): Promise<RaceInformationContext> {
  const session = await getSession();

  return session === null ? anonymousRaceContext() : sessionRaceContext(session);
}
