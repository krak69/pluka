import {
  assistantLinkViewRepository,
  createAssistanceRepositories,
  createEntitlementRepositories,
} from '@pluka/db';
import { createServerClient } from '@pluka/db/server';
import {
  getNutritionSupply,
  type AssistanceContext,
  type AssistantPageContext,
} from '@pluka/domain';

import { publicEnv } from '@/lib/env';
import { nutritionContext } from '@/lib/nutrition';
import type { Session } from '@/lib/session';
import { createDataClient } from '@/lib/supabase/data';

/**
 * Contexte des use cases de l'Assistance, sous la session du coureur.
 *
 * L'application ne se déclare ni propriétaire ni premium : la propriété et le
 * droit se résolvent dans le domaine (04_ENTITLEMENTS §46), la RLS borne
 * chaque ligne au coureur et en écarte l'organisation (0005, 03 §43).
 */
export function assistanceContext(session: Session): AssistanceContext {
  const client = createDataClient(session.accessToken);

  return {
    repositories: {
      ...createAssistanceRepositories({ client }),
      ...createEntitlementRepositories({ client }),
    },
    actor: { userId: session.userId },
    now: () => new Date(),
    // Ce que la stratégie Nutrition confie à l'Assistance, calculé à la lecture (§55).
    nutritionSupply: (participantRaceId) =>
      getNutritionSupply(nutritionContext(session), { participantRaceId }),
  };
}

/**
 * Contexte de la page `/a/[token]` : aucune session, la clé publiable seule.
 * `assistant_link_view` (0100) valide le lien et ne rend qu'une projection
 * sûre ; rien d'autre n'est lisible en anonyme (03_PRIVACY_RLS §45).
 */
export function assistantPageContext(): AssistantPageContext {
  const env = publicEnv();

  return {
    repositories: {
      assistantLinkView: assistantLinkViewRepository({
        client: createServerClient({
          url: env.NEXT_PUBLIC_SUPABASE_URL,
          publishableKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        }),
      }),
    },
    now: () => new Date(),
  };
}
