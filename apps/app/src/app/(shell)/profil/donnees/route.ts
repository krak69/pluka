import { NextResponse } from 'next/server';

import { accountClosure } from '@/lib/account';
import { getSession } from '@/lib/session';

/**
 * Télécharger ses données — RGPD art. 15 et 20, migration 0078.
 *
 * Un fichier JSON, lu sous la session : la base ne rend que le compte de
 * `auth.uid()`. Jamais mis en cache, jamais indexé.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const session = await getSession();
  if (session === null) {
    return NextResponse.redirect(new URL('/connexion?returnTo=/profil', request.url));
  }

  let data: unknown;
  try {
    data = await accountClosure(session).exportData();
  } catch (error) {
    console.error('export_my_data a échoué', { code: (error as { code?: string }).code });
    return NextResponse.json({ error: 'export_unavailable' }, { status: 503 });
  }

  const day = new Date().toISOString().slice(0, 10);

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="pluka-mes-donnees-${day}.json"`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
