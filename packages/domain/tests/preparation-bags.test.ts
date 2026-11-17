import type {
  BagRecord,
  BagRepository,
  CourseWaypointRecord,
  LibraryRepository,
  ParticipantRaceSettingsRecord,
  ParticipantRaceSettingsRepository,
  PreparationRepository,
  PublishedFactRepository,
  PublishedRaceFactRecord,
  RaceWaypointRepository,
} from '@pluka/db';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  addBagItems,
  createBag,
  deleteBag,
  dismissBagSuggestion,
  EntitlementError,
  getBags,
  removeBagItem,
  restoreBagSuggestions,
  setBagItemChecked,
  suggestBags,
  type BagsContext,
} from '../src/index.js';
import {
  createFakeEntitlementRepositories,
  entitlementBaseState,
  grantEntitlement,
  type EntitlementState,
} from './fixtures/entitlement-repositories.js';
import {
  participationBaseState,
  PUBLIC_RACE,
  RUNNER_A,
  RUNNER_B,
  seedParticipation,
} from './fixtures/participation-repositories.js';

/**
 * Sacs de la Préparation — 00_PRODUCT_SPEC §14.4 ; 04_ENTITLEMENTS §45 ;
 * décisions produit du 2026-11-16 (suggestions, « Pas besoin », drop bag aux
 * seuls points acceptés, coches indépendantes de la checklist).
 */

const NOW = new Date('2026-03-01T10:00:00.000Z');

const DEPART = '0d000000-0000-4000-8000-000000000001';
const RAVITO = '0d000000-0000-4000-8000-000000000002';
const BASE_VIE = '0d000000-0000-4000-8000-000000000003';
const COL = '0d000000-0000-4000-8000-000000000004';
const ARRIVEE = '0d000000-0000-4000-8000-000000000005';

function waypoint(
  id: string,
  name: string,
  waypointType: CourseWaypointRecord['waypointType'],
  distanceKm: number,
  dropBagAllowed = false,
  assistanceAllowed = waypointType === 'assistance',
): CourseWaypointRecord {
  return {
    id,
    raceId: PUBLIC_RACE,
    name,
    waypointType,
    distanceKm,
    sortOrder: Math.round(distanceKm),
    altitudeM: null,
    dropBagAllowed,
    assistanceAllowed,
  };
}

let waypoints: CourseWaypointRecord[];

function fact(
  factId: string,
  category: PublishedRaceFactRecord['category'],
  text: string,
): PublishedRaceFactRecord {
  return {
    factId,
    raceId: PUBLIC_RACE,
    category,
    factKey: `${category}.${factId}`,
    versionId: `${factId}-v1`,
    versionNumber: 1,
    valueText: text,
    valueNumber: null,
    unit: null,
    valueJson: null,
    trustLevel: 'official',
    publishedAt: '2026-01-01T00:00:00.000Z',
    source: null,
  };
}

const FACTS: readonly PublishedRaceFactRecord[] = [
  fact('0e000000-0000-4000-8000-000000000001', 'equipment', 'Frontale'),
  fact('0e000000-0000-4000-8000-000000000002', 'equipment', 'Veste imperméable'),
  fact('0e000000-0000-4000-8000-000000000003', 'bag', 'Un sac de 30 litres au plus, étiqueté.'),
];

let entitlements: EntitlementState;
let own: string;
let ownOther: string;
let foreign: string;
let sequence = 0;
let assistance: ParticipantRaceSettingsRecord['assistanceStatus'] | null;

type StoredBag = BagRecord & { readonly participantRaceId: string };
let bags: StoredBag[];
let dismissed: { participantRaceId: string; key: string }[];

function id(prefix: string): string {
  sequence += 1;
  return `${prefix}-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

/** Comme 0095 : un seul sac par rôle et par point ; la RLS borne au propriétaire. */
function fakeBags(): BagRepository {
  return {
    listBags: async (participantRaceId) =>
      bags.filter((bag) => bag.participantRaceId === participantRaceId),
    createBag: async (participantRaceId, bag) => {
      const duplicate = bags.some(
        (existing) =>
          existing.participantRaceId === participantRaceId &&
          bag.bagType !== 'other' &&
          existing.bagType === bag.bagType &&
          existing.raceWaypointId === bag.raceWaypointId,
      );
      if (duplicate) return;
      bags.push({ ...bag, id: id('0f000000'), participantRaceId, items: [] });
    },
    renameBag: async (participantRaceId, bagId, name) => {
      bags = bags.map((bag) =>
        bag.id === bagId && bag.participantRaceId === participantRaceId ? { ...bag, name } : bag,
      );
    },
    deleteBag: async (participantRaceId, bagId) => {
      bags = bags.filter(
        (bag) => !(bag.id === bagId && bag.participantRaceId === participantRaceId),
      );
    },
    addItems: async (bagId, items) => {
      bags = bags.map((bag) =>
        bag.id === bagId
          ? {
              ...bag,
              items: [
                ...bag.items,
                ...items.map((item) => ({ ...item, id: id('0a100000'), checked: false })),
              ],
            }
          : bag,
      );
    },
    setItemChecked: async (bagId, itemId, checked) => {
      bags = bags.map((bag) =>
        bag.id === bagId
          ? {
              ...bag,
              items: bag.items.map((item) => (item.id === itemId ? { ...item, checked } : item)),
            }
          : bag,
      );
    },
    removeItem: async (bagId, itemId) => {
      bags = bags.map((bag) =>
        bag.id === bagId ? { ...bag, items: bag.items.filter((item) => item.id !== itemId) } : bag,
      );
    },
    listDismissedSuggestions: async (participantRaceId) =>
      dismissed.filter((row) => row.participantRaceId === participantRaceId).map((row) => row.key),
    dismissSuggestion: async (participantRaceId, key) => {
      if (
        !dismissed.some((row) => row.participantRaceId === participantRaceId && row.key === key)
      ) {
        dismissed.push({ participantRaceId, key });
      }
    },
    restoreSuggestions: async (participantRaceId) => {
      dismissed = dismissed.filter((row) => row.participantRaceId !== participantRaceId);
    },
  };
}

function context(userId: string = RUNNER_A): BagsContext {
  return {
    repositories: {
      ...createFakeEntitlementRepositories(entitlements),
      bags: fakeBags(),
      participantRaceSettings: {
        findByParticipantRace: async () =>
          assistance === null
            ? null
            : ({ assistanceStatus: assistance } as ParticipantRaceSettingsRecord),
      } as unknown as ParticipantRaceSettingsRepository,
      waypoints: {
        listByRace: async () => waypoints,
      } as unknown as RaceWaypointRepository,
      publishedFacts: {
        listPublishedByRace: async () => FACTS,
      } as unknown as PublishedFactRepository,
      preparation: {
        listEquipment: async () => [
          {
            id: 'perso',
            raceFactId: null,
            customLabel: 'Bâtons',
            origin: 'personal',
            ready: true,
          },
        ],
      } as unknown as PreparationRepository,
      library: {
        listEquipment: async () => [
          { id: 'lib', label: 'Chaussettes sèches', category: 'clothing', tags: [] },
          { id: 'lib2', label: 'frontale', category: 'light', tags: [] },
        ],
      } as unknown as LibraryRepository,
    },
    actor: { userId },
    now: () => NOW,
  };
}

function racePass(participantRaceId: string = own): void {
  grantEntitlement(entitlements, { kind: 'race_pass', userId: RUNNER_A, participantRaceId });
}

beforeEach(() => {
  const participation = participationBaseState();
  own = seedParticipation(participation, { userId: RUNNER_A, raceId: PUBLIC_RACE }).id;
  ownOther = seedParticipation(participation, { userId: RUNNER_A, raceId: PUBLIC_RACE }).id;
  foreign = seedParticipation(participation, { userId: RUNNER_B, raceId: PUBLIC_RACE }).id;
  entitlements = entitlementBaseState(participation);
  waypoints = [
    waypoint(DEPART, 'Départ', 'start', 0),
    waypoint(RAVITO, 'Ravito du lac', 'aid_station', 18),
    waypoint(BASE_VIE, 'Base vie', 'assistance', 52, true),
    waypoint(COL, 'Col', 'checkpoint', 80, true),
    waypoint(ARRIVEE, 'Arrivée', 'finish', 120),
  ];
  assistance = null;
  bags = [];
  dismissed = [];
});

describe('suggestBags — fonction pure', () => {
  const base = () => ({
    waypoints,
    assistanceStatus: null,
    bags: [],
    dismissed: new Set<string>(),
  });

  it('suit la course : départ, points au fil des kilomètres, arrivée', () => {
    expect(suggestBags(base()).map((suggestion) => suggestion.key)).toEqual([
      'start',
      `drop_bag:${BASE_VIE}`,
      `assistance:${BASE_VIE}`,
      `drop_bag:${COL}`,
      'finish',
    ]);
  });

  it('nomme chaque sac par son rôle et son point', () => {
    expect(suggestBags(base()).map((suggestion) => suggestion.name)).toEqual([
      'Sac de départ',
      'Drop bag · Base vie',
      'Sac d’assistance · Base vie',
      'Drop bag · Col',
      'Sac d’arrivée',
    ]);
  });

  it('ne suggère aucun drop bag là où l’organisation n’en accepte pas', () => {
    const keys = suggestBags(base()).map((suggestion) => suggestion.key);

    expect(keys).not.toContain(`drop_bag:${RAVITO}`);
  });

  it('ne suggère pas de sac d’assistance à un coureur autonome', () => {
    const keys = suggestBags({ ...base(), assistanceStatus: 'autonomous' }).map(
      (suggestion) => suggestion.key,
    );

    expect(keys).not.toContain(`assistance:${BASE_VIE}`);
    expect(keys).toContain(`drop_bag:${BASE_VIE}`);
  });

  it('retire ce qui existe déjà et ce qui a été écarté', () => {
    const keys = suggestBags({
      ...base(),
      bags: [
        { bagType: 'start', raceWaypointId: null },
        { bagType: 'drop_bag', raceWaypointId: COL },
      ],
      dismissed: new Set(['finish']),
    }).map((suggestion) => suggestion.key);

    expect(keys).toEqual([`drop_bag:${BASE_VIE}`, `assistance:${BASE_VIE}`]);
  });

  it('rend la même liste pour la même entrée', () => {
    expect(suggestBags(base())).toEqual(suggestBags(base()));
  });
});

describe('lecture', () => {
  it('ouvre vide, avec les suggestions et les consignes officielles', async () => {
    const overview = await getBags(context(), { participantRaceId: own });

    expect(overview.bags).toEqual([]);
    expect(overview.suggestions).toHaveLength(5);
    expect(overview.officialNotes.map((note) => note.text)).toEqual([
      'Un sac de 30 litres au plus, étiqueté.',
    ]);
    expect(overview.dropBagPoints.map((point) => point.name)).toEqual(['Base vie', 'Col']);
    expect(overview.assistancePoints.map((point) => point.name)).toEqual(['Base vie']);
  });

  it('se lit en Free, sans rien permettre d’écrire', async () => {
    const overview = await getBags(context(), { participantRaceId: own });

    expect(overview.canEdit).toBe(false);
  });

  it('refuse les sacs d’un autre coureur', async () => {
    await expect(getBags(context(), { participantRaceId: foreign })).rejects.toBeDefined();
  });
});

describe('droits — 04_ENTITLEMENTS §45', () => {
  it('refuse de créer un sac sans Race Pass', async () => {
    await expect(
      createBag(context(), { participantRaceId: own, bagType: 'start' }),
    ).rejects.toBeInstanceOf(EntitlementError);
    expect(bags).toEqual([]);
  });

  it('refuse d’écarter une suggestion sans Race Pass', async () => {
    await expect(
      dismissBagSuggestion(context(), { participantRaceId: own, key: 'start' }),
    ).rejects.toBeInstanceOf(EntitlementError);
  });

  it('ne laisse pas un Race Pass d’une course servir sur une autre', async () => {
    racePass(ownOther);

    await expect(
      createBag(context(), { participantRaceId: own, bagType: 'start' }),
    ).rejects.toBeInstanceOf(EntitlementError);
  });

  it('refuse d’écrire dans les sacs d’un autre coureur', async () => {
    racePass();

    await expect(
      createBag(context(), { participantRaceId: foreign, bagType: 'start' }),
    ).rejects.toBeDefined();
  });
});

describe('création', () => {
  beforeEach(() => racePass());

  it('accepte une suggestion, une seule fois', async () => {
    await createBag(context(), { participantRaceId: own, bagType: 'start' });
    await createBag(context(), { participantRaceId: own, bagType: 'start' });

    const overview = await getBags(context(), { participantRaceId: own });
    expect(overview.bags.map((bag) => bag.name)).toEqual(['Sac de départ']);
    expect(overview.suggestions.map((suggestion) => suggestion.key)).not.toContain('start');
  });

  it('rattache un drop bag à un point qui l’accepte', async () => {
    await createBag(context(), { participantRaceId: own, bagType: 'drop_bag', pointId: COL });

    const overview = await getBags(context(), { participantRaceId: own });
    expect(overview.bags[0]?.name).toBe('Drop bag · Col');
    expect(overview.bags[0]?.point).toEqual({ id: COL, name: 'Col', distanceKm: 80 });
  });

  it('refuse un drop bag là où l’organisation n’en accepte pas', async () => {
    await expect(
      createBag(context(), { participantRaceId: own, bagType: 'drop_bag', pointId: RAVITO }),
    ).rejects.toMatchObject({ code: 'validation' });
    expect(bags).toEqual([]);
  });

  it('refuse un sac d’assistance hors d’un point d’assistance', async () => {
    await expect(
      createBag(context(), { participantRaceId: own, bagType: 'assistance', pointId: COL }),
    ).rejects.toMatchObject({ code: 'validation' });
  });

  it('demande un nom pour un sac « autre »', async () => {
    await expect(
      createBag(context(), { participantRaceId: own, bagType: 'other' }),
    ).rejects.toMatchObject({ code: 'validation' });

    await createBag(context(), { participantRaceId: own, bagType: 'other', name: 'Sac voiture' });
    expect(bags.map((bag) => bag.name)).toEqual(['Sac voiture']);
  });

  it('rend sa suggestion quand on supprime le sac', async () => {
    await createBag(context(), { participantRaceId: own, bagType: 'finish' });
    const [bag] = bags;
    await deleteBag(context(), { participantRaceId: own, bagId: bag?.id });

    const overview = await getBags(context(), { participantRaceId: own });
    expect(overview.suggestions.map((suggestion) => suggestion.key)).toContain('finish');
  });
});

describe('contenu', () => {
  let bagId: string;

  beforeEach(async () => {
    racePass();
    await createBag(context(), { participantRaceId: own, bagType: 'start' });
    bagId = bags[0]?.id ?? '';
  });

  it('propose la checklist et « Mon matériel », sans doublon', async () => {
    const overview = await getBags(context(), { participantRaceId: own });

    expect(overview.bags[0]?.picks).toEqual([
      'Frontale',
      'Veste imperméable',
      'Bâtons',
      'Chaussettes sèches',
    ]);
  });

  it('ajoute, ignore ce qui y est déjà, et le retire des propositions', async () => {
    const first = await addBagItems(context(), {
      participantRaceId: own,
      bagId,
      labels: ['Frontale', '  Gels  '],
      quantity: 4,
    });
    const second = await addBagItems(context(), {
      participantRaceId: own,
      bagId,
      labels: ['frontale'],
    });

    expect([first, second]).toEqual([2, 0]);
    const overview = await getBags(context(), { participantRaceId: own });
    expect(overview.bags[0]?.items.map((item) => [item.label, item.quantity])).toEqual([
      ['Frontale', 4],
      ['Gels', 4],
    ]);
    expect(overview.bags[0]?.picks).not.toContain('Frontale');
  });

  it('refuse un élément vide', async () => {
    await expect(
      addBagItems(context(), { participantRaceId: own, bagId, labels: ['   '] }),
    ).rejects.toMatchObject({ code: 'validation' });
  });

  it('est prêt quand tout est coché, et pas avant', async () => {
    await addBagItems(context(), { participantRaceId: own, bagId, labels: ['Frontale', 'Gels'] });
    const [frontale, gels] = bags[0]?.items ?? [];

    await setBagItemChecked(context(), {
      participantRaceId: own,
      bagId,
      itemId: frontale?.id,
      checked: true,
    });
    let overview = await getBags(context(), { participantRaceId: own });
    expect(overview.bags[0]?.ready).toBe(false);
    expect(overview.ready).toEqual({ ready: 0, total: 1 });

    await setBagItemChecked(context(), {
      participantRaceId: own,
      bagId,
      itemId: gels?.id,
      checked: true,
    });
    overview = await getBags(context(), { participantRaceId: own });
    expect(overview.bags[0]?.ready).toBe(true);
    expect(overview.ready).toEqual({ ready: 1, total: 1 });
  });

  it('ne compte pas un sac vide comme prêt', async () => {
    const overview = await getBags(context(), { participantRaceId: own });

    expect(overview.bags[0]?.ready).toBe(false);
  });

  it('retire un élément', async () => {
    await addBagItems(context(), { participantRaceId: own, bagId, labels: ['Gels'] });
    await removeBagItem(context(), {
      participantRaceId: own,
      bagId,
      itemId: bags[0]?.items[0]?.id,
    });

    expect(bags[0]?.items).toEqual([]);
  });

  it('ne touche pas un sac d’une autre course, même du même coureur', async () => {
    racePass(ownOther);

    await expect(
      addBagItems(context(), { participantRaceId: ownOther, bagId, labels: ['Gels'] }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(bags[0]?.items).toEqual([]);
  });
});

describe('changements côté organisation', () => {
  beforeEach(() => racePass());

  it('signale un drop bag dont le point n’en accepte plus', async () => {
    await createBag(context(), { participantRaceId: own, bagType: 'drop_bag', pointId: COL });
    waypoints = waypoints.map((entry) =>
      entry.id === COL ? { ...entry, dropBagAllowed: false } : entry,
    );

    const overview = await getBags(context(), { participantRaceId: own });
    expect(overview.bags[0]?.pointIssue).toBe('drop_bag_withdrawn');
  });

  it('signale un sac d’assistance dont le point ne l’autorise plus (0098)', async () => {
    await createBag(context(), {
      participantRaceId: own,
      bagType: 'assistance',
      pointId: BASE_VIE,
    });
    waypoints = waypoints.map((entry) =>
      entry.id === BASE_VIE ? { ...entry, assistanceAllowed: false } : entry,
    );

    const overview = await getBags(context(), { participantRaceId: own });
    expect(overview.bags[0]?.pointIssue).toBe('assistance_withdrawn');
  });

  it('propose l’assistance là où l’organisation l’autorise, pas selon le type du point', async () => {
    waypoints = waypoints.map((entry) =>
      entry.id === RAVITO ? { ...entry, assistanceAllowed: true } : entry,
    );

    const overview = await getBags(context(), { participantRaceId: own });
    expect(overview.assistancePoints.map((point) => point.name)).toEqual([
      'Ravito du lac',
      'Base vie',
    ]);
  });

  it('signale un sac dont le point a été retiré', async () => {
    await createBag(context(), { participantRaceId: own, bagType: 'drop_bag', pointId: COL });
    bags = bags.map((bag) => ({ ...bag, raceWaypointId: null }));

    const overview = await getBags(context(), { participantRaceId: own });
    expect(overview.bags[0]?.pointIssue).toBe('removed');
    expect(overview.bags[0]?.point).toBeNull();
  });
});

describe('« Pas besoin »', () => {
  beforeEach(() => racePass());

  it('écarte une suggestion, puis la réaffiche', async () => {
    await dismissBagSuggestion(context(), { participantRaceId: own, key: `drop_bag:${COL}` });

    let overview = await getBags(context(), { participantRaceId: own });
    expect(overview.suggestions.map((suggestion) => suggestion.key)).not.toContain(
      `drop_bag:${COL}`,
    );
    expect(overview.dismissedCount).toBe(1);

    await restoreBagSuggestions(context(), { participantRaceId: own });
    overview = await getBags(context(), { participantRaceId: own });
    expect(overview.suggestions.map((suggestion) => suggestion.key)).toContain(`drop_bag:${COL}`);
    expect(overview.dismissedCount).toBe(0);
  });

  it('refuse une clé qui ne nomme aucune suggestion', async () => {
    await expect(
      dismissBagSuggestion(context(), { participantRaceId: own, key: 'nimporte' }),
    ).rejects.toMatchObject({ code: 'validation' });
  });

  it('écarter deux fois ne compte qu’une fois', async () => {
    await dismissBagSuggestion(context(), { participantRaceId: own, key: 'finish' });
    await dismissBagSuggestion(context(), { participantRaceId: own, key: 'finish' });

    const overview = await getBags(context(), { participantRaceId: own });
    expect(overview.dismissedCount).toBe(1);
  });
});
