import { selectColumns } from '../columns.js';
import { defineRepository, type RepositoryContext } from '../repository.js';
import { unwrap, unwrapMaybe } from '../results.js';
import type { InsertRow } from '../types.js';
import {
  editionRepository,
  eventRepository,
  identityRepository,
  raceRepository,
  type EditionRepository,
  type EventRepository,
  type IdentityRepository,
  type RaceRepository,
} from './course.js';
import type {
  ParticipantRaceRecord,
  ParticipantRaceSettingsRecord,
  ParticipantRosterEntry,
} from './records.js';

/*
 * Repositories de participation — 02_DATA_MODEL §9.
 *
 * Ils exécutent des requêtes et traduisent des lignes. Aucune décision
 * d'autorisation, d'entitlement ou de quota n'est prise ici : ces règles
 * vivent dans `@pluka/domain` (01_ARCHITECTURE §4.5, §5 règle 5).
 *
 * Deux minimisations sont structurelles plutôt que laissées à la vigilance de
 * l'appelant :
 *
 * - aucune projection ne remonte `invite_email` (03_PRIVACY_RLS §28) ;
 * - la lecture destinée à l'organisation a sa propre projection, qui ignore
 *   l'objectif et l'état de préparation (§26, §27, §29).
 *
 * Aucune jointure `participant_races` → `participant_race_settings` n'existe
 * dans ce fichier : l'objectif d'un coureur ne peut pas sortir par
 * inadvertance dans une liste d'inscrits.
 */

const PARTICIPANT_RACE_COLUMNS = [
  'id',
  'race_id',
  'user_id',
  'first_name_snapshot',
  'last_name_snapshot',
  'registration_source',
  'external_registration_id',
  'bib_number',
  'start_wave_id',
  'personal_start_datetime',
  'status',
  'preparation_state',
  'joined_at',
] as const;

/**
 * Projection de la liste d'inscrits — 03_PRIVACY_RLS §27.
 *
 * `user_id` y figure pour une seule raison : dire si le participant a rejoint
 * PLUKA. Il ne traverse pas le DTO.
 */
const ROSTER_COLUMNS = [
  'id',
  'user_id',
  'first_name_snapshot',
  'last_name_snapshot',
  'bib_number',
  'start_wave_id',
  'registration_source',
  'external_registration_id',
] as const;

const SETTINGS_COLUMNS = [
  'participant_race_id',
  'target_duration_seconds',
  'assistance_status',
  'nutrition_enabled',
  'nutrition_waypoints_visible',
  'repere_visible',
  'notifications_enabled',
] as const;

type ParticipantRaceRow = {
  id: string;
  race_id: string;
  user_id: string | null;
  first_name_snapshot: string | null;
  last_name_snapshot: string | null;
  registration_source: ParticipantRaceRecord['registrationSource'];
  external_registration_id: string | null;
  bib_number: string | null;
  start_wave_id: string | null;
  personal_start_datetime: string | null;
  status: ParticipantRaceRecord['status'];
  preparation_state: ParticipantRaceRecord['preparationState'];
  joined_at: string | null;
};

type RosterRow = {
  id: string;
  user_id: string | null;
  first_name_snapshot: string | null;
  last_name_snapshot: string | null;
  bib_number: string | null;
  start_wave_id: string | null;
  registration_source: ParticipantRaceRecord['registrationSource'];
  external_registration_id: string | null;
};

type SettingsRow = {
  participant_race_id: string;
  target_duration_seconds: number | null;
  assistance_status: ParticipantRaceSettingsRecord['assistanceStatus'];
  nutrition_enabled: boolean;
  nutrition_waypoints_visible: boolean;
  repere_visible: boolean;
  notifications_enabled: boolean;
};

function toParticipantRace(row: ParticipantRaceRow): ParticipantRaceRecord {
  return {
    id: row.id,
    raceId: row.race_id,
    userId: row.user_id,
    firstNameSnapshot: row.first_name_snapshot,
    lastNameSnapshot: row.last_name_snapshot,
    registrationSource: row.registration_source,
    externalRegistrationId: row.external_registration_id,
    bibNumber: row.bib_number,
    startWaveId: row.start_wave_id,
    personalStartDatetime: row.personal_start_datetime,
    status: row.status,
    preparationState: row.preparation_state,
    joinedAt: row.joined_at,
  };
}

function toRosterEntry(row: RosterRow): ParticipantRosterEntry {
  return {
    participantRaceId: row.id,
    firstName: row.first_name_snapshot,
    lastName: row.last_name_snapshot,
    bibNumber: row.bib_number,
    startWaveId: row.start_wave_id,
    registrationSource: row.registration_source,
    externalRegistrationId: row.external_registration_id,
    activated: row.user_id !== null,
  };
}

function toSettings(row: SettingsRow): ParticipantRaceSettingsRecord {
  return {
    participantRaceId: row.participant_race_id,
    targetDurationSeconds: row.target_duration_seconds,
    assistanceStatus: row.assistance_status,
    nutritionEnabled: row.nutrition_enabled,
    nutritionWaypointsVisible: row.nutrition_waypoints_visible,
    repereVisible: row.repere_visible,
    notificationsEnabled: row.notifications_enabled,
  };
}

export interface ParticipantRaceRepository {
  findById(participantRaceId: string): Promise<ParticipantRaceRecord | null>;
  /** Le rattachement d'un coureur à une course est unique (`ux_participant_race_user`). */
  findByRaceAndUser(raceId: string, userId: string): Promise<ParticipantRaceRecord | null>;
  /** Lecture opérationnelle destinée à l'organisation — 03_PRIVACY_RLS §27. */
  listRoster(raceId: string, limit: number): Promise<readonly ParticipantRosterEntry[]>;
  insert(input: InsertRow<'participant_races'>): Promise<ParticipantRaceRecord>;
  /*
   * Deux écritures, deux axes — 02_DATA_MODEL §9.3.
   *
   * « Aucun chemin d'écriture ne calcule l'une à partir de l'autre. » Une
   * méthode unique portant les deux colonnes suffirait à faire renaître la
   * dérivation : elle obligerait chaque appelant à fournir une valeur pour
   * l'axe qu'il ne touche pas, donc à l'inventer.
   */
  updatePreparationState(
    participantRaceId: string,
    preparationState: ParticipantRaceRecord['preparationState'],
  ): Promise<ParticipantRaceRecord>;
  updateStatus(
    participantRaceId: string,
    status: ParticipantRaceRecord['status'],
  ): Promise<ParticipantRaceRecord>;
  /**
   * Réclamation d'une participation importée — 01_ARCHITECTURE §10.2.
   *
   * Compare-and-set : l'écriture ne réussit que si la participation est encore
   * libre **et** que son email d'invitation est bien celui transmis par le use
   * case. Rend `null` sinon.
   *
   * La comparaison reste dans le `where` plutôt que de remonter
   * `invite_email` : §28 minimise cet email, et il n'a aucune raison de
   * traverser la frontière du paquet. Elle rend aussi la réclamation atomique
   * — deux tentatives concurrentes ne peuvent pas réclamer la même ligne.
   */
  claimForUser(
    participantRaceId: string,
    userId: string,
    inviteEmail: string,
    joinedAt: string,
  ): Promise<ParticipantRaceRecord | null>;
}

export const participantRaceRepository = defineRepository<ParticipantRaceRepository>((context) => ({
  async findById(participantRaceId) {
    const row = unwrapMaybe(
      await context.client
        .from('participant_races')
        .select(selectColumns('participant_races', PARTICIPANT_RACE_COLUMNS))
        .eq('id', participantRaceId)
        .maybeSingle(),
      'participant_races.findById',
    );

    return row === null ? null : toParticipantRace(row);
  },

  async findByRaceAndUser(raceId, userId) {
    const row = unwrapMaybe(
      await context.client
        .from('participant_races')
        .select(selectColumns('participant_races', PARTICIPANT_RACE_COLUMNS))
        .eq('race_id', raceId)
        .eq('user_id', userId)
        .maybeSingle(),
      'participant_races.findByRaceAndUser',
    );

    return row === null ? null : toParticipantRace(row);
  },

  async listRoster(raceId, limit) {
    const rows = unwrap(
      await context.client
        .from('participant_races')
        .select(selectColumns('participant_races', ROSTER_COLUMNS))
        .eq('race_id', raceId)
        .order('bib_number', { ascending: true, nullsFirst: false })
        .limit(limit),
      'participant_races.listRoster',
    );

    return rows.map(toRosterEntry);
  },

  async insert(input) {
    return toParticipantRace(
      unwrap(
        await context.client
          .from('participant_races')
          .insert(input)
          .select(selectColumns('participant_races', PARTICIPANT_RACE_COLUMNS))
          .single(),
        'participant_races.insert',
      ),
    );
  },

  async updatePreparationState(participantRaceId, preparationState) {
    return toParticipantRace(
      unwrap(
        await context.client
          .from('participant_races')
          .update({ preparation_state: preparationState })
          .eq('id', participantRaceId)
          .select(selectColumns('participant_races', PARTICIPANT_RACE_COLUMNS))
          .single(),
        'participant_races.updatePreparationState',
      ),
    );
  },

  async updateStatus(participantRaceId, status) {
    return toParticipantRace(
      unwrap(
        await context.client
          .from('participant_races')
          .update({ status })
          .eq('id', participantRaceId)
          .select(selectColumns('participant_races', PARTICIPANT_RACE_COLUMNS))
          .single(),
        'participant_races.updateStatus',
      ),
    );
  },

  async claimForUser(participantRaceId, userId, inviteEmail, joinedAt) {
    const row = unwrapMaybe(
      await context.client
        .from('participant_races')
        .update({ user_id: userId, joined_at: joinedAt })
        .eq('id', participantRaceId)
        .is('user_id', null)
        .eq('invite_email', inviteEmail)
        .select(selectColumns('participant_races', PARTICIPANT_RACE_COLUMNS))
        .maybeSingle(),
      'participant_races.claimForUser',
    );

    return row === null ? null : toParticipantRace(row);
  },
}));

export interface ParticipantRaceSettingsRepository {
  findByParticipantRace(participantRaceId: string): Promise<ParticipantRaceSettingsRecord | null>;
  /**
   * Écrit l'objectif, en créant la ligne de réglages si elle manque.
   *
   * L'absence de ligne est un état normal : SOURCES_EXTRACTION §46 fait des
   * notifications un défaut de colonne, et une participation sans réglages
   * doit donc rester possible. L'`upsert` évite qu'un choix d'objectif ait à
   * savoir si la ligne existe déjà, et ne touche aucune autre préférence.
   */
  upsertTargetDuration(
    participantRaceId: string,
    targetDurationSeconds: number,
  ): Promise<ParticipantRaceSettingsRecord>;
}

export const participantRaceSettingsRepository =
  defineRepository<ParticipantRaceSettingsRepository>((context) => ({
    async findByParticipantRace(participantRaceId) {
      const row = unwrapMaybe(
        await context.client
          .from('participant_race_settings')
          .select(selectColumns('participant_race_settings', SETTINGS_COLUMNS))
          .eq('participant_race_id', participantRaceId)
          .maybeSingle(),
        'participant_race_settings.findByParticipantRace',
      );

      return row === null ? null : toSettings(row);
    },

    async upsertTargetDuration(participantRaceId, targetDurationSeconds) {
      return toSettings(
        unwrap(
          await context.client
            .from('participant_race_settings')
            .upsert(
              {
                participant_race_id: participantRaceId,
                target_duration_seconds: targetDurationSeconds,
              },
              { onConflict: 'participant_race_id' },
            )
            .select(selectColumns('participant_race_settings', SETTINGS_COLUMNS))
            .single(),
          'participant_race_settings.upsertTargetDuration',
        ),
      );
    },
  }));

/**
 * Email du compte de l'acteur.
 *
 * Isolé dans son propre repository plutôt qu'ajouté à `IdentityRepository` :
 * seule la réclamation d'une participation importée en a besoin, et
 * 03_PRIVACY_RLS §28 demande que l'email ne circule pas au-delà du workflow
 * qui le justifie. Aucun autre bundle ne le reçoit.
 */
export interface AccountRepository {
  findAccountEmail(userId: string): Promise<string | null>;
}

export const accountRepository = defineRepository<AccountRepository>((context) => ({
  async findAccountEmail(userId) {
    const row = unwrapMaybe(
      await context.client
        .from('users')
        .select(selectColumns('users', ['id', 'email']))
        .eq('id', userId)
        .maybeSingle(),
      'users.findAccountEmail',
    );

    return row === null ? null : row.email;
  },
}));

/**
 * Bundle passé aux use cases de participation.
 *
 * La hiérarchie de course y figure parce que le rattachement dépend de l'état
 * de l'épreuve, et la liste d'inscrits de l'organisation gestionnaire : le use
 * case remonte `race → edition → event` plutôt que de croire un
 * `organizationId` reçu de l'appelant.
 */
export interface ParticipationRepositories {
  readonly participantRaces: ParticipantRaceRepository;
  readonly participantRaceSettings: ParticipantRaceSettingsRepository;
  readonly accounts: AccountRepository;
  readonly races: RaceRepository;
  readonly editions: EditionRepository;
  readonly events: EventRepository;
  readonly identity: IdentityRepository;
}

export function createParticipationRepositories(
  context: RepositoryContext,
): ParticipationRepositories {
  return {
    participantRaces: participantRaceRepository(context),
    participantRaceSettings: participantRaceSettingsRepository(context),
    accounts: accountRepository(context),
    races: raceRepository(context),
    editions: editionRepository(context),
    events: eventRepository(context),
    identity: identityRepository(context),
  };
}
