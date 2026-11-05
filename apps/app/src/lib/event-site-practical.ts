import { listRaceInformation } from '@pluka/domain';
import { cache } from 'react';

import { practicalGuide } from '@/app/site/practical';
import { loadEventSite } from '@/lib/event-site';
import { anonymousRaceContext } from '@/lib/race-information';

/**
 * Les infos pratiques d'un site, lues une fois par requête : le menu, l'accueil
 * et leur page les partagent.
 */
export const loadPracticalGuide = cache(async (slug: string) => {
  const site = await loadEventSite(slug);
  const context = anonymousRaceContext();
  const races = await Promise.all(
    site.races.map(async (race) => ({
      raceName: race.name,
      facts: (await listRaceInformation(context, { raceId: race.id })).facts,
    })),
  );

  return practicalGuide(races, site.sections);
});
