import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { publicEnv } from '@/lib/env';

/**
 * Rafraîchissement de session.
 *
 * Convention Next 16 : ce fichier s'appelle `proxy.ts` et exporte `proxy` —
 * c'est l'ancien `middleware.ts` / `middleware` renommé.
 *
 * Un Server Component ne peut pas écrire de cookie. Sans ce passage, un jeton
 * expiré déconnecterait l'utilisateur au lieu d'être renouvelé : le proxy est
 * le seul endroit du cycle de requête qui a le droit de réécrire le cookie de
 * session.
 *
 * Il ne décide d'aucun droit. Les gardes de route et la RLS restent la
 * barrière réelle (01_ARCHITECTURE §9) — un proxy qui autoriserait serait
 * contournable par toute requête qui ne passe pas par lui.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const env = publicEnv();

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }

          response = NextResponse.next({ request });

          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Déclenche le rafraîchissement si nécessaire. Le résultat n'est pas lu :
  // ce n'est pas ici qu'on décide de laisser passer.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
