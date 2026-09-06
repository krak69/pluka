import { beforeEach, describe, expect, it } from 'vitest';

import {
  checkRaceAttachment,
  claimParticipantRace,
  createParticipantRace,
  DomainError,
  getParticipation,
  getParticipationForRace,
  isRaceReachableByRunner,
  listRaceRoster,
  PREPARATION_STATES,
  RUNNER_PARTICIPATION_STATUSES,
  setParticipationStatus,
  setPreparationState,
  setRaceGoal,
  type ParticipationContext,
} from '../src/index.js';
import {
  CANCELLED_RACE,
  COMPLETED_RACE,
  createFakeParticipationRepositories,
  DRAFT_RACE,
  FIXED_NOW,
  participationBaseState,
  PRIVATE_RACE,
  PUBLIC_RACE,
  RUNNER_A,
  RUNNER_B,
  seedParticipation,
  UNLISTED_RACE,
  type ParticipationState,
} from './fixtures/participation-repositories.js';
import {
  EDITION_ID,
  ORG_A,
  OUTSIDER,
  PLUKA_ADMIN,
  OWNER_B,
  VIEWER_A,
} from './fixtures/repositories.js';

/**
 * Rattachement d'un coureur à une course — 02_DATA_MODEL §9.
 *
 * Les tests d'accès viennent toujours par paire, positif et négatif
 * (03_PRIVACY_RLS §136) : « Runner A lit sa participation » ne prouve rien
 * sans « Runner B ne la lit pas ».
 */

let state: ParticipationState;

function contextFor(userId: string): ParticipationContext {
  return {
    repositories: createFakeParticipationRepositories(state),
    actor: { userId },
    now: () => FIXED_NOW,
  };
}

function raceOf(raceId: string) {
  const race = state.course.races.find((row) => row.id === raceId);
  if (race === undefined) throw new Error(`course absente de la fixture : ${raceId}`);

  return race;
}

function editionOf(editionId: string) {
  const edition = state.course.editions.find((row) => row.id === editionId);
  if (edition === undefined) throw new Error(`édition absente de la fixture : ${editionId}`);

  return edition;
}

function eventOf(eventId: string) {
  const event = state.course.events.find((row) => row.id === eventId);
  if (event === undefined) throw new Error(`événement absent de la fixture : ${eventId}`);

  return event;
}

function attachmentVerdict(raceId: string) {
  const race = raceOf(raceId);
  const edition = editionOf(race.editionId);

  return checkRaceAttachment(race, edition, eventOf(edition.eventId));
}

async function expectDomainError(
  promise: Promise<unknown>,
  code: DomainError['code'],
): Promise<DomainError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );

  expect(error, 'la commande aurait dû échouer').toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);

  return error as DomainError;
}

beforeEach(() => {
  state = participationBaseState();
});

// ============================================================
// Invariants purs
// ============================================================

describe('les deux axes du cycle de vie (02_DATA_MODEL §9.3)', () => {
  it('borne la préparation à l’avancement du coureur', () => {
    expect([...PREPARATION_STATES]).toEqual(['to_prepare', 'preparing', 'ready']);
  });

  it('n’y laisse aucun fait de course', () => {
    // « `dns`, `dnf` et `finished` sont des faits de course, pas des états de
    // préparation. » La migration 0018 les a retirés de l'enum ; la liste du
    // domaine doit dire la même chose.
    for (const courseFact of ['completed', 'dns', 'dnf', 'finished']) {
      expect(PREPARATION_STATES as readonly string[]).not.toContain(courseFact);
    }
  });

  it('laisse le coureur déclarer l’inscription et l’issue, pas l’archivage', () => {
    expect([...RUNNER_PARTICIPATION_STATUSES]).toEqual(['active', 'finished', 'dns', 'dnf']);
    expect(RUNNER_PARTICIPATION_STATUSES as readonly string[]).not.toContain('archived');
  });
});

describe('atteignabilité d’une course par un coureur (03_PRIVACY_RLS §17)', () => {
  it('accepte une course publique et une course non listée', () => {
    for (const raceId of [PUBLIC_RACE, UNLISTED_RACE]) {
      const race = raceOf(raceId);
      const edition = editionOf(race.editionId);

      expect(isRaceReachableByRunner(race, edition, eventOf(edition.eventId))).toBe(true);
    }
  });

  it('refuse une course privée : ses participations naissent d’un import', () => {
    const race = raceOf(PRIVATE_RACE);
    const edition = editionOf(race.editionId);

    expect(isRaceReachableByRunner(race, edition, eventOf(edition.eventId))).toBe(false);
  });

  it('refuse une course dont l’édition n’est pas diffusée', () => {
    // §4.1, invariant 1 : la chaîne entière compte. Une épreuve publiée sous
    // une édition en brouillon n'est lisible par personne.
    const edition = { ...editionOf(EDITION_ID), status: 'draft' as const };

    expect(isRaceReachableByRunner(raceOf(PUBLIC_RACE), edition, eventOf(edition.eventId))).toBe(
      false,
    );
  });
});

describe('conditions de rattachement (00_PRODUCT_SPEC §4.1)', () => {
  it('accepte une épreuve publiée, seule décrite comme « préparable »', () => {
    expect(attachmentVerdict(PUBLIC_RACE)).toEqual({ ok: true });
    expect(attachmentVerdict(UNLISTED_RACE)).toEqual({ ok: true });
  });

  it('tait l’existence d’une épreuve inatteignable plutôt que de la refuser', () => {
    expect(attachmentVerdict(DRAFT_RACE)).toEqual({ ok: false, reason: 'race_unreachable' });
    expect(attachmentVerdict(PRIVATE_RACE)).toEqual({ ok: false, reason: 'race_unreachable' });
  });

  it('nomme séparément l’annulation, qui a son propre motif', () => {
    // §4.1 : « Une course `cancelled` n'accepte aucune nouvelle
    // participation. » Le motif reste distinct pour que le message le dise —
    // une course annulée est visible, et le coureur doit comprendre pourquoi.
    expect(attachmentVerdict(CANCELLED_RACE)).toEqual({ ok: false, reason: 'race_cancelled' });
  });

  it('refuse une épreuve déjà courue', () => {
    expect(attachmentVerdict(COMPLETED_RACE)).toEqual({ ok: false, reason: 'race_not_open' });
  });
});

// ============================================================
// createParticipantRace
// ============================================================

describe('createParticipantRace', () => {
  it('rattache le coureur de la session, jamais un identifiant reçu', async () => {
    const created = await createParticipantRace(contextFor(RUNNER_A), { raceId: PUBLIC_RACE });

    expect(created.userId).toBe(RUNNER_A);
    expect(created.raceId).toBe(PUBLIC_RACE);
    expect(created.registrationSource).toBe('direct');
    expect(created.status).toBe('active');
    expect(created.preparationState).toBe('to_prepare');
  });

  it('date le rattachement avec l’horloge injectée', async () => {
    const created = await createParticipantRace(contextFor(RUNNER_A), { raceId: PUBLIC_RACE });

    expect(created.joinedAt).toBe(FIXED_NOW.toISOString());
  });

  it('ne recopie pas le nom du compte dans la participation', async () => {
    // §9.1 prévoit ces snapshots pour un participant importé, qui peut exister
    // avant tout compte. Ici le compte existe : le dupliquer créerait une
    // seconde copie à maintenir.
    const created = await createParticipantRace(contextFor(RUNNER_A), { raceId: PUBLIC_RACE });

    expect(created.firstNameSnapshot).toBeNull();
    expect(created.lastNameSnapshot).toBeNull();
  });

  it('accepte une course non listée, atteignable par lien direct', async () => {
    const created = await createParticipantRace(contextFor(RUNNER_A), { raceId: UNLISTED_RACE });

    expect(created.raceId).toBe(UNLISTED_RACE);
  });

  it('répond « introuvable » sur une course en brouillon ou privée', async () => {
    await expectDomainError(
      createParticipantRace(contextFor(RUNNER_A), { raceId: DRAFT_RACE }),
      'not_found',
    );
    await expectDomainError(
      createParticipantRace(contextFor(RUNNER_A), { raceId: PRIVATE_RACE }),
      'not_found',
    );
  });

  it('refuse une course annulée ou déjà courue, en le disant', async () => {
    const cancelled = await expectDomainError(
      createParticipantRace(contextFor(RUNNER_A), { raceId: CANCELLED_RACE }),
      'invalid_state',
    );
    expect(cancelled.message).toContain('annulée');

    await expectDomainError(
      createParticipantRace(contextFor(RUNNER_A), { raceId: COMPLETED_RACE }),
      'invalid_state',
    );
  });

  it('refuse un second rattachement à la même épreuve', async () => {
    await createParticipantRace(contextFor(RUNNER_A), { raceId: PUBLIC_RACE });

    await expectDomainError(
      createParticipantRace(contextFor(RUNNER_A), { raceId: PUBLIC_RACE }),
      'conflict',
    );
  });

  it('laisse deux coureurs différents rejoindre la même épreuve', async () => {
    const a = await createParticipantRace(contextFor(RUNNER_A), { raceId: PUBLIC_RACE });
    const b = await createParticipantRace(contextFor(RUNNER_B), { raceId: PUBLIC_RACE });

    expect(a.id).not.toBe(b.id);
  });

  it('rejette une entrée qui n’est pas un identifiant', async () => {
    await expect(
      createParticipantRace(contextFor(RUNNER_A), { raceId: 'pas-un-uuid' }),
    ).rejects.toThrow();
  });
});

// ============================================================
// claimParticipantRace
// ============================================================

describe('claimParticipantRace (01_ARCHITECTURE §10.2)', () => {
  it('rattache une participation importée à l’email du compte connecté', async () => {
    const imported = seedParticipation(state, {
      registrationSource: 'organizer_import',
      firstNameSnapshot: 'Sacha',
      inviteEmail: 'runner-a@test.pluka',
    });

    const claimed = await claimParticipantRace(contextFor(RUNNER_A), {
      participantRaceId: imported.id,
    });

    expect(claimed.userId).toBe(RUNNER_A);
    expect(claimed.joinedAt).toBe(FIXED_NOW.toISOString());
    // Le snapshot importé survit : il porte le nom de la liste d'inscrits.
    expect(claimed.firstNameSnapshot).toBe('Sacha');
  });

  it('ignore la casse de l’email, comme la colonne citext', async () => {
    const imported = seedParticipation(state, {
      registrationSource: 'organizer_import',
      inviteEmail: 'Runner-A@Test.Pluka',
    });

    await expect(
      claimParticipantRace(contextFor(RUNNER_A), { participantRaceId: imported.id }),
    ).resolves.toMatchObject({ userId: RUNNER_A });
  });

  it('reste autorisée sur une course annulée (02_DATA_MODEL §9.4)', async () => {
    // La création est refusée, la réclamation non : la participation existe
    // déjà, et la bloquer priverait le coureur de l'accès à sa préparation.
    const imported = seedParticipation(state, {
      raceId: CANCELLED_RACE,
      registrationSource: 'organizer_invitation',
      inviteEmail: 'runner-a@test.pluka',
    });

    await expect(
      claimParticipantRace(contextFor(RUNNER_A), { participantRaceId: imported.id }),
    ).resolves.toMatchObject({ userId: RUNNER_A, raceId: CANCELLED_RACE });
  });

  it('sépare bien les deux chemins sur la même course annulée', async () => {
    // Le contraste est l'assertion : même épreuve, même coureur, deux réponses.
    seedParticipation(state, {
      raceId: CANCELLED_RACE,
      registrationSource: 'organizer_invitation',
      inviteEmail: 'runner-b@test.pluka',
    });

    await expectDomainError(
      createParticipantRace(contextFor(RUNNER_B), { raceId: CANCELLED_RACE }),
      'invalid_state',
    );

    await expect(
      claimParticipantRace(contextFor(RUNNER_B), {
        participantRaceId: state.participants[0]?.id as string,
      }),
    ).resolves.toMatchObject({ userId: RUNNER_B });
  });

  it('ne laisse pas un autre coureur réclamer l’invitation', async () => {
    const imported = seedParticipation(state, {
      registrationSource: 'organizer_import',
      inviteEmail: 'runner-a@test.pluka',
    });

    await expectDomainError(
      claimParticipantRace(contextFor(RUNNER_B), { participantRaceId: imported.id }),
      'not_found',
    );

    expect(state.participants[0]?.userId).toBeNull();
  });

  it('est idempotente pour son propriétaire : un lien rouvert ne casse rien', async () => {
    const mine = seedParticipation(state, { userId: RUNNER_A, joinedAt: '2026-01-01T00:00:00Z' });

    const again = await claimParticipantRace(contextFor(RUNNER_A), {
      participantRaceId: mine.id,
    });

    expect(again.id).toBe(mine.id);
    expect(again.joinedAt).toBe('2026-01-01T00:00:00Z');
  });

  it('tait une participation déjà réclamée par quelqu’un d’autre', async () => {
    const other = seedParticipation(state, { userId: RUNNER_A });

    await expectDomainError(
      claimParticipantRace(contextFor(RUNNER_B), { participantRaceId: other.id }),
      'not_found',
    );
  });

  it('tait une participation inexistante', async () => {
    await expectDomainError(
      claimParticipantRace(contextFor(RUNNER_A), {
        participantRaceId: 'ffffffff-0000-4000-8000-000000000999',
      }),
      'not_found',
    );
  });
});

// ============================================================
// Lecture
// ============================================================

describe('getParticipation', () => {
  it('rend la participation et l’objectif à son propriétaire', async () => {
    const mine = seedParticipation(state, { userId: RUNNER_A });
    await setRaceGoal(contextFor(RUNNER_A), {
      participantRaceId: mine.id,
      targetDurationSeconds: 43_200,
    });

    const detail = await getParticipation(contextFor(RUNNER_A), { participantRaceId: mine.id });

    expect(detail.participation.id).toBe(mine.id);
    expect(detail.settings?.targetDurationSeconds).toBe(43_200);
  });

  it('accepte une participation sans réglages : l’absence est un état normal', async () => {
    const mine = seedParticipation(state, { userId: RUNNER_A });

    const detail = await getParticipation(contextFor(RUNNER_A), { participantRaceId: mine.id });

    expect(detail.settings).toBeNull();
  });

  it('tait la participation d’un autre coureur', async () => {
    const other = seedParticipation(state, { userId: RUNNER_A });

    await expectDomainError(
      getParticipation(contextFor(RUNNER_B), { participantRaceId: other.id }),
      'not_found',
    );
  });

  it('tait une participation importée que personne n’a réclamée', async () => {
    const imported = seedParticipation(state, { inviteEmail: 'quelquun@test.pluka' });

    await expectDomainError(
      getParticipation(contextFor(RUNNER_A), { participantRaceId: imported.id }),
      'not_found',
    );
  });
});

describe('getParticipationForRace', () => {
  it('rend null quand le coureur n’est pas rattaché', async () => {
    await expect(
      getParticipationForRace(contextFor(RUNNER_A), { raceId: PUBLIC_RACE }),
    ).resolves.toBeNull();
  });

  it('rend sa propre participation, pas celle d’un autre inscrit', async () => {
    seedParticipation(state, { userId: RUNNER_B, raceId: PUBLIC_RACE });
    const mine = seedParticipation(state, { userId: RUNNER_A, raceId: PUBLIC_RACE });

    const detail = await getParticipationForRace(contextFor(RUNNER_A), { raceId: PUBLIC_RACE });

    expect(detail?.participation.id).toBe(mine.id);
  });
});

// ============================================================
// Objectif — 00_PRODUCT_SPEC §9.1
// ============================================================

describe('setRaceGoal', () => {
  it('écrit l’objectif tel que le coureur le choisit', async () => {
    const mine = seedParticipation(state, { userId: RUNNER_A });

    const settings = await setRaceGoal(contextFor(RUNNER_A), {
      participantRaceId: mine.id,
      targetDurationSeconds: 45_900,
    });

    expect(settings.targetDurationSeconds).toBe(45_900);
  });

  it('crée la ligne de réglages en laissant les notifications actives (§46)', async () => {
    const mine = seedParticipation(state, { userId: RUNNER_A });

    const settings = await setRaceGoal(contextFor(RUNNER_A), {
      participantRaceId: mine.id,
      targetDurationSeconds: 45_900,
    });

    expect(settings.notificationsEnabled).toBe(true);
  });

  it('remplace un objectif existant sans toucher aux autres préférences', async () => {
    const mine = seedParticipation(state, { userId: RUNNER_A });
    await setRaceGoal(contextFor(RUNNER_A), {
      participantRaceId: mine.id,
      targetDurationSeconds: 45_900,
    });

    const settings = await setRaceGoal(contextFor(RUNNER_A), {
      participantRaceId: mine.id,
      targetDurationSeconds: 39_600,
    });

    expect(settings.targetDurationSeconds).toBe(39_600);
    expect(settings.assistanceStatus).toBe('to_define');
    expect(state.settings).toHaveLength(1);
  });

  it('reste possible sur une course annulée (§4.1)', async () => {
    // « Les données personnelles rattachées restent accessibles et
    // modifiables. Aucune donnée personnelle n'est supprimée, dégradée ni
    // verrouillée par une annulation. »
    const mine = seedParticipation(state, { userId: RUNNER_A, raceId: CANCELLED_RACE });

    await expect(
      setRaceGoal(contextFor(RUNNER_A), {
        participantRaceId: mine.id,
        targetDurationSeconds: 45_900,
      }),
    ).resolves.toMatchObject({ targetDurationSeconds: 45_900 });
  });

  it('exige un objectif strictement positif et entier (PLAN_ENGINE §7)', async () => {
    const mine = seedParticipation(state, { userId: RUNNER_A });

    for (const invalid of [0, -1, 12.5]) {
      await expect(
        setRaceGoal(contextFor(RUNNER_A), {
          participantRaceId: mine.id,
          targetDurationSeconds: invalid,
        }),
      ).rejects.toThrow();
    }
  });

  it('n’invente aucun plafond sportif, seulement celui du stockage', async () => {
    // PLAN_ENGINE §50 interdit de déclarer un objectif impossible sans modèle
    // validé : 60 heures doit passer.
    const mine = seedParticipation(state, { userId: RUNNER_A });

    await expect(
      setRaceGoal(contextFor(RUNNER_A), {
        participantRaceId: mine.id,
        targetDurationSeconds: 216_000,
      }),
    ).resolves.toMatchObject({ targetDurationSeconds: 216_000 });

    await expect(
      setRaceGoal(contextFor(RUNNER_A), {
        participantRaceId: mine.id,
        targetDurationSeconds: 2_147_483_648,
      }),
    ).rejects.toThrow();
  });

  it('refuse d’écrire l’objectif d’un autre coureur', async () => {
    const other = seedParticipation(state, { userId: RUNNER_A });

    await expectDomainError(
      setRaceGoal(contextFor(RUNNER_B), {
        participantRaceId: other.id,
        targetDurationSeconds: 1,
      }),
      'not_found',
    );

    expect(state.settings).toHaveLength(0);
  });
});

// ============================================================
// Les deux axes du cycle de vie — 02_DATA_MODEL §9.3
// ============================================================

describe('setPreparationState', () => {
  it('avance dans la préparation', async () => {
    const mine = seedParticipation(state, { userId: RUNNER_A });

    const updated = await setPreparationState(contextFor(RUNNER_A), {
      participantRaceId: mine.id,
      preparationState: 'ready',
    });

    expect(updated.preparationState).toBe('ready');
  });

  it('ne touche pas au statut de participation', async () => {
    const mine = seedParticipation(state, { userId: RUNNER_A, status: 'dnf' });

    const updated = await setPreparationState(contextFor(RUNNER_A), {
      participantRaceId: mine.id,
      preparationState: 'ready',
    });

    // « Un coureur peut être `ready` et finir en `dnf`. » Le statut posé avant
    // survit intact : rien ne le recalcule à partir de l'axe préparation.
    expect(updated.status).toBe('dnf');
  });

  it('rejette un fait de course sur l’axe préparation', async () => {
    const mine = seedParticipation(state, { userId: RUNNER_A });

    for (const courseFact of ['completed', 'dns', 'dnf', 'finished', 'archived']) {
      await expect(
        setPreparationState(contextFor(RUNNER_A), {
          participantRaceId: mine.id,
          preparationState: courseFact,
        }),
      ).rejects.toThrow();
    }
  });

  it('reste possible sur une course annulée (§4.1)', async () => {
    const mine = seedParticipation(state, { userId: RUNNER_A, raceId: CANCELLED_RACE });

    await expect(
      setPreparationState(contextFor(RUNNER_A), {
        participantRaceId: mine.id,
        preparationState: 'ready',
      }),
    ).resolves.toMatchObject({ preparationState: 'ready' });
  });

  it('refuse de toucher la participation d’un autre coureur', async () => {
    const other = seedParticipation(state, { userId: RUNNER_A });

    await expectDomainError(
      setPreparationState(contextFor(RUNNER_B), {
        participantRaceId: other.id,
        preparationState: 'ready',
      }),
      'not_found',
    );

    expect(state.participants[0]?.preparationState).toBe('to_prepare');
  });
});

describe('setParticipationStatus', () => {
  it('déclare le devenir de la participation', async () => {
    const mine = seedParticipation(state, { userId: RUNNER_A });

    for (const status of RUNNER_PARTICIPATION_STATUSES) {
      const updated = await setParticipationStatus(contextFor(RUNNER_A), {
        participantRaceId: mine.id,
        status,
      });

      expect(updated.status).toBe(status);
    }
  });

  it('ne touche pas à l’état de préparation', async () => {
    const mine = seedParticipation(state, { userId: RUNNER_A, preparationState: 'ready' });

    const updated = await setParticipationStatus(contextFor(RUNNER_A), {
      participantRaceId: mine.id,
      status: 'dnf',
    });

    // L'information « il était prêt » survit à l'abandon : c'est exactement ce
    // que la dérivation aurait écrasé.
    expect(updated.preparationState).toBe('ready');
    expect(updated.status).toBe('dnf');
  });

  it('laisse corriger une issue saisie par erreur', async () => {
    // §9.3 ne contraint l'ordre sur aucun des deux axes.
    const mine = seedParticipation(state, { userId: RUNNER_A });

    await setParticipationStatus(contextFor(RUNNER_A), {
      participantRaceId: mine.id,
      status: 'dnf',
    });

    const corrected = await setParticipationStatus(contextFor(RUNNER_A), {
      participantRaceId: mine.id,
      status: 'active',
    });

    expect(corrected.status).toBe('active');
  });

  it('n’archive pas : c’est un geste d’administration', async () => {
    const mine = seedParticipation(state, { userId: RUNNER_A });

    await expect(
      setParticipationStatus(contextFor(RUNNER_A), {
        participantRaceId: mine.id,
        status: 'archived',
      }),
    ).rejects.toThrow();
  });

  it('rejette un état de préparation sur l’axe participation', async () => {
    const mine = seedParticipation(state, { userId: RUNNER_A });

    for (const preparationState of PREPARATION_STATES) {
      await expect(
        setParticipationStatus(contextFor(RUNNER_A), {
          participantRaceId: mine.id,
          status: preparationState,
        }),
      ).rejects.toThrow();
    }
  });

  it('reste possible sur une course annulée (§4.1)', async () => {
    const mine = seedParticipation(state, { userId: RUNNER_A, raceId: CANCELLED_RACE });

    await expect(
      setParticipationStatus(contextFor(RUNNER_A), {
        participantRaceId: mine.id,
        status: 'dns',
      }),
    ).resolves.toMatchObject({ status: 'dns' });
  });

  it('refuse de toucher la participation d’un autre coureur', async () => {
    const other = seedParticipation(state, { userId: RUNNER_A });

    await expectDomainError(
      setParticipationStatus(contextFor(RUNNER_B), {
        participantRaceId: other.id,
        status: 'dnf',
      }),
      'not_found',
    );

    expect(state.participants[0]?.status).toBe('active');
  });
});

// ============================================================
// Liste d'inscrits — 03_PRIVACY_RLS §26, §27, §29
// ============================================================

describe('listRaceRoster', () => {
  beforeEach(() => {
    seedParticipation(state, {
      userId: RUNNER_A,
      raceId: PUBLIC_RACE,
      bibNumber: '101',
    });
    seedParticipation(state, {
      raceId: PUBLIC_RACE,
      registrationSource: 'organizer_import',
      firstNameSnapshot: 'Sacha',
      lastNameSnapshot: 'Import',
      bibNumber: '102',
      inviteEmail: 'sacha@test.pluka',
    });
  });

  it('donne à l’organisation la liste opérationnelle de sa course', async () => {
    const roster = await listRaceRoster(contextFor(VIEWER_A), { raceId: PUBLIC_RACE });

    expect(roster).toHaveLength(2);
    expect(roster.map((entry) => entry.bibNumber)).toEqual(['101', '102']);
  });

  it('dit qui a rejoint PLUKA, sans nommer le compte', async () => {
    const roster = await listRaceRoster(contextFor(VIEWER_A), { raceId: PUBLIC_RACE });

    expect(roster.map((entry) => entry.activated)).toEqual([true, false]);
  });

  it('ne porte ni objectif, ni état de préparation, ni email, ni user_id', async () => {
    // §29 : l'objectif est strictement propriétaire. Le DTO l'exclut par
    // construction — la liste des clés est l'assertion.
    const roster = await listRaceRoster(contextFor(VIEWER_A), { raceId: PUBLIC_RACE });

    expect(Object.keys(roster[0] as object).sort()).toEqual([
      'activated',
      'bibNumber',
      'externalRegistrationId',
      'firstName',
      'lastName',
      'participantRaceId',
      'registrationSource',
      'startWaveId',
    ]);
  });

  it('ne consulte même pas la table des préférences', async () => {
    const context = contextFor(VIEWER_A);
    await setRaceGoal(contextFor(RUNNER_A), {
      participantRaceId: state.participants[0]?.id as string,
      targetDurationSeconds: 43_200,
    });

    state.calls.length = 0;
    await listRaceRoster(context, { raceId: PUBLIC_RACE });

    expect(state.calls.filter((call) => call.startsWith('participantRaceSettings'))).toEqual([]);
  });

  it('refuse un membre d’une autre organisation', async () => {
    await expectDomainError(
      listRaceRoster(contextFor(OWNER_B), { raceId: PUBLIC_RACE }),
      'forbidden',
    );
  });

  it('refuse un coureur, y compris inscrit à cette course', async () => {
    // Participer ne donne aucun droit sur la liste des autres inscrits.
    await expectDomainError(
      listRaceRoster(contextFor(RUNNER_A), { raceId: PUBLIC_RACE }),
      'forbidden',
    );
  });

  it('refuse un inconnu', async () => {
    await expectDomainError(
      listRaceRoster(contextFor(OUTSIDER), { raceId: PUBLIC_RACE }),
      'forbidden',
    );
  });

  it('accepte l’admin plateforme, qui administre la base courses', async () => {
    await expect(
      listRaceRoster(contextFor(PLUKA_ADMIN), { raceId: PUBLIC_RACE }),
    ).resolves.toHaveLength(2);
  });

  it('borne la liste', async () => {
    const roster = await listRaceRoster(contextFor(VIEWER_A), { raceId: PUBLIC_RACE, limit: 1 });

    expect(roster).toHaveLength(1);
  });

  it('remonte l’organisation depuis l’épreuve, jamais depuis l’appelant', async () => {
    // Un `organizationId` reçu de l'appelant permettrait de désigner une
    // organisation où l'on a des droits pour lire la course d'une autre.
    await expectDomainError(
      listRaceRoster(contextFor(OWNER_B), { raceId: PUBLIC_RACE, organizationId: ORG_A } as never),
      'forbidden',
    );
  });
});
