import type { RaceInformationContext } from '../src/index.js';
import { beforeEach, describe, expect, it } from 'vitest';

import { DomainError, findRaceBySlugs, listRaceInformation, searchRaces } from '../src/index.js';
import {
  baseState,
  createFakeRepositories,
  EDITION_ID,
  EVENT_ID,
  RACE_ID,
  type FakeState,
} from './fixtures/repositories.js';

/**
 * Lecture de l'information d'une course — 03_PRIVACY_RLS §17, §22.
 *
 * Ce qui est protégé ici n'est pas la mise en forme, mais la règle de
 * visibilité : une course privée ou en brouillon doit rester introuvable, et
 * une recherche ne doit jamais devenir un moyen de la découvrir.
 *
 * Les tests d'accès viennent par paire, positif et négatif (§136).
 */

let state: FakeState;

/** Le repository des facts publiés et des waypoints, en mémoire. */
function contextOf(): RaceInformationContext {
  const course = createFakeRepositories(state);

  return {
    repositories: {
      events: course.events,
      editions: course.editions,
      races: course.races,
      waypoints: course.waypoints,
      identity: course.identity,
      publishedFacts: {
        listPublishedByRace: async () => [],
      },
    },
  };
}

/** Rend la course du fixture publiquement lisible. */
function publish(): void {
  state.races = state.races.map((race) =>
    race.id === RACE_ID ? { ...race, status: 'published', publicVisibility: 'public' } : race,
  );
}

beforeEach(() => {
  state = baseState();
});

describe('findRaceBySlugs', () => {
  it('résout les trois segments d’une course publiée', async () => {
    publish();

    const found = await findRaceBySlugs(contextOf(), {
      eventSlug: 'trail-de-test',
      editionSlug: 'trail-de-test-2026',
      raceSlug: '80k',
    });

    expect(found.race.id).toBe(RACE_ID);
    expect(found.edition.id).toBe(EDITION_ID);
    expect(found.event.id).toBe(EVENT_ID);
    expect(found.indexable).toBe(true);
  });

  it('reste introuvable sur une course privée', async () => {
    // §17 : « une Race unlisted ou private ne devient pas listable par la
    // connaissance de son UUID » — ni de son slug.
    await expect(
      findRaceBySlugs(contextOf(), {
        eventSlug: 'trail-de-test',
        editionSlug: 'trail-de-test-2026',
        raceSlug: '80k',
      }),
    ).rejects.toThrow(DomainError);
  });

  it('répond « introuvable » et jamais « interdit »', async () => {
    // Répondre « interdit » confirmerait l'existence de la course (§120).
    try {
      await findRaceBySlugs(contextOf(), {
        eventSlug: 'trail-de-test',
        editionSlug: 'trail-de-test-2026',
        raceSlug: '80k',
      });
      expect.unreachable('la course privée doit être refusée');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('not_found');
    }
  });

  it('reste introuvable sur une course non listée', async () => {
    /*
     * `isRacePubliclyReadable` exige `public_visibility = 'public'`, et la RLS
     * dit la même chose — `private.race_is_publicly_readable` : « une course
     * unlisted ou private ne devient pas lisible par la connaissance de son
     * UUID ».
     *
     * 03_PRIVACY_RLS §17 décrit pourtant `unlisted` comme accessible « par
     * lien direct ». L'implémentation est plus stricte que le document, et ce
     * test enregistre l'implémentation : la relâcher ici ne servirait à rien,
     * la policy refuserait quand même, et le domaine dirait oui là où la base
     * dit non.
     */
    state.races = state.races.map((race) =>
      race.id === RACE_ID ? { ...race, status: 'published', publicVisibility: 'unlisted' } : race,
    );

    await expect(
      findRaceBySlugs(contextOf(), {
        eventSlug: 'trail-de-test',
        editionSlug: 'trail-de-test-2026',
        raceSlug: '80k',
      }),
    ).rejects.toThrow(DomainError);
  });

  it('refuse un slug d’édition qui appartient à un autre événement', async () => {
    publish();

    await expect(
      findRaceBySlugs(contextOf(), {
        eventSlug: 'trail-communautaire',
        editionSlug: 'trail-de-test-2026',
        raceSlug: '80k',
      }),
    ).rejects.toThrow(DomainError);
  });

  it('refuse un slug mal formé avant toute lecture', async () => {
    await expect(
      findRaceBySlugs(contextOf(), {
        eventSlug: 'Trail De Test',
        editionSlug: 'trail-de-test-2026',
        raceSlug: '80k',
      }),
    ).rejects.toThrow(DomainError);
  });
});

describe('searchRaces', () => {
  it('trouve un événement par une partie de son nom', async () => {
    publish();

    const results = await searchRaces(contextOf(), { query: 'test' });

    expect(results).toHaveLength(1);
    expect(results[0]?.event.id).toBe(EVENT_ID);
    expect(results[0]?.races.map((race) => race.id)).toEqual([RACE_ID]);
  });

  it('n’expose jamais une course non publique', async () => {
    // Le négatif de la paire : sans publication, l'événement correspond au
    // nom mais n'a aucune épreuve à montrer. Une recherche ne doit pas être un
    // moyen de découvrir une course `unlisted` ou `private`.
    const results = await searchRaces(contextOf(), { query: 'test' });

    expect(results).toEqual([]);
  });

  it('écarte une course seulement non listée', async () => {
    state.races = state.races.map((race) =>
      race.id === RACE_ID ? { ...race, status: 'published', publicVisibility: 'unlisted' } : race,
    );

    expect(await searchRaces(contextOf(), { query: 'test' })).toEqual([]);
  });

  it('refuse une requête trop courte', async () => {
    await expect(searchRaces(contextOf(), { query: 'a' })).rejects.toThrow(DomainError);
  });
});

describe('listRaceInformation', () => {
  it('rend la course, sa hiérarchie, ses points et ses barrières', async () => {
    publish();

    const information = await listRaceInformation(contextOf(), { raceId: RACE_ID });

    expect(information.race.id).toBe(RACE_ID);
    expect(information.event.id).toBe(EVENT_ID);
    expect(information.facts).toEqual([]);
    expect(Array.isArray(information.waypoints)).toBe(true);
    expect(Array.isArray(information.cutoffs)).toBe(true);
  });

  it('répond « introuvable » sur une épreuve inconnue', async () => {
    await expect(
      listRaceInformation(contextOf(), { raceId: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toThrow(DomainError);
  });
});
