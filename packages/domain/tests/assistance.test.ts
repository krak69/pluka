import type {
  AssistanceAssignmentRecord,
  AssistanceItemRecord,
  AssistanceRepository,
  AssistantRecord,
  CourseWaypointRecord,
  RacePlanRepository,
  RaceRepository,
  RaceWaypointRepository,
} from '@pluka/db';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  addAssistant,
  addRendezvous,
  addRendezvousItems,
  assistancePassage,
  DomainError,
  EntitlementError,
  getAssistance,
  removeAssistant,
  removeRendezvous,
  removeRendezvousItem,
  setAssistanceStatus,
  setRendezvousInstructions,
  type AssistanceContext,
} from '../src/index.js';
import {
  createFakeEntitlementRepositories,
  entitlementBaseState,
  grantEntitlement,
  type EntitlementState,
} from './fixtures/entitlement-repositories.js';
import {
  createFakeParticipationRepositories,
  participationBaseState,
  PUBLIC_RACE,
  RUNNER_A,
  RUNNER_B,
  seedParticipation,
  type ParticipationState,
} from './fixtures/participation-repositories.js';

/**
 * Assistance du coureur — 00_PRODUCT_SPEC §15, AC-ASST-02 à 05, PLAN_ENGINE
 * §42, décisions du 2026-11-17 (choix gratuit ; personnes et rendez-vous Race
 * Pass ; heure tirée du Plan).
 */

const NOW = new Date('2026-06-20T08:00:00.000Z');
const START = '2026-07-04T04:00:00.000Z';
const DEPART = '0d000000-0000-4000-8000-000000000001';
const RAVITO = '0d000000-0000-4000-8000-000000000002';
const BASE_VIE = '0d000000-0000-4000-8000-000000000003';
const ARRIVEE = '0d000000-0000-4000-8000-000000000004';

let participation: ParticipationState;
let entitlements: EntitlementState;
let own: string;
let foreign: string;
let sequence = 0;
let waypoints: CourseWaypointRecord[];
let plannedElapsed: Map<string, number> | null;
type Stored<T> = T & { readonly participantRaceId?: string };
let assistants: Stored<AssistantRecord>[];
let assignments: AssistanceAssignmentRecord[];
let items: AssistanceItemRecord[];

function id(): string {
  sequence += 1;
  return `0e000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

function point(
  pointId: string,
  name: string,
  waypointType: CourseWaypointRecord['waypointType'],
  distanceKm: number,
  assistanceAllowed: boolean,
): CourseWaypointRecord {
  return {
    id: pointId,
    raceId: PUBLIC_RACE,
    name,
    waypointType,
    distanceKm,
    sortOrder: Math.round(distanceKm),
    altitudeM: null,
    dropBagAllowed: false,
    assistanceAllowed,
  };
}

/** Comme la RLS (0005) et le déclencheur 0098, en plus simple. */
function fakeAssistance(): AssistanceRepository {
  return {
    listAssistants: async (participantRaceId) =>
      assistants.filter((entry) => entry.participantRaceId === participantRaceId),
    createAssistant: async (participantRaceId, assistant) => {
      assistants.push({ id: id(), participantRaceId, ...assistant });
    },
    updateAssistant: async (participantRaceId, assistantId, assistant) => {
      assistants = assistants.map((entry) =>
        entry.id === assistantId && entry.participantRaceId === participantRaceId
          ? { ...entry, ...assistant }
          : entry,
      );
    },
    deleteAssistant: async (participantRaceId, assistantId) => {
      assistants = assistants.filter(
        (entry) => !(entry.id === assistantId && entry.participantRaceId === participantRaceId),
      );
      const gone = assignments.filter((entry) => entry.assistantId === assistantId);
      assignments = assignments.filter((entry) => entry.assistantId !== assistantId);
      items = items.filter((item) => !gone.some((entry) => entry.id === item.assignmentId));
    },
    listAssignments: async (assistantIds) =>
      assignments.filter((entry) => assistantIds.includes(entry.assistantId)),
    createAssignment: async (assistantId, raceWaypointId) => {
      if (
        assignments.some(
          (entry) => entry.assistantId === assistantId && entry.raceWaypointId === raceWaypointId,
        )
      ) {
        return;
      }
      assignments.push({ id: id(), assistantId, raceWaypointId, instructions: null });
    },
    setInstructions: async (assignmentId, instructions) => {
      assignments = assignments.map((entry) =>
        entry.id === assignmentId ? { ...entry, instructions } : entry,
      );
    },
    deleteAssignment: async (assignmentId) => {
      assignments = assignments.filter((entry) => entry.id !== assignmentId);
      items = items.filter((item) => item.assignmentId !== assignmentId);
    },
    listItems: async (assignmentIds) =>
      items.filter((item) => assignmentIds.includes(item.assignmentId)),
    addItems: async (assignmentId, labels) => {
      items.push(...labels.map((label) => ({ id: id(), assignmentId, label })));
    },
    deleteItem: async (itemId) => {
      items = items.filter((item) => item.id !== itemId);
    },
  };
}

function context(userId: string = RUNNER_A): AssistanceContext {
  const participations = createFakeParticipationRepositories(participation);
  return {
    repositories: {
      ...createFakeEntitlementRepositories(entitlements),
      participantRaceSettings: participations.participantRaceSettings,
      assistance: fakeAssistance(),
      waypoints: {
        listByRace: async () => waypoints,
      } as unknown as RaceWaypointRepository,
      racePlans: {
        findActive: async () => (plannedElapsed === null ? null : { id: 'plan', startAt: START }),
        listWaypoints: async () =>
          [...(plannedElapsed ?? new Map<string, number>())].map(([raceWaypointId, elapsed]) => ({
            raceWaypointId,
            plannedElapsedSeconds: elapsed,
          })),
      } as unknown as RacePlanRepository,
      races: {
        findById: async (raceId: string) => ({ id: raceId, timezone: 'Europe/Paris' }),
      } as unknown as RaceRepository,
    },
    actor: { userId },
    now: () => NOW,
  };
}

function racePass(): void {
  grantEntitlement(entitlements, { kind: 'race_pass', userId: RUNNER_A, participantRaceId: own });
}

async function expectDomainError(promise: Promise<unknown>, code: DomainError['code']) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
}

/** Une personne, avec un rendez-vous à la base de vie. */
async function camilleAtBaseVie(): Promise<{ assistantId: string; rendezvousId: string }> {
  await addAssistant(context(), { participantRaceId: own, firstName: 'Camille' });
  const assistantId = assistants[0]?.id ?? '';
  await addRendezvous(context(), { participantRaceId: own, assistantId, pointId: BASE_VIE });
  return { assistantId, rendezvousId: assignments[0]?.id ?? '' };
}

beforeEach(() => {
  participation = participationBaseState();
  own = seedParticipation(participation, { userId: RUNNER_A, raceId: PUBLIC_RACE }).id;
  foreign = seedParticipation(participation, { userId: RUNNER_B, raceId: PUBLIC_RACE }).id;
  entitlements = entitlementBaseState(participation);
  waypoints = [
    point(DEPART, 'Départ', 'start', 0, false),
    point(RAVITO, 'Ravito du lac', 'aid_station', 18, false),
    point(BASE_VIE, 'Base vie', 'assistance', 52, true),
    point(ARRIVEE, 'Arrivée', 'finish', 80, false),
  ];
  plannedElapsed = new Map([
    [DEPART, 0],
    [RAVITO, 2 * 3600],
    [BASE_VIE, 8 * 3600],
    [ARRIVEE, 14 * 3600],
  ]);
  assistants = [];
  assignments = [];
  items = [];
});

describe('assistancePassage — PLAN_ENGINE §42', () => {
  it('borne la demi-fenêtre entre 15 et 60 minutes', () => {
    // 1 h écoulée : 4,5 min, relevée à 15.
    expect(assistancePassage(START, 3600)).toEqual({
      at: '2026-07-04T05:00:00.000Z',
      windowStart: '2026-07-04T04:45:00.000Z',
      windowEnd: '2026-07-04T05:15:00.000Z',
    });
    // 8 h : 36 min.
    expect(assistancePassage(START, 8 * 3600).windowStart).toBe('2026-07-04T11:24:00.000Z');
    // 20 h : 90 min, ramenée à 60.
    expect(assistancePassage(START, 20 * 3600).windowEnd).toBe('2026-07-05T01:00:00.000Z');
  });
});

describe('choix d’assistance — gratuit (AC-ASST-02)', () => {
  it('commence « à définir », puis retient le choix du coureur Free', async () => {
    expect((await getAssistance(context(), { participantRaceId: own })).status).toBe('to_define');

    await setAssistanceStatus(context(), { participantRaceId: own, status: 'autonomous' });

    const overview = await getAssistance(context(), { participantRaceId: own });
    expect(overview.status).toBe('autonomous');
    expect(overview.canEdit).toBe(false);
  });

  it('ne propose que les points où l’organisation autorise l’assistance', async () => {
    const overview = await getAssistance(context(), { participantRaceId: own });

    expect(overview.points.map((entry) => entry.name)).toEqual(['Base vie']);
  });

  it('ne touche pas au choix d’un autre coureur', async () => {
    await expect(
      setAssistanceStatus(context(RUNNER_B), { participantRaceId: own, status: 'enabled' }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe('personnes et rendez-vous — Race Pass', () => {
  it('refuse d’ajouter une personne sans Race Pass', async () => {
    await expect(
      addAssistant(context(), { participantRaceId: own, firstName: 'Camille' }),
    ).rejects.toBeInstanceOf(EntitlementError);
    expect(assistants).toEqual([]);
  });

  it('ajoute une personne, passe en « avec assistance », et lit l’heure dans le Plan', async () => {
    racePass();
    await addAssistant(context(), {
      participantRaceId: own,
      firstName: ' Camille ',
      lastName: '',
      phone: '06 12 34 56 78',
    });
    await addRendezvous(context(), {
      participantRaceId: own,
      assistantId: assistants[0]?.id,
      pointId: BASE_VIE,
    });

    const overview = await getAssistance(context(), { participantRaceId: own });
    expect(overview.status).toBe('enabled');
    expect(overview.people).toHaveLength(1);
    expect(overview.people[0]).toMatchObject({
      firstName: 'Camille',
      lastName: null,
      phone: '06 12 34 56 78',
    });
    expect(overview.people[0]?.rendezvous[0]).toMatchObject({
      point: { name: 'Base vie', distanceKm: 52 },
      pointIssue: null,
      passage: assistancePassage(START, 8 * 3600),
    });
  });

  it('refuse un rendez-vous là où l’assistance n’est pas autorisée (AC-ASST-03)', async () => {
    racePass();
    await addAssistant(context(), { participantRaceId: own, firstName: 'Camille' });

    await expectDomainError(
      addRendezvous(context(), {
        participantRaceId: own,
        assistantId: assistants[0]?.id,
        pointId: RAVITO,
      }),
      'validation',
    );
    expect(assignments).toEqual([]);
  });

  it('refuse un numéro qui n’en est pas un', async () => {
    racePass();

    await expectDomainError(
      addAssistant(context(), { participantRaceId: own, firstName: 'Camille', phone: 'appelle' }),
      'validation',
    );
  });

  it('suit le Plan : l’heure change, les consignes restent (AC-ASST-05)', async () => {
    racePass();
    const { rendezvousId } = await camilleAtBaseVie();
    await setRendezvousInstructions(context(), {
      participantRaceId: own,
      rendezvousId,
      instructions: 'Parking du haut',
    });

    plannedElapsed?.set(BASE_VIE, 9 * 3600);

    const rendezvous = (await getAssistance(context(), { participantRaceId: own })).people[0]
      ?.rendezvous[0];
    expect(rendezvous?.passage?.at).toBe('2026-07-04T13:00:00.000Z');
    expect(rendezvous?.instructions).toBe('Parking du haut');
  });

  it('sans Plan, ou un point que le Plan ne connaît pas encore : pas d’heure', async () => {
    racePass();
    await camilleAtBaseVie();

    plannedElapsed?.delete(BASE_VIE);
    expect(
      (await getAssistance(context(), { participantRaceId: own })).people[0]?.rendezvous[0]
        ?.passage,
    ).toBeNull();

    plannedElapsed = null;
    const overview = await getAssistance(context(), { participantRaceId: own });
    expect(overview.hasPlan).toBe(false);
    expect(overview.people[0]?.rendezvous[0]?.passage).toBeNull();
  });

  it('signale un point qui n’autorise plus l’assistance, sans retirer le rendez-vous', async () => {
    racePass();
    await camilleAtBaseVie();
    waypoints = waypoints.map((entry) =>
      entry.id === BASE_VIE ? { ...entry, assistanceAllowed: false } : entry,
    );

    const rendezvous = (await getAssistance(context(), { participantRaceId: own })).people[0]
      ?.rendezvous[0];
    expect(rendezvous?.pointIssue).toBe('assistance_withdrawn');
  });

  it('« À me donner » : nettoie, sans doublon, et retire une ligne', async () => {
    racePass();
    const { rendezvousId } = await camilleAtBaseVie();

    await addRendezvousItems(context(), {
      participantRaceId: own,
      rendezvousId,
      labels: ['Gourde pleine', ' gourde  pleine ', 'Chaussettes'],
    });
    await addRendezvousItems(context(), {
      participantRaceId: own,
      rendezvousId,
      labels: ['Chaussettes'],
    });
    expect(items.map((item) => item.label)).toEqual(['Gourde pleine', 'Chaussettes']);

    await removeRendezvousItem(context(), { participantRaceId: own, itemId: items[0]?.id });
    expect(items.map((item) => item.label)).toEqual(['Chaussettes']);
  });

  it('retirer une personne retire ses rendez-vous', async () => {
    racePass();
    const { assistantId } = await camilleAtBaseVie();

    await removeAssistant(context(), { participantRaceId: own, assistantId });

    expect(assistants).toEqual([]);
    expect(assignments).toEqual([]);
  });

  it('ne touche ni aux personnes ni aux rendez-vous d’une autre participation', async () => {
    racePass();
    const { assistantId, rendezvousId } = await camilleAtBaseVie();
    grantEntitlement(entitlements, {
      kind: 'race_pass',
      userId: RUNNER_B,
      participantRaceId: foreign,
    });

    await expectDomainError(
      removeRendezvous(context(RUNNER_B), { participantRaceId: foreign, rendezvousId }),
      'not_found',
    );
    await expectDomainError(
      removeAssistant(context(RUNNER_B), { participantRaceId: foreign, assistantId }),
      'not_found',
    );
    await expect(
      getAssistance(context(RUNNER_B), { participantRaceId: own }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(assignments).toHaveLength(1);
  });
});
