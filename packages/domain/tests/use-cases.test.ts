import { beforeEach, describe, expect, it } from 'vitest';

import {
  createEdition,
  createEvent,
  createRace,
  DomainError,
  getRaceOverview,
  setRaceVisibility,
  updateRace,
  type CourseContext,
} from '../src/index.js';
import {
  baseState,
  createFakeRepositories,
  EDITION_ID,
  EDITOR_A,
  EVENT_ID,
  ORG_A,
  OUTSIDER,
  OWNER_B,
  PLUKA_ADMIN,
  RACE_ID,
  VIEWER_A,
  type FakeState,
} from './fixtures/repositories.js';

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

function validRaceCommand(overrides: Record<string, unknown> = {}) {
  return {
    editionId: EDITION_ID,
    name: '20K',
    slug: '20k',
    distanceKm: 20,
    startDatetime: '2026-06-20T06:00:00Z',
    timezone: 'Europe/Paris',
    ...overrides,
  };
}

beforeEach(() => {
  state = baseState();
});

describe('autorisation', () => {
  it('refuse un utilisateur hors de l’organisation', async () => {
    await expectDomainError(createRace(contextFor(OUTSIDER), validRaceCommand()), 'forbidden');
  });

  it('refuse une autre organisation', async () => {
    await expectDomainError(createRace(contextFor(OWNER_B), validRaceCommand()), 'forbidden');
  });

  it('refuse un viewer : lire n’est pas gérer', async () => {
    await expectDomainError(createRace(contextFor(VIEWER_A), validRaceCommand()), 'forbidden');
  });

  it('autorise un editor', async () => {
    const race = await createRace(contextFor(EDITOR_A), validRaceCommand());

    expect(race.slug).toBe('20k');
  });

  it('autorise l’admin plateforme sur la base courses', async () => {
    const race = await createRace(contextFor(PLUKA_ADMIN), validRaceCommand());

    expect(race.name).toBe('20K');
  });

  it('ne révèle rien de plus qu’un refus', async () => {
    // Préciser le rôle manquant confirmerait l'existence de l'objet visé.
    const error = await expectDomainError(
      createRace(contextFor(OUTSIDER), validRaceCommand()),
      'forbidden',
    );

    expect(error.message).not.toContain(ORG_A);
    expect(error.message).not.toContain(EDITION_ID);
  });

  it('ne lit jamais un rôle fourni par l’appelant', async () => {
    // La commande porte un rôle inventé : il est ignoré, l'autorité vient de
    // la base (03_PRIVACY_RLS §11).
    await expectDomainError(
      createRace(
        contextFor(OUTSIDER),
        validRaceCommand({ role: 'owner', platformRole: 'pluka_admin' }),
      ),
      'forbidden',
    );
  });
});

describe('createEvent', () => {
  it('crée un événement pour son organisation', async () => {
    const event = await createEvent(contextFor(EDITOR_A), {
      organizationId: ORG_A,
      name: 'Nouveau Trail',
      slug: 'nouveau-trail',
    });

    expect(event.organizationId).toBe(ORG_A);
  });

  it('refuse un slug déjà pris', async () => {
    await expectDomainError(
      createEvent(contextFor(EDITOR_A), {
        organizationId: ORG_A,
        name: 'Doublon',
        slug: 'trail-de-test',
      }),
      'conflict',
    );
  });

  it('réserve l’événement sans organisation à l’admin plateforme', async () => {
    // §4.1 : seul `pluka_admin` administre un événement sans organisation.
    await expectDomainError(
      createEvent(contextFor(EDITOR_A), {
        organizationId: null,
        name: 'Communautaire',
        slug: 'communautaire',
      }),
      'forbidden',
    );

    const event = await createEvent(contextFor(PLUKA_ADMIN), {
      organizationId: null,
      name: 'Communautaire',
      slug: 'communautaire',
    });

    expect(event.organizationId).toBeNull();
  });

  it('refuse un slug mal formé', async () => {
    await expect(
      createEvent(contextFor(EDITOR_A), {
        organizationId: ORG_A,
        name: 'X',
        slug: 'Slug Invalide',
      }),
    ).rejects.toThrow();
  });
});

describe('createEdition', () => {
  it('refuse une seconde édition pour la même année', async () => {
    // 02_DATA_MODEL §6.2 : une seule édition par couple (event, year).
    await expectDomainError(
      createEdition(contextFor(EDITOR_A), {
        eventId: EVENT_ID,
        year: 2026,
        slug: 'trail-de-test-2026-bis',
        startDate: '2026-07-01',
      }),
      'conflict',
    );
  });

  it('accepte une autre année', async () => {
    const edition = await createEdition(contextFor(EDITOR_A), {
      eventId: EVENT_ID,
      year: 2027,
      slug: 'trail-de-test-2027',
      startDate: '2027-06-19',
    });

    expect(edition.year).toBe(2027);
  });

  it('refuse un événement inconnu', async () => {
    await expectDomainError(
      createEdition(contextFor(EDITOR_A), {
        eventId: '99999999-9999-4999-8999-999999999999',
        year: 2027,
        slug: 'x',
        startDate: '2027-01-01',
      }),
      'not_found',
    );
  });
});

describe('createRace', () => {
  it('refuse un slug déjà utilisé sur l’édition', async () => {
    await expectDomainError(
      createRace(contextFor(EDITOR_A), validRaceCommand({ slug: '80k' })),
      'conflict',
    );
  });

  it('refuse une barrière antérieure au départ', async () => {
    const error = await expectDomainError(
      createRace(
        contextFor(EDITOR_A),
        validRaceCommand({
          startDatetime: '2026-06-20T06:00:00Z',
          cutoffDatetime: '2026-06-20T05:00:00Z',
        }),
      ),
      'validation',
    );

    expect(error.details.raison).toBe('cutoff_before_start');
  });

  it('refuse une timezone inconnue', async () => {
    // 02_DATA_MODEL §6.4 : la timezone IANA est structurante — un ultra
    // multi-jour interdit de raisonner en durée seule.
    const error = await expectDomainError(
      createRace(contextFor(EDITOR_A), validRaceCommand({ timezone: 'Europe/Atlantide' })),
      'validation',
    );

    expect(error.details.raison).toBe('timezone_unknown');
  });

  it('naît en brouillon et en visibilité privée', async () => {
    const race = await createRace(contextFor(EDITOR_A), validRaceCommand());

    expect(race.status).toBe('draft');
    expect(race.publicVisibility).toBe('private');
  });
});

describe('updateRace', () => {
  it('modifie les champs fournis', async () => {
    const race = await updateRace(contextFor(EDITOR_A), { raceId: RACE_ID, name: '82K' });

    expect(race.name).toBe('82K');
  });

  it('valide l’état résultant, pas seulement le patch', async () => {
    // Ne changer que la barrière doit rester cohérent avec le départ existant.
    await expectDomainError(
      updateRace(contextFor(EDITOR_A), {
        raceId: RACE_ID,
        cutoffDatetime: '2026-06-20T03:00:00Z',
      }),
      'validation',
    );
  });

  it('refuse une commande vide', async () => {
    await expect(updateRace(contextFor(EDITOR_A), { raceId: RACE_ID })).rejects.toThrow();
  });

  it('ne permet pas de déplacer la course ni de changer son slug', async () => {
    // Ces champs ne sont pas dans le schéma : Zod les ignore, la hiérarchie
    // et l'URL publique restent stables.
    const race = await updateRace(contextFor(EDITOR_A), {
      raceId: RACE_ID,
      name: '82K',
      editionId: '99999999-9999-4999-8999-999999999999',
      slug: 'autre-slug',
    });

    expect(race.editionId).toBe(EDITION_ID);
    expect(race.slug).toBe('80k');
  });
});

describe('setRaceVisibility', () => {
  it('bascule la visibilité', async () => {
    const race = await setRaceVisibility(contextFor(EDITOR_A), {
      raceId: RACE_ID,
      visibility: 'public',
    });

    expect(race.publicVisibility).toBe('public');
  });

  it('refuse un viewer', async () => {
    await expectDomainError(
      setRaceVisibility(contextFor(VIEWER_A), { raceId: RACE_ID, visibility: 'public' }),
      'forbidden',
    );
  });
});

describe('getRaceOverview', () => {
  it('rend la hiérarchie complète au gestionnaire', async () => {
    const overview = await getRaceOverview(contextFor(EDITOR_A), { raceId: RACE_ID });

    expect(overview.race.id).toBe(RACE_ID);
    expect(overview.edition.id).toBe(EDITION_ID);
    expect(overview.event.id).toBe(EVENT_ID);
    expect(overview.publiclyReadable).toBe(false);
  });

  it('répond not_found à un inconnu sur une course non publique', async () => {
    // Répondre « interdit » confirmerait l'existence de la course à partir
    // d'un simple UUID (03_PRIVACY_RLS §120).
    await expectDomainError(
      getRaceOverview(contextFor(OUTSIDER), { raceId: RACE_ID }),
      'not_found',
    );
  });

  it('devient publiquement lisible une fois toute la chaîne diffusée', async () => {
    state.races[0] = { ...state.races[0]!, status: 'published', publicVisibility: 'public' };

    const overview = await getRaceOverview(contextFor(OUTSIDER), { raceId: RACE_ID });

    expect(overview.publiclyReadable).toBe(true);
  });

  it('reste privée si l’édition n’est pas diffusée', async () => {
    // §4.1, invariant 1 : la chaîne entière compte.
    state.races[0] = { ...state.races[0]!, status: 'published', publicVisibility: 'public' };
    state.editions[0] = { ...state.editions[0]!, status: 'draft' };

    await expectDomainError(
      getRaceOverview(contextFor(OUTSIDER), { raceId: RACE_ID }),
      'not_found',
    );
  });

  it('reste privée en visibilité unlisted', async () => {
    // 03_PRIVACY_RLS §17 : `unlisted` s'atteint par lien direct, jamais par
    // une lecture générique.
    state.races[0] = { ...state.races[0]!, status: 'published', publicVisibility: 'unlisted' };

    await expectDomainError(
      getRaceOverview(contextFor(OUTSIDER), { raceId: RACE_ID }),
      'not_found',
    );
  });

  it('garde une course annulée visible', async () => {
    // §4.1 : « Une course annulée reste visible pour tous les coureurs
    // concernés. »
    state.races[0] = { ...state.races[0]!, status: 'cancelled', publicVisibility: 'public' };

    const overview = await getRaceOverview(contextFor(OUTSIDER), { raceId: RACE_ID });

    expect(overview.publiclyReadable).toBe(true);
  });

  it('ne rend jamais un brouillon lisible publiquement', async () => {
    state.races[0] = { ...state.races[0]!, publicVisibility: 'public' };

    await expectDomainError(
      getRaceOverview(contextFor(OUTSIDER), { raceId: RACE_ID }),
      'not_found',
    );
  });
});
