import type {
  ParticipantRaceRecord,
  ParticipantRaceSettingsRecord,
  ParticipationRepositories,
  RaceRecord,
} from '@pluka/db';

import { baseState, createFakeRepositories, EDITION_ID, type FakeState } from './repositories.js';

/**
 * Repositories de participation en mémoire.
 *
 * Ils implémentent les mêmes interfaces que `@pluka/db` : les use cases testés
 * sont exactement ceux qui tourneront en production. On ne simule que les
 * dépendances, jamais la fonction testée.
 *
 * Le fake reproduit trois comportements que le domaine tient pour acquis et
 * qui viennent en réalité de PostgreSQL :
 *
 * - `ux_participant_race_user` : une seule participation par (course, coureur) ;
 * - `claimForUser` est un compare-and-set — il ne rend rien si la
 *   participation n'est plus libre, ou si l'email ne correspond pas ;
 * - `invite_email` est une colonne `citext` : la comparaison ignore la casse.
 *
 * `invite_email` vit dans une table à part du fake, comme il vit hors du DTO :
 * aucune lecture ne peut le faire remonter par accident.
 */

export const RUNNER_A = '11111111-1111-4111-8111-111111111111';
export const RUNNER_B = '22222222-2222-4222-8222-222222222222';

export const PUBLIC_RACE = 'dddddddd-0000-4000-8000-000000000101';
export const UNLISTED_RACE = 'dddddddd-0000-4000-8000-000000000102';
export const PRIVATE_RACE = 'dddddddd-0000-4000-8000-000000000103';
export const CANCELLED_RACE = 'dddddddd-0000-4000-8000-000000000104';
export const DRAFT_RACE = 'dddddddd-0000-4000-8000-000000000105';
export const COMPLETED_RACE = 'dddddddd-0000-4000-8000-000000000106';

export const FIXED_NOW = new Date('2026-03-01T10:00:00.000Z');

function race(
  id: string,
  slug: string,
  status: RaceRecord['status'],
  publicVisibility: RaceRecord['publicVisibility'],
): RaceRecord {
  return {
    id,
    editionId: EDITION_ID,
    name: slug,
    slug,
    distanceKm: 42,
    elevationGainM: 2000,
    elevationLossM: 2000,
    startDatetime: '2026-06-20T04:00:00Z',
    cutoffDatetime: null,
    timezone: 'Europe/Paris',
    startLocationName: null,
    finishLocationName: null,
    status,
    publicVisibility,
  };
}

export interface ParticipationState {
  readonly course: FakeState;
  participants: ParticipantRaceRecord[];
  settings: ParticipantRaceSettingsRecord[];
  /** `invite_email`, tenu hors des DTO comme il l'est hors des projections SQL. */
  inviteEmails: Map<string, string>;
  accounts: Map<string, string>;
  /** Trace des lectures, pour prouver ce qu'un use case ne consulte pas. */
  calls: string[];
}

export function emptyParticipation(): ParticipantRaceRecord {
  return {
    id: '',
    raceId: '',
    userId: null,
    firstNameSnapshot: null,
    lastNameSnapshot: null,
    registrationSource: 'direct',
    externalRegistrationId: null,
    bibNumber: null,
    startWaveId: null,
    personalStartDatetime: null,
    status: 'active',
    preparationState: 'to_prepare',
    joinedAt: null,
  };
}

export function participationBaseState(): ParticipationState {
  const course = baseState();

  course.races.push(
    race(PUBLIC_RACE, 'publique', 'published', 'public'),
    race(UNLISTED_RACE, 'non-listee', 'published', 'unlisted'),
    race(PRIVATE_RACE, 'privee', 'published', 'private'),
    race(CANCELLED_RACE, 'annulee', 'cancelled', 'public'),
    race(DRAFT_RACE, 'brouillon', 'draft', 'public'),
    race(COMPLETED_RACE, 'terminee', 'completed', 'public'),
  );

  course.identities.push(
    { id: RUNNER_A, platformRole: 'user' },
    { id: RUNNER_B, platformRole: 'user' },
  );

  return {
    course,
    participants: [],
    settings: [],
    inviteEmails: new Map(),
    accounts: new Map([
      [RUNNER_A, 'runner-a@test.pluka'],
      [RUNNER_B, 'runner-b@test.pluka'],
    ]),
    calls: [],
  };
}

let sequence = 0;

function nextId(): string {
  sequence += 1;
  return `eeeeeeee-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

export function createFakeParticipationRepositories(
  state: ParticipationState,
): ParticipationRepositories {
  const course = createFakeRepositories(state.course);

  return {
    races: course.races,
    editions: course.editions,
    events: course.events,
    identity: course.identity,

    accounts: {
      findAccountEmail: async (userId) => {
        state.calls.push(`accounts.findAccountEmail:${userId}`);
        return state.accounts.get(userId) ?? null;
      },
    },

    participantRaces: {
      findById: async (id) => {
        state.calls.push(`participantRaces.findById:${id}`);
        return state.participants.find((row) => row.id === id) ?? null;
      },

      findByRaceAndUser: async (raceId, userId) => {
        state.calls.push(`participantRaces.findByRaceAndUser:${raceId}`);
        return (
          state.participants.find((row) => row.raceId === raceId && row.userId === userId) ?? null
        );
      },

      listRoster: async (raceId, limit) => {
        state.calls.push(`participantRaces.listRoster:${raceId}`);

        return state.participants
          .filter((row) => row.raceId === raceId)
          .slice(0, limit)
          .map((row) => ({
            participantRaceId: row.id,
            firstName: row.firstNameSnapshot,
            lastName: row.lastNameSnapshot,
            bibNumber: row.bibNumber,
            startWaveId: row.startWaveId,
            registrationSource: row.registrationSource,
            externalRegistrationId: row.externalRegistrationId,
            activated: row.userId !== null,
          }));
      },

      insert: async (input) => {
        // `ux_participant_race_user` : le fake refuse ce que la base refuse.
        const duplicate = state.participants.some(
          (row) => row.raceId === input.race_id && row.userId === (input.user_id ?? null),
        );
        if (duplicate && input.user_id != null) {
          throw new Error('ux_participant_race_user : participation déjà présente');
        }

        const record: ParticipantRaceRecord = {
          ...emptyParticipation(),
          id: nextId(),
          raceId: input.race_id,
          userId: input.user_id ?? null,
          firstNameSnapshot: input.first_name_snapshot ?? null,
          lastNameSnapshot: input.last_name_snapshot ?? null,
          registrationSource: input.registration_source ?? 'direct',
          bibNumber: input.bib_number ?? null,
          joinedAt: input.joined_at ?? null,
        };

        state.participants.push(record);
        return record;
      },

      // Deux écritures, deux axes (§9.3) : chacune ne touche que sa colonne,
      // et le fake ne recompose rien — sinon les tests d'indépendance
      // passeraient sur une dérivation cachée dans la fixture.
      updatePreparationState: async (id, preparationState) => {
        const index = state.participants.findIndex((row) => row.id === id);
        if (index < 0) throw new Error(`participation absente du fake : ${id}`);

        const updated: ParticipantRaceRecord = {
          ...(state.participants[index] as ParticipantRaceRecord),
          preparationState,
        };

        state.participants[index] = updated;
        return updated;
      },

      updateStatus: async (id, status) => {
        const index = state.participants.findIndex((row) => row.id === id);
        if (index < 0) throw new Error(`participation absente du fake : ${id}`);

        const updated: ParticipantRaceRecord = {
          ...(state.participants[index] as ParticipantRaceRecord),
          status,
        };

        state.participants[index] = updated;
        return updated;
      },

      claimForUser: async (id, userId, inviteEmail, joinedAt) => {
        const index = state.participants.findIndex((row) => row.id === id);
        if (index < 0) return null;

        const current = state.participants[index] as ParticipantRaceRecord;
        const expected = state.inviteEmails.get(id) ?? null;

        // Compare-and-set : libre, et le bon email. `citext` compare sans
        // tenir compte de la casse.
        if (current.userId !== null) return null;
        if (expected === null) return null;
        if (expected.toLowerCase() !== inviteEmail.toLowerCase()) return null;

        const updated: ParticipantRaceRecord = { ...current, userId, joinedAt };
        state.participants[index] = updated;
        return updated;
      },
    },

    participantRaceSettings: {
      findByParticipantRace: async (id) => {
        state.calls.push(`participantRaceSettings.findByParticipantRace:${id}`);
        return state.settings.find((row) => row.participantRaceId === id) ?? null;
      },

      upsertTargetDuration: async (id, targetDurationSeconds) => {
        state.calls.push(`participantRaceSettings.upsertTargetDuration:${id}`);

        const index = state.settings.findIndex((row) => row.participantRaceId === id);

        if (index < 0) {
          // Défauts de colonnes de 0001 et 0016 : une ligne créée pour un
          // objectif laisse les notifications actives (§46).
          const created: ParticipantRaceSettingsRecord = {
            participantRaceId: id,
            targetDurationSeconds,
            assistanceStatus: 'to_define',
            nutritionEnabled: false,
            nutritionWaypointsVisible: true,
            repereVisible: false,
            notificationsEnabled: true,
          };
          state.settings.push(created);
          return created;
        }

        const updated: ParticipantRaceSettingsRecord = {
          ...(state.settings[index] as ParticipantRaceSettingsRecord),
          targetDurationSeconds,
        };
        state.settings[index] = updated;
        return updated;
      },
    },
  };
}

/** Ajoute une participation déjà en base, sans passer par un use case. */
export function seedParticipation(
  state: ParticipationState,
  overrides: Partial<ParticipantRaceRecord> & { readonly inviteEmail?: string },
): ParticipantRaceRecord {
  const { inviteEmail, ...rest } = overrides;

  const record: ParticipantRaceRecord = {
    ...emptyParticipation(),
    id: nextId(),
    raceId: PUBLIC_RACE,
    ...rest,
  };

  state.participants.push(record);
  if (inviteEmail !== undefined) state.inviteEmails.set(record.id, inviteEmail);

  return record;
}
