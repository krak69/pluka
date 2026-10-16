import { eventSiteRepository } from '@pluka/db';
import { createServerClient } from '@pluka/db/server';
import {
  DEFAULT_HEADING_FONT,
  DEFAULT_SITE_ACCENT,
  DomainError,
  accentInk,
  findPublicEventSite,
  siteUrl,
  type EventSiteContext,
  type PublicEventSite,
} from '@pluka/domain';
import { headers } from 'next/headers';
import { notFound, permanentRedirect } from 'next/navigation';
import { cache } from 'react';

import { publicEnv } from '@/lib/env';
import { SITE_PATH_HEADER } from '@/lib/event-site-route';

/**
 * Lecture du site d'un événement, pour ses pages — EVENT_SITE §3, §7.
 *
 * Toujours sans session, sous la clé publiable : un site est public, et ce
 * qu'il montre ne doit pas dépendre de qui le regarde. La base décide de ce
 * qui est en ligne (`event_site_public`) ; aucune clé de service n'entre ici.
 */
function eventSiteContext(): EventSiteContext {
  const env = publicEnv();

  return {
    repositories: {
      eventSites: eventSiteRepository({
        client: createServerClient({
          url: env.NEXT_PUBLIC_SUPABASE_URL,
          publishableKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        }),
      }),
    },
  };
}

/**
 * Le site en ligne à cette adresse, lu une fois par requête : le layout et la
 * page le partagent. Rien en ligne : 404, sans dire pourquoi. Un ancien slug :
 * redirection permanente vers le nouveau, au même chemin.
 */
export const loadEventSite = cache(async (slug: string): Promise<PublicEventSite> => {
  let found;
  try {
    found = await findPublicEventSite(eventSiteContext(), { slug });
  } catch (error) {
    if (error instanceof DomainError && (error.code === 'not_found' || error.code === 'validation')) {
      notFound();
    }
    throw error;
  }

  if (found.kind === 'redirect') {
    const path = (await headers()).get(SITE_PATH_HEADER) ?? '/';
    permanentRedirect(`${siteUrl(found.slug, publicEnv().NEXT_PUBLIC_APP_URL)}${path}`);
  }

  return found.site;
});

/** L'adresse publique d'une image du site, dans le bucket public `event-site-assets` (0049). */
export function siteAssetUrl(path: string | null): string | null {
  if (path === null) return null;

  const base = publicEnv().NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/u, '');
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${base}/storage/v1/object/public/event-site-assets/${encoded}`;
}

/** L'identité résolue : l'accent et la police choisis, ou ceux de PLUKA. */
export function siteTheme(site: PublicEventSite) {
  const accent = site.appearance.accentColor ?? DEFAULT_SITE_ACCENT;

  return {
    accent,
    accentInk: accentInk(accent),
    headingFont: site.appearance.headingFont ?? DEFAULT_HEADING_FONT,
  };
}

/** L'adresse de la fiche dans l'app, où le coureur prépare sa course. */
export function appRaceUrl(site: PublicEventSite, raceSlug: string): string | null {
  if (site.edition === null) return null;

  const path = `/epreuves/${site.event.slug}/${site.edition.slug}/${raceSlug}`;
  return new URL(path, publicEnv().NEXT_PUBLIC_APP_URL).toString();
}
