import { DbError, type EventDiscoveryRepository } from '@pluka/db';
import { describe, expect, it } from 'vitest';

import {
  addEditionFile,
  createEventWithEdition,
  getEventInventory,
  type EventDiscoveryContext,
} from '../src/index.js';

/** Création classique d'un événement, inventaire du site, documents — migrations 0040, 0042. */

const EVENT = '00000000-0000-4000-8000-000000000140';
const EDITION = '00000000-0000-4000-8000-000000000141';

function context(overrides: Partial<EventDiscoveryRepository> = {}): {
  readonly context: EventDiscoveryContext;
  readonly calls: unknown[];
} {
  const calls: unknown[] = [];
  const repository: EventDiscoveryRepository = {
    createEvent: async (input) => {
      calls.push(input);
      return EVENT;
    },
    latestDiscovery: async () => null,
    refreshDiscovery: async () => 'discovery-id',
    addDocuments: async () => 0,
    addFile: async (input) => {
      calls.push(input);
      return 'source-id';
    },
    listDocuments: async () => ({ documents: [], pendingByCategory: [] }),
    ...overrides,
  };

  return {
    context: { repositories: { eventDiscovery: repository }, actor: { userId: 'u' } },
    calls,
  };
}

const VALID = {
  event: {
    name: 'Trail des Crêtes',
    slug: 'trail-des-cretes',
    organizationId: null,
    city: 'Gérardmer',
    officialWebsiteUrl: 'https://trail.example/',
  },
  edition: { year: 2027, slug: '2027', startDate: '2027-06-12', endDate: null },
  races: [
    {
      name: 'Grand Tour',
      slug: 'grand-tour',
      distanceKm: 82,
      elevationGainM: 4200,
      startDate: '2027-06-12',
      startTime: '05:00',
      timezone: 'Europe/Paris',
    },
  ],
};

describe('création', () => {
  it('crée événement, édition et épreuves en une commande', async () => {
    const { context: ctx, calls } = context();
    expect(await createEventWithEdition(ctx, VALID)).toEqual({ eventId: EVENT });
    expect(calls).toHaveLength(1);
  });

  it('accepte un événement sans épreuve ni site', async () => {
    const { context: ctx } = context();
    await expect(
      createEventWithEdition(ctx, {
        ...VALID,
        event: { ...VALID.event, officialWebsiteUrl: null },
        races: [],
      }),
    ).resolves.toEqual({ eventId: EVENT });
  });

  it('refuse un site hors http(s), une heure absente, un fuseau inconnu, deux slugs identiques, une fin avant le début', async () => {
    const { context: ctx, calls } = context();
    const race = VALID.races[0]!;

    for (const input of [
      { ...VALID, event: { ...VALID.event, officialWebsiteUrl: 'javascript:alert(1)' } },
      { ...VALID, races: [{ ...race, startTime: '' }] },
      { ...VALID, races: [{ ...race, timezone: 'Mars/Olympus' }] },
      { ...VALID, races: [race, { ...race, name: 'Autre' }] },
      { ...VALID, edition: { ...VALID.edition, endDate: '2027-06-01' } },
    ]) {
      await expect(createEventWithEdition(ctx, input)).rejects.toMatchObject({
        code: 'validation',
      });
    }
    expect(calls).toEqual([]);
  });

  it('pose un slug déjà pris contre son champ', async () => {
    const { context: ctx } = context({
      createEvent: async () => {
        throw new DbError({ code: 'conflict', operation: 'x', message: 'x' });
      },
    });

    await expect(createEventWithEdition(ctx, VALID)).rejects.toMatchObject({
      code: 'validation',
      details: { 'event.slug': expect.any(String) },
    });
  });
});

describe('inventaire du site', () => {
  it('un inventaire illisible devient nul, jamais réparé', async () => {
    const { context: ctx } = context({
      latestDiscovery: async () => ({
        discoveryId: 'd',
        siteUrl: 'https://trail.example/',
        finalUrl: null,
        status: 'ready',
        errorCode: null,
        pagesRead: 1,
        inventory: { inattendu: true },
      }),
    });

    expect((await getEventInventory(ctx, { eventId: EVENT }))?.inventory).toBeNull();
  });

  it('sans site, pas d’inventaire', async () => {
    expect(await getEventInventory(context().context, { eventId: EVENT })).toBeNull();
  });
});

describe('fichiers', () => {
  it('refuse un fichier qui n’est pas un PDF, même nommé .pdf', async () => {
    const { context: ctx, calls } = context();

    await expect(
      addEditionFile(ctx, {
        editionId: EDITION,
        fileName: 'reglement.pdf',
        bytes: new TextEncoder().encode('<html>'),
        contentHash: 'a'.repeat(64),
        raceId: null,
      }),
    ).rejects.toMatchObject({ code: 'validation' });
    expect(calls).toEqual([]);

    await addEditionFile(ctx, {
      editionId: EDITION,
      fileName: 'Règlement 2027.pdf',
      bytes: new TextEncoder().encode('%PDF-1.7 …'),
      contentHash: 'a'.repeat(64),
      raceId: null,
    });
    expect(calls[0]).toMatchObject({ title: 'Règlement 2027' });
  });
});
