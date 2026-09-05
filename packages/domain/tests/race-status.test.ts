import { beforeEach, describe, expect, it } from 'vitest';

import {
  changeRaceStatus,
  DomainError,
  listRaceStatusHistory,
  publishRace,
  type CourseContext,
} from '../src/index.js';
import {
  ADMIN_A,
  baseState,
  createFakeRepositories,
  EDITOR_A,
  ORPHAN_RACE_ID,
  OUTSIDER,
  OWNER_A,
  OWNER_B,
  PLUKA_ADMIN,
  RACE_ID,
  VIEWER_A,
  type FakeState,
} from './fixtures/repositories.js';

/**
 * Le cycle de vie de §4.1, exécuté de bout en bout.
 *
 * `lifecycle.test.ts` vérifie la table ; ce fichier vérifie ce que le use
 * case en fait — autorisations relues en base, invariants de chaîne, journal,
 * concurrence.
 */

let state: FakeState;

function contextFor(userId: string): CourseContext {
  return { repositories: createFakeRepositories(state), actor: { userId } };
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

/** Amène la course de test jusqu'au statut voulu, en passant par les transitions légales. */
async function driveTo(
  status: 'published' | 'cancelled' | 'completed' | 'archived',
): Promise<void> {
  await changeRaceStatus(contextFor(EDITOR_A), { raceId: RACE_ID, status: 'published' });
  if (status === 'published') return;

  if (status === 'cancelled') {
    await changeRaceStatus(contextFor(ADMIN_A), { raceId: RACE_ID, status: 'cancelled' });
    return;
  }

  await changeRaceStatus(contextFor(PLUKA_ADMIN), { raceId: RACE_ID, status: 'completed' });
  if (status === 'completed') return;

  await changeRaceStatus(contextFor(PLUKA_ADMIN), { raceId: RACE_ID, status: 'archived' });
}

beforeEach(() => {
  state = baseState();
});

describe('draft → published', () => {
  it('autorise l’éditeur de l’organisation gestionnaire', async () => {
    const race = await publishRace(contextFor(EDITOR_A), { raceId: RACE_ID });

    expect(race.status).toBe('published');
  });

  it('autorise l’admin plateforme', async () => {
    const race = await publishRace(contextFor(PLUKA_ADMIN), { raceId: RACE_ID });

    expect(race.status).toBe('published');
  });

  it('refuse un viewer : lire n’est pas gérer', async () => {
    await expectDomainError(publishRace(contextFor(VIEWER_A), { raceId: RACE_ID }), 'forbidden');
  });

  it('refuse une autre organisation', async () => {
    await expectDomainError(publishRace(contextFor(OWNER_B), { raceId: RACE_ID }), 'forbidden');
  });

  it('refuse un inconnu', async () => {
    await expectDomainError(publishRace(contextFor(OUTSIDER), { raceId: RACE_ID }), 'forbidden');
  });

  it('refuse si l’édition n’est pas diffusée', async () => {
    // §4.1, invariant 1 : la lisibilité remonte toute la chaîne. Publier sous
    // une édition en brouillon produirait une course inatteignable.
    state.editions[0] = { ...state.editions[0]!, status: 'draft' };

    const error = await expectDomainError(
      publishRace(contextFor(EDITOR_A), { raceId: RACE_ID }),
      'invalid_state',
    );

    expect(error.message).toContain('édition');
  });

  it('refuse si l’événement n’est pas publié', async () => {
    state.events[0] = { ...state.events[0]!, status: 'draft' };

    const error = await expectDomainError(
      publishRace(contextFor(EDITOR_A), { raceId: RACE_ID }),
      'invalid_state',
    );

    expect(error.message).toContain('événement');
  });

  it('refuse de republier une course déjà publiée', async () => {
    await driveTo('published');

    await expectDomainError(
      publishRace(contextFor(EDITOR_A), { raceId: RACE_ID }),
      'invalid_state',
    );
  });
});

describe('published → cancelled', () => {
  beforeEach(async () => {
    await driveTo('published');
  });

  it('autorise l’admin de l’organisation', async () => {
    const race = await changeRaceStatus(contextFor(ADMIN_A), {
      raceId: RACE_ID,
      status: 'cancelled',
    });

    expect(race.status).toBe('cancelled');
  });

  it('autorise l’owner, qui dépasse le rang admin', async () => {
    const race = await changeRaceStatus(contextFor(OWNER_A), {
      raceId: RACE_ID,
      status: 'cancelled',
    });

    expect(race.status).toBe('cancelled');
  });

  it('refuse l’éditeur : publier n’est pas annuler', async () => {
    // §4.1 distingue les deux rangs. L'ordre de l'enum PostgreSQL les
    // classerait à l'envers.
    await expectDomainError(
      changeRaceStatus(contextFor(EDITOR_A), { raceId: RACE_ID, status: 'cancelled' }),
      'forbidden',
    );
  });

  it('reste possible après la date de départ', async () => {
    // §4.1 : « une course peut être annulée sur place le jour J ». Aucune
    // horloge n'entre dans la décision — la course de la fixture est datée
    // 2026, et le test ne dépend pas de la date d'exécution.
    const race = await changeRaceStatus(contextFor(ADMIN_A), {
      raceId: RACE_ID,
      status: 'cancelled',
    });

    expect(race.status).toBe('cancelled');
  });
});

describe('transitions réservées à pluka_admin', () => {
  it('published → completed refuse l’owner de l’organisation', async () => {
    await driveTo('published');

    await expectDomainError(
      changeRaceStatus(contextFor(OWNER_A), { raceId: RACE_ID, status: 'completed' }),
      'forbidden',
    );
  });

  it('published → completed autorise l’admin plateforme', async () => {
    await driveTo('published');

    const race = await changeRaceStatus(contextFor(PLUKA_ADMIN), {
      raceId: RACE_ID,
      status: 'completed',
    });

    expect(race.status).toBe('completed');
  });

  it('completed → archived refuse l’owner de l’organisation', async () => {
    await driveTo('completed');

    await expectDomainError(
      changeRaceStatus(contextFor(OWNER_A), { raceId: RACE_ID, status: 'archived' }),
      'forbidden',
    );
  });

  it('cancelled → archived autorise l’admin plateforme', async () => {
    await driveTo('cancelled');

    const race = await changeRaceStatus(contextFor(PLUKA_ADMIN), {
      raceId: RACE_ID,
      status: 'archived',
    });

    expect(race.status).toBe('archived');
  });
});

describe('transitions interdites', () => {
  it('refuse draft → completed avec invalid_state', async () => {
    // §4.1 : « toute autre est refusée avec `invalid_state` ». Le code
    // distingue une transition impossible d'un droit manquant.
    await expectDomainError(
      changeRaceStatus(contextFor(PLUKA_ADMIN), { raceId: RACE_ID, status: 'completed' }),
      'invalid_state',
    );
  });

  it('refuse draft → cancelled', async () => {
    await expectDomainError(
      changeRaceStatus(contextFor(PLUKA_ADMIN), { raceId: RACE_ID, status: 'cancelled' }),
      'invalid_state',
    );
  });

  it('refuse published → archived', async () => {
    await driveTo('published');

    await expectDomainError(
      changeRaceStatus(contextFor(PLUKA_ADMIN), { raceId: RACE_ID, status: 'archived' }),
      'invalid_state',
    );
  });

  it('refuse un retour en brouillon', async () => {
    await driveTo('published');

    await expectDomainError(
      changeRaceStatus(contextFor(PLUKA_ADMIN), { raceId: RACE_ID, status: 'draft' }),
      'invalid_state',
    );
  });

  it('ne révèle pas le statut à un inconnu', async () => {
    // Un extérieur reçoit `forbidden` avant toute évaluation de la
    // transition : sinon le code d'erreur lui apprendrait dans quel état est
    // une course qu'il n'a pas le droit de voir.
    await expectDomainError(
      changeRaceStatus(contextFor(OUTSIDER), { raceId: RACE_ID, status: 'completed' }),
      'forbidden',
    );
  });
});

describe('désarchivage', () => {
  it('ramène au statut antérieur à l’archivage', async () => {
    await driveTo('completed');
    await changeRaceStatus(contextFor(PLUKA_ADMIN), { raceId: RACE_ID, status: 'archived' });

    const race = await changeRaceStatus(contextFor(PLUKA_ADMIN), {
      raceId: RACE_ID,
      status: 'completed',
    });

    expect(race.status).toBe('completed');
  });

  it('refuse un autre statut que celui d’avant l’archivage', async () => {
    // §4.1 : « retour au statut antérieur à l'archivage ». Une course
    // archivée depuis `completed` ne peut pas ressortir en `cancelled` — elle
    // a bien eu lieu.
    await driveTo('archived');

    const error = await expectDomainError(
      changeRaceStatus(contextFor(PLUKA_ADMIN), { raceId: RACE_ID, status: 'cancelled' }),
      'invalid_state',
    );

    expect(error.message).toContain('completed');
  });

  it('ramène bien une course annulée en cancelled', async () => {
    await driveTo('cancelled');
    await changeRaceStatus(contextFor(PLUKA_ADMIN), { raceId: RACE_ID, status: 'archived' });

    const race = await changeRaceStatus(contextFor(PLUKA_ADMIN), {
      raceId: RACE_ID,
      status: 'cancelled',
    });

    expect(race.status).toBe('cancelled');
  });

  it('refuse quand le journal ne porte aucun archivage', async () => {
    // Course archivée hors journal — un import, une reprise de données.
    // Deviner le statut antérieur serait pire que refuser.
    state.races[0] = { ...state.races[0]!, status: 'archived' };

    await expectDomainError(
      changeRaceStatus(contextFor(PLUKA_ADMIN), { raceId: RACE_ID, status: 'completed' }),
      'invalid_state',
    );
  });
});

describe('journal', () => {
  it('enregistre chaque transition avec son statut de départ', async () => {
    await driveTo('completed');

    const history = await listRaceStatusHistory(contextFor(OWNER_A), { raceId: RACE_ID });

    expect(history.map((entry) => [entry.fromStatus, entry.toStatus])).toEqual([
      ['published', 'completed'],
      ['draft', 'published'],
    ]);
  });

  it('reste lisible par l’organisation gestionnaire', async () => {
    await driveTo('published');

    await expect(
      listRaceStatusHistory(contextFor(VIEWER_A), { raceId: RACE_ID }),
    ).resolves.toHaveLength(1);
  });

  it('n’est pas exposé hors de l’organisation', async () => {
    // §4.1 : le coureur voit « Annulée », pas qui l'a décidé.
    await driveTo('published');

    await expectDomainError(
      listRaceStatusHistory(contextFor(OUTSIDER), { raceId: RACE_ID }),
      'not_found',
    );
  });
});

describe('événement sans organisation gestionnaire', () => {
  it('n’est administrable que par pluka_admin', async () => {
    // §4.1 : « Un événement sans organisation gestionnaire n'est
    // administrable que par `pluka_admin`. »
    const race = await publishRace(contextFor(PLUKA_ADMIN), { raceId: ORPHAN_RACE_ID });

    expect(race.status).toBe('published');
  });

  it('échappe à toute organisation, fût-elle owner ailleurs', async () => {
    await expectDomainError(
      publishRace(contextFor(OWNER_A), { raceId: ORPHAN_RACE_ID }),
      'forbidden',
    );
  });
});

describe('concurrence', () => {
  it('refuse au niveau du repository une écriture sur un statut périmé', async () => {
    // Deux administrateurs partent du même état ; le second doit échouer
    // plutôt qu'enchaîner une transition depuis un statut qu'il n'a pas lu.
    await driveTo('published');

    const first = contextFor(PLUKA_ADMIN);
    const scopeRead = createFakeRepositories(state);

    // Le second contexte a lu l'état avant la transition du premier.
    await changeRaceStatus(first, { raceId: RACE_ID, status: 'completed' });

    const stale = await scopeRead.races.changeStatus(RACE_ID, 'published', 'cancelled');

    expect(stale).toBeNull();
  });
});
