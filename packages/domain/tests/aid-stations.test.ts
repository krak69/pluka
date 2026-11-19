import type { AidStationItemInput, AidStationRepository } from '@pluka/db';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  aidItemsOf,
  DomainError,
  getRaceWaypoints,
  setAidStationItems,
  setRaceWaypoints,
  type AidStationContext,
} from '../src/index.js';
import {
  baseState,
  createFakeRepositories,
  EDITOR_A,
  OUTSIDER,
  PLUKA_ADMIN,
  RACE_ID,
  VIEWER_A,
  type FakeState,
} from './fixtures/repositories.js';

/**
 * Contenu des ravitaillements — NUTRITION_ENGINE §31, §32 ; 0110. L'organisation
 * éditrice et l'équipe PLUKA disent ce que propose un point ; personne d'autre.
 */

let state: FakeState;
let saved: Map<string, readonly AidStationItemInput[]>;

function contextFor(userId: string): AidStationContext {
  const aidStations: AidStationRepository = {
    listByRace: async () => [],
    setForWaypoint: async (waypointId, items) => {
      saved.set(waypointId, items);
    },
  };
  return { repositories: { ...createFakeRepositories(state), aidStations }, actor: { userId } };
}

async function aidPointId(): Promise<string> {
  await setRaceWaypoints(contextFor(EDITOR_A), {
    raceId: RACE_ID,
    waypoints: [
      { name: 'Départ', waypointType: 'start', distanceKm: 0 },
      { name: 'Ravito 1', waypointType: 'aid_station', distanceKm: 18.5 },
      { name: 'Arrivée', waypointType: 'finish', distanceKm: 40 },
    ],
  });
  const waypoints = await getRaceWaypoints(contextFor(EDITOR_A), { raceId: RACE_ID });
  return waypoints.find((waypoint) => waypoint.name === 'Ravito 1')?.id ?? '';
}

beforeEach(() => {
  state = baseState();
  saved = new Map();
});

describe('aidItemsOf — ce qui s’enregistre', () => {
  it('les genres dans l’ordre d’affichage, puis le reste, sans doublon ni vide', () => {
    expect(aidItemsOf(['cola', 'water'], ['Fromage', ' fromage ', '', 'Pain d’épices'])).toEqual([
      { kind: 'water', label: 'Eau' },
      { kind: 'cola', label: 'Cola' },
      { kind: 'other', label: 'Fromage' },
      { kind: 'other', label: 'Pain d’épices' },
    ]);
  });
});

describe('setAidStationItems — qui peut dire ce que propose un point', () => {
  it('l’éditeur de l’organisation', async () => {
    const pointId = await aidPointId();
    await setAidStationItems(contextFor(EDITOR_A), {
      raceId: RACE_ID,
      waypointId: pointId,
      kinds: ['water', 'sports_drink'],
      others: [],
    });
    expect(saved.get(pointId)).toEqual([
      { kind: 'water', label: 'Eau' },
      { kind: 'sports_drink', label: 'Boisson d’effort' },
    ]);
  });

  it('l’équipe PLUKA, pour une course sans organisation active', async () => {
    const pointId = await aidPointId();
    await setAidStationItems(contextFor(PLUKA_ADMIN), {
      raceId: RACE_ID,
      waypointId: pointId,
      kinds: ['soup'],
      others: [],
    });
    expect(saved.get(pointId)).toEqual([{ kind: 'soup', label: 'Soupe ou bouillon' }]);
  });

  it('ni un viewer, ni une personne extérieure', async () => {
    const pointId = await aidPointId();
    for (const userId of [VIEWER_A, OUTSIDER]) {
      await expect(
        setAidStationItems(contextFor(userId), {
          raceId: RACE_ID,
          waypointId: pointId,
          kinds: ['water'],
          others: [],
        }),
      ).rejects.toBeInstanceOf(DomainError);
    }
    expect(saved.size).toBe(0);
  });

  it('refuse un point qui n’est pas de cette course, et un genre inconnu', async () => {
    await aidPointId();
    await expect(
      setAidStationItems(contextFor(EDITOR_A), {
        raceId: RACE_ID,
        waypointId: '0e000000-0000-4000-8000-0000000000ff',
        kinds: ['water'],
        others: [],
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      setAidStationItems(contextFor(EDITOR_A), {
        raceId: RACE_ID,
        waypointId: '0e000000-0000-4000-8000-0000000000ff',
        kinds: ['biere'],
        others: [],
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
