import type {
  EquipmentReadiness,
  ParticipantEquipmentRecord,
  PreparationRepository,
  PublishedFactRepository,
  PublishedRaceFactRecord,
} from '@pluka/db';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  addPersonalEquipment,
  EntitlementError,
  getEquipmentChecklist,
  removePersonalEquipment,
  setOfficialEquipmentReady,
  setPersonalEquipmentReady,
  type PreparationContext,
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
  UNLISTED_RACE,
} from './fixtures/participation-repositories.js';

/**
 * Checklist de matériel — 00_PRODUCT_SPEC §14.1, §14.2 ; 04_ENTITLEMENTS §45,
 * §57 ; décision produit du 2026-11-13 (le Free coche le matériel de
 * l'organisation, le matériel personnel est Race Pass).
 */

const NOW = new Date('2026-03-01T10:00:00.000Z');
const FRONTALE = '0a000000-0000-4000-8000-000000000001';
const VESTE = '0a000000-0000-4000-8000-000000000002';
const BATONS = '0a000000-0000-4000-8000-000000000003';
const SANS_EXIGENCE = '0a000000-0000-4000-8000-000000000004';
const AUTRE_COURSE = '0a000000-0000-4000-8000-000000000005';
const HEURE_DEPART = '0a000000-0000-4000-8000-000000000006';

function fact(
  factId: string,
  raceId: string,
  label: string,
  valueJson: Record<string, unknown> | null,
  category: PublishedRaceFactRecord['category'] = 'equipment',
): PublishedRaceFactRecord {
  return {
    factId,
    raceId,
    category,
    factKey: `${category}.${label}`,
    versionId: `${factId}-v1`,
    versionNumber: 1,
    valueText: label,
    valueNumber: null,
    unit: null,
    valueJson,
    trustLevel: 'official',
    publishedAt: '2026-01-01T00:00:00.000Z',
    source: null,
  };
}

const FACTS: readonly PublishedRaceFactRecord[] = [
  fact(VESTE, PUBLIC_RACE, 'Veste imperméable', { requirement: 'mandatory' }),
  fact(FRONTALE, PUBLIC_RACE, 'Frontale', { requirement: 'mandatory', detail: '200 lumens' }),
  fact(BATONS, PUBLIC_RACE, 'Bâtons', { requirement: 'recommended' }),
  fact(SANS_EXIGENCE, PUBLIC_RACE, 'Couverture de survie', null),
  fact(AUTRE_COURSE, UNLISTED_RACE, 'Frontale', { requirement: 'mandatory' }),
  fact(HEURE_DEPART, PUBLIC_RACE, 'Départ', null, 'start'),
];

let entitlements: EntitlementState;
let rows: (ParticipantEquipmentRecord & { readonly participantRaceId: string })[];
let own: string;
let foreign: string;
let sequence = 0;

function fakePreparation(): PreparationRepository {
  const status = (readiness: EquipmentReadiness) => readiness === 'ready';
  return {
    listEquipment: async (participantRaceId) =>
      rows.filter((row) => row.participantRaceId === participantRaceId),
    setOfficialEquipment: async (participantRaceId, raceFactId, readiness) => {
      rows = rows.filter(
        (row) => !(row.participantRaceId === participantRaceId && row.raceFactId === raceFactId),
      );
      rows.push({
        id: `row-${String((sequence += 1))}`,
        participantRaceId,
        raceFactId,
        customLabel: null,
        origin: 'official_requirement',
        ready: status(readiness),
      });
    },
    addPersonalEquipment: async (participantRaceId, label) => {
      rows.push({
        id: `0b000000-0000-4000-8000-${String((sequence += 1)).padStart(12, '0')}`,
        participantRaceId,
        raceFactId: null,
        customLabel: label,
        origin: 'personal',
        ready: false,
      });
    },
    setPersonalEquipment: async (participantRaceId, equipmentId, readiness) => {
      rows = rows.map((row) =>
        row.id === equipmentId && row.participantRaceId === participantRaceId
          ? { ...row, ready: status(readiness) }
          : row,
      );
    },
    removePersonalEquipment: async (participantRaceId, equipmentId) => {
      rows = rows.filter(
        (row) => !(row.id === equipmentId && row.participantRaceId === participantRaceId),
      );
    },
  };
}

const publishedFacts: PublishedFactRepository = {
  listPublishedByRace: async (raceId) => FACTS.filter((item) => item.raceId === raceId),
} as PublishedFactRepository;

function context(userId: string = RUNNER_A): PreparationContext {
  return {
    repositories: {
      ...createFakeEntitlementRepositories(entitlements),
      preparation: fakePreparation(),
      publishedFacts,
    },
    actor: { userId },
    now: () => NOW,
  };
}

beforeEach(() => {
  const participation = participationBaseState();
  own = seedParticipation(participation, { userId: RUNNER_A, raceId: PUBLIC_RACE }).id;
  foreign = seedParticipation(participation, { userId: RUNNER_B, raceId: PUBLIC_RACE }).id;
  entitlements = entitlementBaseState(participation);
  rows = [];
});

describe('la checklist', () => {
  it('liste le matériel de l’organisation, l’obligatoire d’abord', async () => {
    const checklist = await getEquipmentChecklist(context(), { participantRaceId: own });

    expect(checklist.official.map((item) => item.label)).toEqual([
      'Frontale',
      'Veste imperméable',
      'Bâtons',
      'Couverture de survie',
    ]);
  });

  it('ne lit jamais une exigence que la source ne donne pas comme obligatoire', async () => {
    const checklist = await getEquipmentChecklist(context(), { participantRaceId: own });
    const unknown = checklist.official.find((item) => item.label === 'Couverture de survie');

    expect(unknown?.requirement).toBeNull();
    expect(checklist.mandatory.total).toBe(2);
  });

  it('ignore le matériel d’une autre course et les informations qui n’en sont pas', async () => {
    const checklist = await getEquipmentChecklist(context(), { participantRaceId: own });
    const ids = checklist.official.map((item) => item.raceFactId);

    expect(ids).not.toContain(AUTRE_COURSE);
    expect(ids).not.toContain(HEURE_DEPART);
  });

  it('compte dans la jauge l’obligatoire seul', async () => {
    await setOfficialEquipmentReady(context(), {
      participantRaceId: own,
      raceFactId: FRONTALE,
      ready: true,
    });
    await setOfficialEquipmentReady(context(), {
      participantRaceId: own,
      raceFactId: BATONS,
      ready: true,
    });

    const checklist = await getEquipmentChecklist(context(), { participantRaceId: own });
    expect(checklist.mandatory).toEqual({ ready: 1, total: 2 });
  });

  it('refuse la checklist d’un autre coureur', async () => {
    await expect(
      getEquipmentChecklist(context(), { participantRaceId: foreign }),
    ).rejects.toBeDefined();
  });
});

describe('le matériel de l’organisation se coche gratuitement', () => {
  it('un coureur Free coche et décoche une pièce', async () => {
    await setOfficialEquipmentReady(context(), {
      participantRaceId: own,
      raceFactId: VESTE,
      ready: true,
    });
    let checklist = await getEquipmentChecklist(context(), { participantRaceId: own });
    expect(checklist.official.find((item) => item.raceFactId === VESTE)?.ready).toBe(true);

    await setOfficialEquipmentReady(context(), {
      participantRaceId: own,
      raceFactId: VESTE,
      ready: false,
    });
    checklist = await getEquipmentChecklist(context(), { participantRaceId: own });
    expect(checklist.official.find((item) => item.raceFactId === VESTE)?.ready).toBe(false);
  });

  it('refuse une pièce d’une autre course', async () => {
    await expect(
      setOfficialEquipmentReady(context(), {
        participantRaceId: own,
        raceFactId: AUTRE_COURSE,
        ready: true,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuse de cocher dans la checklist d’un autre coureur', async () => {
    await expect(
      setOfficialEquipmentReady(context(), {
        participantRaceId: foreign,
        raceFactId: VESTE,
        ready: true,
      }),
    ).rejects.toBeDefined();
    expect(rows).toHaveLength(0);
  });
});

describe('le matériel personnel demande le Race Pass', () => {
  it('un coureur Free ne peut pas en ajouter', async () => {
    const checklist = await getEquipmentChecklist(context(), { participantRaceId: own });
    expect(checklist.canEditPersonal).toBe(false);

    await expect(
      addPersonalEquipment(context(), { participantRaceId: own, label: 'Bâtons perso' }),
    ).rejects.toBeInstanceOf(EntitlementError);
    expect(rows).toHaveLength(0);
  });

  it('avec un Race Pass, il ajoute, coche et retire', async () => {
    grantEntitlement(entitlements, {
      kind: 'race_pass',
      userId: RUNNER_A,
      participantRaceId: own,
    });

    await addPersonalEquipment(context(), { participantRaceId: own, label: '  Bâtons perso  ' });
    let checklist = await getEquipmentChecklist(context(), { participantRaceId: own });
    expect(checklist.canEditPersonal).toBe(true);
    expect(checklist.personal).toEqual([
      { id: expect.any(String) as string, label: 'Bâtons perso', ready: false },
    ]);

    const id = checklist.personal[0]?.id ?? '';
    await setPersonalEquipmentReady(context(), {
      participantRaceId: own,
      equipmentId: id,
      ready: true,
    });
    checklist = await getEquipmentChecklist(context(), { participantRaceId: own });
    expect(checklist.personal[0]?.ready).toBe(true);

    await removePersonalEquipment(context(), { participantRaceId: own, equipmentId: id });
    checklist = await getEquipmentChecklist(context(), { participantRaceId: own });
    expect(checklist.personal).toEqual([]);
  });

  it('refuse un intitulé vide', async () => {
    grantEntitlement(entitlements, {
      kind: 'race_pass',
      userId: RUNNER_A,
      participantRaceId: own,
    });

    await expect(
      addPersonalEquipment(context(), { participantRaceId: own, label: '   ' }),
    ).rejects.toMatchObject({ code: 'validation' });
  });

  it('le Race Pass d’une course ne vaut pas pour une autre', async () => {
    const participation = entitlements.participation;
    const other = seedParticipation(participation, { userId: RUNNER_A, raceId: UNLISTED_RACE }).id;
    grantEntitlement(entitlements, {
      kind: 'race_pass',
      userId: RUNNER_A,
      participantRaceId: own,
    });

    await expect(
      addPersonalEquipment(context(), { participantRaceId: other, label: 'Bâtons' }),
    ).rejects.toBeInstanceOf(EntitlementError);
  });
});
