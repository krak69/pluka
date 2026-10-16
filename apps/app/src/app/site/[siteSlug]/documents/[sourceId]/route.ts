import { DomainError, signEventSiteDocument } from '@pluka/domain';
import { NextResponse } from 'next/server';

import { eventSiteContext } from '@/lib/event-site';

/**
 * Le téléchargement d'un document diffusé — EVENT_SITE §3.4.
 *
 * Jamais une URL brute du stockage (03_PRIVACY_RLS §84) : une adresse signée,
 * valable une minute, tirée à chaque clic. Le document doit être diffusé par
 * l'organisation et figurer sur ce site ; sinon, 404 sans dire pourquoi.
 */
export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly siteSlug: string; readonly sourceId: string }> },
) {
  const { siteSlug, sourceId } = await params;

  try {
    const url = await signEventSiteDocument(eventSiteContext(), { slug: siteSlug, sourceId });
    return NextResponse.redirect(url, {
      status: 302,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof DomainError && (error.code === 'not_found' || error.code === 'validation')) {
      return new NextResponse(null, { status: 404 });
    }
    throw error;
  }
}
