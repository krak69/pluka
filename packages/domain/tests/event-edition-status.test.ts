import { beforeEach, describe, expect, it } from 'vitest';

import {
  allowedEditionTransitions,
  allowedEventTransitions,
  changeEditionStatus,
  changeEventStatus,
  changeRaceStatus,
  DomainError,
  EDITION_TRANSITIONS,
  EVENT_TRANSITIONS,
  getEditionAdministration,
  getEventAdministration,
  type CourseContext,
} from '../src/index.js';
import {
  ADMIN_A,
  baseState,
  createFakeRepositories,
  EDITION_ID,
  EDITOR_A,
  EVENT_ID,
  ORPHAN_EDITION_ID,
  ORPHAN_EVENT_ID,
  OUTSIDER,
  OWNER_B,
  PLUKA_ADMIN,
  RACE_ID,
  VIEWER_A,
  type FakeState,
} from './fixtures/repositories.js';

/**
 * Cycle de vie d'un Event et d'une Edition — 00_PRODUCT_SPEC §4.1.
 *
 * §4.1 ne donne son tableau « qui peut faire quoi » que pour la Race, mais il
 * pose l'invariant qui lie les trois niveaux : « une Race n'est publiquement
 * lisible que si […] son Edition est diffusée, **et** que son Event l'est
 * aussi ». Ces tests vérifient les deux faces de cette dépendance — l'ordre
 * de publication qu'elle impose, et le fait que la chaîne entière soit
 * effectivement publiable.
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

/** Remet toute la chaîne en brouillon : l'état de départ d'une base neuve. */
function draftChain(): void {
  state.events = state.events.map((event) => ({ ...event, status: 'draft' }));
  state.editions = state.editions.map((edition) => ({ ...edition, status: 'draft' }));
}

beforeEach(() => {
  state = baseState();
});

describe('table des transitions d’un Event', () => {
  it('n’ouvre que trois transitions', () => {
    // `record_status` n'a ni `cancelled` ni `completed` : ces statuts
    // qualifient une occurrence datée, pas l'objet récurrent (02_DATA_MODEL §6.1).
    expect(EVENT_TRANSITIONS.map((transition) => `${transition.from}→${transition.to}`)).toEqual([
      'draft→published',
      'published→archived',
      'archived→published',
    ]);
  });

  it('réserve l’archivage à l’admin plateforme, comme §4.1 pour la Race', () => {
    expect(allowedEventTransitions('published')).toEqual([
      { from: 'published', to: 'archived', authority: 'platform_admin' },
    ]);
  });

  it('confie la diffusion à l’éditeur de l’organisation', () => {
    expect(allowedEventTransitions('draft')).toEqual([
      { from: 'draft', to: 'published', authority: 'organization_editor' },
    ]);
  });

  it('n’archive pas un brouillon', () => {
    // Même raison que `draft → cancelled` chez la Race : ce qui n'a jamais
    // circulé ne se retire pas de la circulation.
    expect(
      allowedEventTransitions('draft').some((transition) => transition.to === 'archived'),
    ).toBe(false);
  });
});

describe('table des transitions d’une Edition', () => {
  it('transpose littéralement le tableau de §4.1', () => {
    // `edition_status` porte les cinq mêmes valeurs que `race_status`, et pour
    // cause : une édition est une occurrence datée, comme l'épreuve.
    expect(EDITION_TRANSITIONS.map((transition) => `${transition.from}→${transition.to}`)).toEqual([
      'draft→published',
      'published→cancelled',
      'published→completed',
      'completed→archived',
      'cancelled→archived',
      'archived→completed',
      'archived→cancelled',
    ]);
  });

  it('demande le rang `admin` pour annuler, comme la Race', () => {
    expect(allowedEditionTransitions('published')).toContainEqual({
      from: 'published',
      to: 'cancelled',
      authority: 'organization_admin',
    });
  });

  it('réserve `completed` à l’admin plateforme', () => {
    expect(allowedEditionTransitions('published')).toContainEqual({
      from: 'published',
      to: 'completed',
      authority: 'platform_admin',
    });
  });
});

describe('changeEventStatus — autorisations', () => {
  beforeEach(draftChain);

  it('autorise l’éditeur de l’organisation gestionnaire à publier', async () => {
    const event = await changeEventStatus(contextFor(EDITOR_A), {
      eventId: EVENT_ID,
      status: 'published',
    });

    expect(event.status).toBe('published');
  });

  it('autorise l’admin plateforme', async () => {
    const event = await changeEventStatus(contextFor(PLUKA_ADMIN), {
      eventId: EVENT_ID,
      status: 'published',
    });

    expect(event.status).toBe('published');
  });

  it('refuse un viewer : lire n’est pas gérer', async () => {
    await expectDomainError(
      changeEventStatus(contextFor(VIEWER_A), { eventId: EVENT_ID, status: 'published' }),
      'forbidden',
    );
  });

  it('refuse une autre organisation', async () => {
    await expectDomainError(
      changeEventStatus(contextFor(OWNER_B), { eventId: EVENT_ID, status: 'published' }),
      'forbidden',
    );
  });

  it('refuse un inconnu sans rien lui apprendre de l’état', async () => {
    // Le périmètre est vérifié avant la transition : un `invalid_state` ici
    // renseignerait sur le statut d'un événement invisible (§120).
    const error = await expectDomainError(
      changeEventStatus(contextFor(OUTSIDER), { eventId: EVENT_ID, status: 'archived' }),
      'forbidden',
    );

    expect(error.message).not.toContain('draft');
  });

  it('réserve un événement sans organisation à `pluka_admin` — §4.1', async () => {
    await expectDomainError(
      changeEventStatus(contextFor(EDITOR_A), { eventId: ORPHAN_EVENT_ID, status: 'published' }),
      'forbidden',
    );

    const event = await changeEventStatus(contextFor(PLUKA_ADMIN), {
      eventId: ORPHAN_EVENT_ID,
      status: 'published',
    });

    expect(event.status).toBe('published');
  });

  it('refuse l’archivage à l’éditeur', async () => {
    await changeEventStatus(contextFor(EDITOR_A), { eventId: EVENT_ID, status: 'published' });

    await expectDomainError(
      changeEventStatus(contextFor(EDITOR_A), { eventId: EVENT_ID, status: 'archived' }),
      'forbidden',
    );
  });
});

describe('changeEventStatus — transitions refusées', () => {
  beforeEach(draftChain);

  it('refuse une transition absente de la table', async () => {
    const error = await expectDomainError(
      changeEventStatus(contextFor(PLUKA_ADMIN), { eventId: EVENT_ID, status: 'archived' }),
      'invalid_state',
    );

    expect(error.message).toContain('draft → archived');
  });

  it('nomme le champ fautif quand le statut n’existe pas pour un événement', async () => {
    // `completed` appartient au cycle d'une Edition ou d'une Race, pas d'un
    // Event : c'est une erreur de saisie, pas une transition illégale.
    const error = await expectDomainError(
      changeEventStatus(contextFor(PLUKA_ADMIN), { eventId: EVENT_ID, status: 'completed' }),
      'validation',
    );

    expect(error.details['status']).toBeDefined();
  });

  it('refuse un événement inexistant', async () => {
    await expectDomainError(
      changeEventStatus(contextFor(PLUKA_ADMIN), {
        eventId: 'aaaaaaaa-0000-4000-8000-00000000ffff',
        status: 'published',
      }),
      'not_found',
    );
  });
});

describe('changeEventStatus — journal et désarchivage', () => {
  beforeEach(draftChain);

  it('journalise qui vient d’où — §4.1', async () => {
    await changeEventStatus(contextFor(EDITOR_A), { eventId: EVENT_ID, status: 'published' });

    const { history } = await getEventAdministration(contextFor(PLUKA_ADMIN), {
      eventId: EVENT_ID,
    });

    expect(history).toHaveLength(1);
    expect(history[0]?.fromStatus).toBe('draft');
    expect(history[0]?.toStatus).toBe('published');
  });

  it('ramène un événement archivé à son statut antérieur', async () => {
    await changeEventStatus(contextFor(EDITOR_A), { eventId: EVENT_ID, status: 'published' });
    await changeEventStatus(contextFor(PLUKA_ADMIN), { eventId: EVENT_ID, status: 'archived' });

    const event = await changeEventStatus(contextFor(PLUKA_ADMIN), {
      eventId: EVENT_ID,
      status: 'published',
    });

    expect(event.status).toBe('published');
  });

  it('refuse un désarchivage que le journal ne porte pas', async () => {
    // État incohérent : archivé sans trace. Refuser vaut mieux que deviner.
    state.events[0] = { ...state.events[0]!, status: 'archived' };

    const error = await expectDomainError(
      changeEventStatus(contextFor(PLUKA_ADMIN), { eventId: EVENT_ID, status: 'published' }),
      'invalid_state',
    );

    expect(error.message).toContain('journal');
  });
});

describe('changeEditionStatus — ordre de publication', () => {
  beforeEach(draftChain);

  it('refuse de diffuser une édition sous un événement en brouillon', async () => {
    const error = await expectDomainError(
      changeEditionStatus(contextFor(EDITOR_A), { editionId: EDITION_ID, status: 'published' }),
      'invalid_state',
    );

    expect(error.message).toContain('événement doit être publié');
  });

  it('l’accepte dès que l’événement est publié', async () => {
    await changeEventStatus(contextFor(EDITOR_A), { eventId: EVENT_ID, status: 'published' });

    const edition = await changeEditionStatus(contextFor(EDITOR_A), {
      editionId: EDITION_ID,
      status: 'published',
    });

    expect(edition.status).toBe('published');
  });

  it('rend la chaîne entière publiable depuis le brouillon', async () => {
    // La régression visée : sans transition sur l'Event et l'Edition, aucune
    // épreuve ne pouvait plus être publiée depuis une base neuve.
    await changeEventStatus(contextFor(EDITOR_A), { eventId: EVENT_ID, status: 'published' });
    await changeEditionStatus(contextFor(EDITOR_A), {
      editionId: EDITION_ID,
      status: 'published',
    });

    const race = await changeRaceStatus(contextFor(EDITOR_A), {
      raceId: RACE_ID,
      status: 'published',
    });

    expect(race.status).toBe('published');
  });
});

describe('changeEditionStatus — autorisations et cycle', () => {
  it('demande le rang `admin` pour annuler', async () => {
    await expectDomainError(
      changeEditionStatus(contextFor(EDITOR_A), { editionId: EDITION_ID, status: 'cancelled' }),
      'forbidden',
    );

    const edition = await changeEditionStatus(contextFor(ADMIN_A), {
      editionId: EDITION_ID,
      status: 'cancelled',
    });

    expect(edition.status).toBe('cancelled');
  });

  it('réserve `completed` à l’admin plateforme', async () => {
    await expectDomainError(
      changeEditionStatus(contextFor(ADMIN_A), { editionId: EDITION_ID, status: 'completed' }),
      'forbidden',
    );

    const edition = await changeEditionStatus(contextFor(PLUKA_ADMIN), {
      editionId: EDITION_ID,
      status: 'completed',
    });

    expect(edition.status).toBe('completed');
  });

  it('réserve une édition sans organisation à `pluka_admin`', async () => {
    await expectDomainError(
      changeEditionStatus(contextFor(ADMIN_A), {
        editionId: ORPHAN_EDITION_ID,
        status: 'cancelled',
      }),
      'forbidden',
    );
  });

  it('refuse une transition absente de la table', async () => {
    const error = await expectDomainError(
      changeEditionStatus(contextFor(PLUKA_ADMIN), {
        editionId: EDITION_ID,
        status: 'archived',
      }),
      'invalid_state',
    );

    expect(error.message).toContain('published → archived');
  });

  it('journalise la transition et la rend avec l’édition', async () => {
    await changeEditionStatus(contextFor(ADMIN_A), {
      editionId: EDITION_ID,
      status: 'cancelled',
    });

    const { history } = await getEditionAdministration(contextFor(PLUKA_ADMIN), {
      editionId: EDITION_ID,
    });

    expect(history).toHaveLength(1);
    expect(history[0]?.fromStatus).toBe('published');
    expect(history[0]?.toStatus).toBe('cancelled');
  });

  it('ramène une édition archivée exactement là où elle était', async () => {
    await changeEditionStatus(contextFor(ADMIN_A), {
      editionId: EDITION_ID,
      status: 'cancelled',
    });
    await changeEditionStatus(contextFor(PLUKA_ADMIN), {
      editionId: EDITION_ID,
      status: 'archived',
    });

    // Le journal dit `cancelled` : `completed` réécrirait l'histoire.
    const error = await expectDomainError(
      changeEditionStatus(contextFor(PLUKA_ADMIN), {
        editionId: EDITION_ID,
        status: 'completed',
      }),
      'invalid_state',
    );
    expect(error.message).toContain('ramène à cancelled');

    const edition = await changeEditionStatus(contextFor(PLUKA_ADMIN), {
      editionId: EDITION_ID,
      status: 'cancelled',
    });
    expect(edition.status).toBe('cancelled');
  });
});

describe('concurrence', () => {
  it('refuse la seconde de deux transitions parties du même état lu', async () => {
    // Le compare-and-set de `events.changeStatus` : deux administrateurs
    // lisent `draft`, trouvent tous deux la transition valide, et un seul doit
    // écrire. Le second obtient un `conflict`, pas un second changement.
    draftChain();
    const context = contextFor(PLUKA_ADMIN);
    const command = { eventId: EVENT_ID, status: 'published' } as const;

    const [first, second] = await Promise.allSettled([
      changeEventStatus(context, command),
      changeEventStatus(context, command),
    ]);

    expect([first.status, second.status].sort()).toEqual(['fulfilled', 'rejected']);

    const refused =
      first.status === 'rejected' ? first.reason : (second as PromiseRejectedResult).reason;
    expect(refused).toBeInstanceOf(DomainError);
    expect((refused as DomainError).code).toBe('conflict');
  });
});
