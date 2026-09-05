import { NextResponse, type NextRequest } from 'next/server';

import { safeReturnTo } from '@/lib/return-to';
import { createAuthClient } from '@/lib/supabase/auth';

/**
 * Retour du lien de connexion.
 *
 * Le code est échangé côté serveur contre une session : le jeton n'est jamais
 * manipulé par le navigateur, ce qui est aussi la raison pour laquelle
 * `detectSessionInUrl` reste désactivé côté client.
 *
 * La destination est réassainie ici, au moment précis où une valeur hostile
 * deviendrait une redirection ouverte.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const returnTo = safeReturnTo(searchParams.get('returnTo'));

  if (code === null) {
    return NextResponse.redirect(new URL('/connexion?etat=lien-invalide', origin));
  }

  const auth = await createAuthClient();
  const { error } = await auth.auth.exchangeCodeForSession(code);

  if (error !== null) {
    // Ni le code ni le détail provider ne sortent : ils finiraient dans un
    // log d'accès ou un referrer (03_PRIVACY_RLS §128, §130).
    console.error('exchangeCodeForSession a échoué', { code: error.code, status: error.status });
    return NextResponse.redirect(new URL('/connexion?etat=lien-invalide', origin));
  }

  // `returnTo` est un chemin interne validé : la base `origin` empêche toute
  // sortie de domaine, même si la validation laissait passer quelque chose.
  return NextResponse.redirect(new URL(returnTo, origin));
}
