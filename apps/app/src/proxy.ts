import { siteRootDomain, siteSlugFromHost } from '@pluka/domain';
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { publicEnv } from '@/lib/env';
import { SITE_PATH_HEADER, SITE_ROUTE_PREFIX } from '@/lib/event-site-route';

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
  const env = publicEnv();

  /*
   * Site d'un événement — EVENT_SITE §7. `{slug}.pluka.run` est réécrit vers
   * les routes `/site/{slug}`, sans toucher à la session : un site n'en ouvre
   * aucune, et le cookie de l'app reste attaché à son seul hôte (§7.2).
   *
   * Lire l'hôte ne décide d'aucun droit : la base dit ensuite si quelque
   * chose est en ligne à cette adresse.
   */
  const siteSlug = siteSlugFromHost(
    request.headers.get('host'),
    siteRootDomain(env.NEXT_PUBLIC_APP_URL),
  );
  const { pathname, search } = request.nextUrl;

  if (siteSlug !== null) {
    // Les fichiers à extension (icônes, robots.txt) restent ceux de l'app.
    if (/\.[a-z0-9]+$/iu.test(pathname)) return NextResponse.next();

    const headers = new Headers(request.headers);
    headers.set(SITE_PATH_HEADER, pathname);

    const target = request.nextUrl.clone();
    target.pathname = `${SITE_ROUTE_PREFIX}/${siteSlug}${pathname === '/' ? '' : pathname}`;
    target.search = search;
    return NextResponse.rewrite(target, { request: { headers } });
  }

  // Les routes du site ne se servent que par leur sous-domaine : atteintes
  // depuis l'app, elles n'existent pas.
  if (pathname === SITE_ROUTE_PREFIX || pathname.startsWith(`${SITE_ROUTE_PREFIX}/`)) {
    return new NextResponse(null, { status: 404 });
  }

  let response = NextResponse.next({ request });

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
