import { describe, expect, it } from 'vitest';

import {
  eventReadiness,
  isRaceVisibleToRunners,
  raceVisibilityChain,
  type EditionReadinessInput,
  type RaceReadinessInput,
} from '../src/index.js';

/**
 * État de préparation d'un événement — la lecture partagée par la console et
 * l'espace organisateur. Pure : chaque cas décrit un état lu et ce qu'il dit.
 */

function race(overrides: Partial<RaceReadinessInput['race']> = {}): RaceReadinessInput['race'] {
  return {
    id: 'race-1',
    name: 'Grand Tour',
    status: 'draft',
    publicVisibility: 'private',
    ...overrides,
  };
}

function entry(overrides: Partial<RaceReadinessInput> = {}): RaceReadinessInput {
  return {
    race: race(),
    gpxStage: 'completed',
    publishedCategories: new Set(['cutoff', 'equipment', 'aid']),
    ...overrides,
  };
}

function edition(
  races: readonly RaceReadinessInput[],
  overrides: Partial<EditionReadinessInput['edition']> = {},
): EditionReadinessInput {
  return { edition: { id: 'ed-2027', year: 2027, status: 'draft', ...overrides }, races };
}

describe('visibilité réelle des coureurs — comme 0005', () => {
  const published = race({ status: 'published', publicVisibility: 'public' });

  it('exige toute la chaîne', () => {
    expect(
      isRaceVisibleToRunners({ status: 'published' }, { status: 'published' }, published),
    ).toBe(true);
    expect(
      isRaceVisibleToRunners({ status: 'published' }, { status: 'completed' }, published),
    ).toBe(true);
    expect(isRaceVisibleToRunners({ status: 'draft' }, { status: 'published' }, published)).toBe(
      false,
    );
    expect(isRaceVisibleToRunners({ status: 'published' }, { status: 'draft' }, published)).toBe(
      false,
    );
    expect(
      isRaceVisibleToRunners(
        { status: 'published' },
        { status: 'published' },
        race({ status: 'published', publicVisibility: 'unlisted' }),
      ),
    ).toBe(false);
  });

  it('une épreuve annulée n’est pas lue par la base aujourd’hui', () => {
    expect(
      isRaceVisibleToRunners(
        { status: 'published' },
        { status: 'published' },
        race({ status: 'cancelled', publicVisibility: 'public' }),
      ),
    ).toBe(false);
  });
});

describe('à faire', () => {
  it('suit l’ordre de la chaîne, sur l’édition la plus récente', () => {
    const readiness = eventReadiness({
      event: { status: 'draft' },
      editions: [edition([], { id: 'ed-2026', year: 2026 }), edition([entry()])],
      pendingReview: 3,
    });

    expect(readiness.currentEditionId).toBe('ed-2027');
    expect(readiness.todos.map((todo) => todo.kind)).toEqual([
      'publish-event',
      'publish-edition',
      'publish-races',
      'review',
    ]);
    expect(readiness.todos[1]?.title).toBe('Diffuser l’édition 2027');
    expect(readiness.todos[2]?.raceId).toBe('race-1');
    expect(readiness.nextStep).toEqual({
      text: 'Publier l’événement · 3 autres points',
      due: true,
    });
  });

  it('diffusée mais privée : signalée', () => {
    const readiness = eventReadiness({
      event: { status: 'published' },
      editions: [
        edition([entry({ race: race({ status: 'published' }) })], { status: 'published' }),
      ],
      pendingReview: 0,
    });

    expect(readiness.todos.map((todo) => todo.kind)).toEqual(['open-races']);
    expect(readiness.todos[0]?.title).toBe('1 épreuve diffusée mais non publique');
  });

  it('sans édition, un seul point', () => {
    const readiness = eventReadiness({
      event: { status: 'draft' },
      editions: [],
      pendingReview: null,
    });

    expect(readiness.todos.map((todo) => todo.kind)).toEqual(['first-edition']);
    expect(readiness.currentEditionId).toBeNull();
  });
});

describe('préparation', () => {
  it('tout est fait : 7 sur 7, rien à reprendre', () => {
    const readiness = eventReadiness({
      event: { status: 'published' },
      editions: [
        edition([entry({ race: race({ status: 'published', publicVisibility: 'public' }) })], {
          status: 'published',
        }),
      ],
      pendingReview: 0,
    });

    expect(readiness.checklist.map((item) => item.state)).toEqual(Array(7).fill('done'));
    expect([readiness.done, readiness.total]).toEqual([7, 7]);
    expect(readiness.nextStep).toEqual({ text: 'Rien à reprendre', due: false });
    expect([readiness.visibleRaces, readiness.totalRaces]).toEqual([1, 1]);
  });

  it('compte épreuve par épreuve, et dit le compte', () => {
    const readiness = eventReadiness({
      event: { status: 'published' },
      editions: [
        edition([
          entry(),
          entry({ race: race({ id: 'race-2' }), gpxStage: 'none', publishedCategories: new Set() }),
        ]),
      ],
      pendingReview: 2,
    });
    const item = (key: string) => readiness.checklist.find((candidate) => candidate.key === key);

    expect(item('races')).toMatchObject({ state: 'done', detail: '2 épreuves' });
    expect(item('gpx')).toMatchObject({ state: 'todo', detail: '1 sur 2 épreuves' });
    expect(item('cutoff')).toMatchObject({ state: 'todo', detail: '1 sur 2 épreuves' });
    expect(item('review')).toMatchObject({ state: 'todo', label: '2 informations à vérifier' });
    expect(item('visibility')).toMatchObject({ state: 'todo', detail: '0 sur 2 épreuves' });
  });

  it('un état non lu reste inconnu, jamais réputé fait', () => {
    const readiness = eventReadiness({
      event: { status: 'published' },
      editions: [edition([entry({ gpxStage: null, publishedCategories: null })])],
      pendingReview: null,
    });
    const states = Object.fromEntries(readiness.checklist.map((item) => [item.key, item.state]));

    expect(states).toMatchObject({
      gpx: 'unknown',
      cutoff: 'unknown',
      equipment: 'unknown',
      aid: 'unknown',
      review: 'unknown',
    });
  });

  it('sans épreuve, les points par épreuve sont à faire', () => {
    const readiness = eventReadiness({
      event: { status: 'draft' },
      editions: [edition([])],
      pendingReview: 0,
    });

    expect(readiness.checklist.find((item) => item.key === 'gpx')).toMatchObject({
      state: 'todo',
      detail: 'Aucune épreuve',
    });
  });
});

describe('chaîne de visibilité d’une épreuve', () => {
  it('nomme la première condition manquante', () => {
    const chain = raceVisibilityChain(
      { status: 'published' },
      { status: 'draft' },
      race({ status: 'draft' }),
    );

    expect(chain.visible).toBe(false);
    expect(chain.blocking).toBe('edition');
    expect(chain.conditions.map((condition) => condition.ok)).toEqual([true, false, false, false]);
  });

  it('toutes remplies : visible, rien ne bloque', () => {
    const chain = raceVisibilityChain(
      { status: 'published' },
      { status: 'published' },
      race({ status: 'published', publicVisibility: 'public' }),
    );

    expect(chain).toMatchObject({ visible: true, blocking: null });
  });
});

describe('barrières et ravitaillements — toutes les sources comptent', () => {
  const item = (entries: readonly RaceReadinessInput[], key: string) =>
    eventReadiness({
      event: { status: 'published' },
      editions: [edition(entries)],
      pendingReview: 0,
    }).checklist.find((candidate) => candidate.key === key);

  it('une barrière au référentiel suffit, sans information publiée', () => {
    expect(
      item(
        [
          entry({
            publishedCategories: new Set(),
            courseReference: { cutoffs: 1, aidStations: 0 },
          }),
        ],
        'cutoff',
      ),
    ).toMatchObject({ state: 'done', label: 'Barrières horaires renseignées' });
  });

  it('une barrière finale sur la fiche suffit aussi', () => {
    expect(
      item(
        [
          entry({
            race: race({ cutoffDatetime: '2027-06-13T15:00:00Z' }),
            publishedCategories: new Set(),
            courseReference: { cutoffs: 0, aidStations: 0 },
          }),
        ],
        'cutoff',
      ),
    ).toMatchObject({ state: 'done' });
  });

  it('un point de ravitaillement au référentiel compte', () => {
    expect(
      item(
        [
          entry({
            publishedCategories: new Set(),
            courseReference: { cutoffs: 0, aidStations: 2 },
          }),
        ],
        'aid',
      ),
    ).toMatchObject({ state: 'done', label: 'Ravitaillements renseignés' });
  });

  it('aucune source : à faire ; une source illisible et rien ailleurs : inconnu', () => {
    expect(
      item(
        [
          entry({
            publishedCategories: new Set(),
            courseReference: { cutoffs: 0, aidStations: 0 },
          }),
        ],
        'cutoff',
      ),
    ).toMatchObject({ state: 'todo', detail: '0 sur 1 épreuve' });
    expect(
      item([entry({ publishedCategories: new Set(), courseReference: null })], 'cutoff'),
    ).toMatchObject({ state: 'unknown' });
  });
});
