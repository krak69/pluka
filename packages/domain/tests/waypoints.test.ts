import { beforeEach, describe, expect, it } from 'vitest';

import {
  checkWaypointChain,
  DomainError,
  getRaceWaypoints,
  setRaceWaypoints,
  type CourseContext,
} from '../src/index.js';
import {
  ADMIN_A,
  baseState,
  createFakeRepositories,
  EDITOR_A,
  ORPHAN_RACE_ID,
  OUTSIDER,
  OWNER_B,
  PLUKA_ADMIN,
  RACE_ID,
  VIEWER_A,
  type FakeState,
} from './fixtures/repositories.js';

/**
 * Référentiel de parcours — PLAN_ENGINE §7, §8.1.
 *
 * Sans lui, le prétraitement s'arrête en `skipped` et aucun Plan n'existe.
 * Ce qui se teste ici est l'autorité, la cohérence de la chaîne, et le fait
 * que l'ordre du tableau soit bien ce qui fait le rang — pas la dérivation des
 * segments, qui appartient à la base.
 */

let state: FakeState;

function contextFor(userId: string): CourseContext {
  return { repositories: createFakeRepositories(state), actor: { userId } };
}

function chain(overrides: readonly Record<string, unknown>[] = []): Record<string, unknown> {
  return {
    raceId: RACE_ID,
    waypoints:
      overrides.length > 0
        ? overrides
        : [
            { name: 'Départ', waypointType: 'start', distanceKm: 0 },
            { name: 'Ravito 1', waypointType: 'aid_station', distanceKm: 18.5 },
            { name: 'Base de vie', waypointType: 'assistance', distanceKm: 42 },
            { name: 'Arrivée', waypointType: 'finish', distanceKm: 70 },
          ],
  };
}

async function expectDomainError(
  action: Promise<unknown>,
  code: DomainError['code'],
): Promise<DomainError> {
  try {
    await action;
    expect.unreachable('une DomainError était attendue');
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return error as DomainError;
  }
}

beforeEach(() => {
  state = baseState();
});

describe('cohérence de la chaîne — §7.4', () => {
  it('accepte un parcours ordinaire', () => {
    expect(
      checkWaypointChain([
        { waypointType: 'start', distanceKm: 0 },
        { waypointType: 'aid_station', distanceKm: 20 },
        { waypointType: 'finish', distanceKm: 70 },
      ]),
    ).toEqual({ ok: true });
  });

  it('refuse deux points au même kilomètre', () => {
    // Un segment a une longueur `> 0` : deux points au même endroit n'en
    // délimitent aucun, et la base le refuserait aussi.
    expect(
      checkWaypointChain([
        { waypointType: 'start', distanceKm: 0 },
        { waypointType: 'aid_station', distanceKm: 20 },
        { waypointType: 'finish', distanceKm: 20 },
      ]),
    ).toEqual({ ok: false, reason: 'distance_not_increasing', index: 2 });
  });

  it('refuse un kilomètre qui recule', () => {
    expect(
      checkWaypointChain([
        { waypointType: 'start', distanceKm: 0 },
        { waypointType: 'aid_station', distanceKm: 30 },
        { waypointType: 'finish', distanceKm: 25 },
      ]),
    ).toMatchObject({ ok: false, reason: 'distance_not_increasing' });
  });

  it('exige un départ et une arrivée', () => {
    expect(
      checkWaypointChain([
        { waypointType: 'aid_station', distanceKm: 0 },
        { waypointType: 'finish', distanceKm: 70 },
      ]),
    ).toMatchObject({ reason: 'missing_start' });

    expect(
      checkWaypointChain([
        { waypointType: 'start', distanceKm: 0 },
        { waypointType: 'aid_station', distanceKm: 70 },
      ]),
    ).toMatchObject({ reason: 'missing_finish' });
  });

  it('refuse un départ ailleurs qu’au début', () => {
    expect(
      checkWaypointChain([
        { waypointType: 'aid_station', distanceKm: 0 },
        { waypointType: 'start', distanceKm: 10 },
        { waypointType: 'finish', distanceKm: 70 },
      ]),
    ).toMatchObject({ reason: 'missing_start' });
  });

  it('refuse deux départs ou deux arrivées', () => {
    expect(
      checkWaypointChain([
        { waypointType: 'start', distanceKm: 0 },
        { waypointType: 'start', distanceKm: 10 },
        { waypointType: 'finish', distanceKm: 70 },
      ]),
    ).toMatchObject({ reason: 'duplicate_start' });

    expect(
      checkWaypointChain([
        { waypointType: 'start', distanceKm: 0 },
        { waypointType: 'finish', distanceKm: 10 },
        { waypointType: 'finish', distanceKm: 70 },
      ]),
    ).toMatchObject({ reason: 'duplicate_finish' });
  });
});

describe('autorisation', () => {
  it('autorise l’éditeur de l’organisation gestionnaire', async () => {
    const result = await setRaceWaypoints(contextFor(EDITOR_A), chain());

    expect(result.waypointCount).toBe(4);
  });

  it('autorise l’admin de l’organisation et l’admin plateforme', async () => {
    await expect(setRaceWaypoints(contextFor(ADMIN_A), chain())).resolves.toBeDefined();
    await expect(setRaceWaypoints(contextFor(PLUKA_ADMIN), chain())).resolves.toBeDefined();
  });

  it('refuse un viewer : lire n’est pas modifier le parcours', async () => {
    await expectDomainError(setRaceWaypoints(contextFor(VIEWER_A), chain()), 'forbidden');
  });

  it('refuse une autre organisation, et un inconnu', async () => {
    await expectDomainError(setRaceWaypoints(contextFor(OWNER_B), chain()), 'forbidden');
    await expectDomainError(setRaceWaypoints(contextFor(OUTSIDER), chain()), 'forbidden');
  });

  it('réserve une épreuve sans organisation à `pluka_admin` — §4.1', async () => {
    const orphan = { ...chain(), raceId: ORPHAN_RACE_ID };

    await expectDomainError(setRaceWaypoints(contextFor(EDITOR_A), orphan), 'forbidden');
    await expect(setRaceWaypoints(contextFor(PLUKA_ADMIN), orphan)).resolves.toBeDefined();
  });

  it('n’écrit rien quand l’autorité manque', async () => {
    await expectDomainError(setRaceWaypoints(contextFor(VIEWER_A), chain()), 'forbidden');

    expect(state.waypoints).toEqual([]);
  });

  it('demande la même autorité pour lire le référentiel', async () => {
    await expectDomainError(
      getRaceWaypoints(contextFor(VIEWER_A), { raceId: RACE_ID }),
      'forbidden',
    );
  });
});

describe('refus nommés', () => {
  it('rattache un kilomètre fautif à sa ligne', async () => {
    // L'indice permet à l'écran de poser le message contre le bon point
    // plutôt qu'au bas du formulaire.
    const error = await expectDomainError(
      setRaceWaypoints(
        contextFor(EDITOR_A),
        chain([
          { name: 'Départ', waypointType: 'start', distanceKm: 0 },
          { name: 'Ravito', waypointType: 'aid_station', distanceKm: 40 },
          { name: 'Arrivée', waypointType: 'finish', distanceKm: 30 },
        ]),
      ),
      'validation',
    );

    expect(error.details['waypoints.2.distanceKm']).toBeDefined();
  });

  it('nomme le formulaire entier quand la règle ne désigne aucune ligne', async () => {
    const error = await expectDomainError(
      setRaceWaypoints(
        contextFor(EDITOR_A),
        chain([
          { name: 'Départ', waypointType: 'start', distanceKm: 0 },
          { name: 'Ravito', waypointType: 'aid_station', distanceKm: 40 },
        ]),
      ),
      'validation',
    );

    expect(error.details['waypoints']).toBeDefined();
  });

  it('refuse une chaîne d’un seul point', async () => {
    const error = await expectDomainError(
      setRaceWaypoints(
        contextFor(EDITOR_A),
        chain([{ name: 'Départ', waypointType: 'start', distanceKm: 0 }]),
      ),
      'validation',
    );

    expect(error.details['waypoints']).toBeDefined();
  });

  it('refuse un type que la saisie ne propose pas', async () => {
    const error = await expectDomainError(
      setRaceWaypoints(
        contextFor(EDITOR_A),
        chain([
          { name: 'Départ', waypointType: 'start', distanceKm: 0 },
          { name: 'Sommet', waypointType: 'summit', distanceKm: 40 },
          { name: 'Arrivée', waypointType: 'finish', distanceKm: 70 },
        ]),
      ),
      'validation',
    );

    expect(error.details['waypoints.1.waypointType']).toBeDefined();
  });

  it('refuse une barrière sans décalage horaire', async () => {
    // Un instant sans fuseau ne désigne pas un moment : la barrière d'un ultra
    // se compare à une heure réelle.
    const error = await expectDomainError(
      setRaceWaypoints(
        contextFor(EDITOR_A),
        chain([
          { name: 'Départ', waypointType: 'start', distanceKm: 0 },
          {
            name: 'Ravito',
            waypointType: 'aid_station',
            distanceKm: 40,
            cutoffAt: '2026-06-20T11:00:00',
          },
          { name: 'Arrivée', waypointType: 'finish', distanceKm: 70 },
        ]),
      ),
      'validation',
    );

    expect(error.details['waypoints.1.cutoffAt']).toBeDefined();
  });
});

describe('réécriture de la chaîne', () => {
  it('range les points dans l’ordre du tableau', async () => {
    await setRaceWaypoints(contextFor(EDITOR_A), chain());

    const saved = await getRaceWaypoints(contextFor(EDITOR_A), { raceId: RACE_ID });

    expect(saved.map((waypoint) => waypoint.name)).toEqual([
      'Départ',
      'Ravito 1',
      'Base de vie',
      'Arrivée',
    ]);
    expect(saved.map((waypoint) => waypoint.sortOrder)).toEqual([1, 2, 3, 4]);
  });

  it('conserve l’identité d’un point réordonné', async () => {
    await setRaceWaypoints(contextFor(EDITOR_A), chain());
    const before = await getRaceWaypoints(contextFor(EDITOR_A), { raceId: RACE_ID });
    const ravito = before[1];

    // Le même point, déplacé plus loin : son identité doit survivre, sinon les
    // sacs et l'assistance qui le référencent tomberaient.
    await setRaceWaypoints(contextFor(EDITOR_A), {
      raceId: RACE_ID,
      waypoints: [
        { id: before[0]?.id, name: 'Départ', waypointType: 'start', distanceKm: 0 },
        { id: ravito?.id, name: 'Ravito 1', waypointType: 'aid_station', distanceKm: 50 },
        { id: before[3]?.id, name: 'Arrivée', waypointType: 'finish', distanceKm: 70 },
      ],
    });

    const after = await getRaceWaypoints(contextFor(EDITOR_A), { raceId: RACE_ID });

    expect(after).toHaveLength(3);
    expect(after[1]?.id).toBe(ravito?.id);
    expect(after[1]?.distanceKm).toBe(50);
  });

  it('retire les points absents de la nouvelle chaîne', async () => {
    await setRaceWaypoints(contextFor(EDITOR_A), chain());
    await setRaceWaypoints(
      contextFor(EDITOR_A),
      chain([
        { name: 'Départ', waypointType: 'start', distanceKm: 0 },
        { name: 'Arrivée', waypointType: 'finish', distanceKm: 70 },
      ]),
    );

    const saved = await getRaceWaypoints(contextFor(EDITOR_A), { raceId: RACE_ID });

    expect(saved.map((waypoint) => waypoint.name)).toEqual(['Départ', 'Arrivée']);
  });

  it('porte la barrière horaire jusqu’au point', async () => {
    await setRaceWaypoints(
      contextFor(EDITOR_A),
      chain([
        { name: 'Départ', waypointType: 'start', distanceKm: 0 },
        {
          name: 'Ravito',
          waypointType: 'aid_station',
          distanceKm: 40,
          cutoffAt: '2026-06-20T11:00:00Z',
        },
        { name: 'Arrivée', waypointType: 'finish', distanceKm: 70 },
      ]),
    );

    const saved = await getRaceWaypoints(contextFor(EDITOR_A), { raceId: RACE_ID });

    expect(saved[1]?.cutoffAt).toBe('2026-06-20T11:00:00Z');
    expect(saved[0]?.cutoffAt).toBeNull();
  });

  it('retire une barrière qu’on efface', async () => {
    const withCutoff = chain([
      { name: 'Départ', waypointType: 'start', distanceKm: 0 },
      {
        name: 'Ravito',
        waypointType: 'aid_station',
        distanceKm: 40,
        cutoffAt: '2026-06-20T11:00:00Z',
      },
      { name: 'Arrivée', waypointType: 'finish', distanceKm: 70 },
    ]);

    await setRaceWaypoints(contextFor(EDITOR_A), withCutoff);
    await setRaceWaypoints(
      contextFor(EDITOR_A),
      chain([
        { name: 'Départ', waypointType: 'start', distanceKm: 0 },
        { name: 'Ravito', waypointType: 'aid_station', distanceKm: 40 },
        { name: 'Arrivée', waypointType: 'finish', distanceKm: 70 },
      ]),
    );

    const saved = await getRaceWaypoints(contextFor(EDITOR_A), { raceId: RACE_ID });

    expect(saved[1]?.cutoffAt).toBeNull();
  });
});
