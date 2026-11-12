import { referralCodeRepository } from '@pluka/db';
import { createServerClient } from '@pluka/db/server';
import type { ReferralCodeContext } from '@pluka/domain';

import { publicEnv } from '@/lib/env';
import type { Session } from '@/lib/session';

/**
 * Canal A (0087). Sans session : la page publique du lien, qui ne lit que
 * l'édition et ses épreuves publiées. Avec session : le bloc de
 * l'organisation, dont la base vérifie l'appartenance.
 */
export function referralContext(session: Session | null): ReferralCodeContext {
  const env = publicEnv();

  return {
    repositories: {
      referralCodes: referralCodeRepository({
        client: createServerClient({
          url: env.NEXT_PUBLIC_SUPABASE_URL,
          publishableKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          ...(session === null ? {} : { accessToken: session.accessToken }),
        }),
      }),
    },
  };
}

/** Le lien à coller dans une confirmation d'inscription. */
export function referralLink(code: string): string {
  return new URL(`/r/${code}`, publicEnv().NEXT_PUBLIC_APP_URL).toString();
}
