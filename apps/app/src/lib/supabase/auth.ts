import { createServerClient as createSsrClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { publicEnv } from '@/lib/env';

/**
 * Client d'authentification lié aux cookies de la requête.
 *
 * Partage des rôles assumé : `@supabase/ssr` porte la session — lecture,
 * rafraîchissement, échange de code — parce que c'est un mécanisme de
 * stockage propre au framework ; `@pluka/db` porte l'accès typé aux données.
 *
 * C'est ce qui permet à `@pluka/db` de rester sans dépendance Next.js, comme
 * l'exige la règle de dépendances de 01_ARCHITECTURE §5. Ce client ne sert
 * jamais à lire des données métier : voir `data.ts`.
 */
export async function createAuthClient() {
  const cookieStore = await cookies();
  const env = publicEnv();

  return createSsrClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Un Server Component ne peut pas écrire de cookie. L'exception est
          // attendue dans ce contexte : le rafraîchissement de session est
          // assuré par le proxy, qui en a le droit.
        }
      },
    },
  });
}
