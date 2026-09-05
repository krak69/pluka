import { selectColumns } from '../columns.js';
import { defineRepository, type RepositoryContext } from '../repository.js';
import { unwrap, unwrapMaybe } from '../results.js';
import type { InsertRow, UpdateRow } from '../types.js';
import type {
  EditionRecord,
  EventRecord,
  MembershipRecord,
  PlatformIdentityRecord,
  RaceRecord,
  RaceStatusTransitionRecord,
} from './records.js';

/*
 * Repositories Event / Edition / Race.
 *
 * Ils exécutent des requêtes et traduisent des lignes. Ils ne décident ni
 * d'une autorisation, ni d'un entitlement, ni d'un invariant métier : ces
 * règles vivent dans `@pluka/domain` (01_ARCHITECTURE §4.5, §5 règle 5).
 */

const EVENT_COLUMNS = ['id', 'organization_id', 'name', 'slug', 'status'] as const;

const EDITION_COLUMNS = [
  'id',
  'event_id',
  'year',
  'slug',
  'start_date',
  'end_date',
  'status',
] as const;

const RACE_COLUMNS = [
  'id',
  'edition_id',
  'name',
  'slug',
  'distance_km',
  'elevation_gain_m',
  'elevation_loss_m',
  'start_datetime',
  'cutoff_datetime',
  'timezone',
  'start_location_name',
  'finish_location_name',
  'status',
  'public_visibility',
] as const;

const TRANSITION_COLUMNS = [
  'id',
  'race_id',
  'from_status',
  'to_status',
  'actor_user_id',
  'created_at',
] as const;

type EventRow = {
  id: string;
  organization_id: string | null;
  name: string;
  slug: string;
  status: EventRecord['status'];
};

type EditionRow = {
  id: string;
  event_id: string;
  year: number;
  slug: string;
  start_date: string;
  end_date: string | null;
  status: EditionRecord['status'];
};

type RaceRow = {
  id: string;
  edition_id: string;
  name: string;
  slug: string;
  distance_km: number;
  elevation_gain_m: number | null;
  elevation_loss_m: number | null;
  start_datetime: string;
  cutoff_datetime: string | null;
  timezone: string;
  start_location_name: string | null;
  finish_location_name: string | null;
  status: RaceRecord['status'];
  public_visibility: RaceRecord['publicVisibility'];
};

type TransitionRow = {
  id: string;
  race_id: string;
  from_status: RaceRecord['status'];
  to_status: RaceRecord['status'];
  actor_user_id: string | null;
  created_at: string;
};

function toEvent(row: EventRow): EventRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    status: row.status,
  };
}

function toEdition(row: EditionRow): EditionRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    year: row.year,
    slug: row.slug,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
  };
}

function toRace(row: RaceRow): RaceRecord {
  return {
    id: row.id,
    editionId: row.edition_id,
    name: row.name,
    slug: row.slug,
    distanceKm: row.distance_km,
    elevationGainM: row.elevation_gain_m,
    elevationLossM: row.elevation_loss_m,
    startDatetime: row.start_datetime,
    cutoffDatetime: row.cutoff_datetime,
    timezone: row.timezone,
    startLocationName: row.start_location_name,
    finishLocationName: row.finish_location_name,
    status: row.status,
    publicVisibility: row.public_visibility,
  };
}

function toTransition(row: TransitionRow): RaceStatusTransitionRecord {
  return {
    id: row.id,
    raceId: row.race_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorUserId: row.actor_user_id,
    createdAt: row.created_at,
  };
}

export interface EventRepository {
  findById(eventId: string): Promise<EventRecord | null>;
  findBySlug(slug: string): Promise<EventRecord | null>;
  insert(input: InsertRow<'events'>): Promise<EventRecord>;
}

export const eventRepository = defineRepository<EventRepository>((context) => ({
  async findById(eventId) {
    const row = unwrapMaybe(
      await context.client
        .from('events')
        .select(selectColumns('events', EVENT_COLUMNS))
        .eq('id', eventId)
        .maybeSingle(),
      'events.findById',
    );

    return row === null ? null : toEvent(row);
  },

  async findBySlug(slug) {
    const row = unwrapMaybe(
      await context.client
        .from('events')
        .select(selectColumns('events', EVENT_COLUMNS))
        .eq('slug', slug)
        .maybeSingle(),
      'events.findBySlug',
    );

    return row === null ? null : toEvent(row);
  },

  async insert(input) {
    return toEvent(
      unwrap(
        await context.client
          .from('events')
          .insert(input)
          .select(selectColumns('events', EVENT_COLUMNS))
          .single(),
        'events.insert',
      ),
    );
  },
}));

export interface EditionRepository {
  findById(editionId: string): Promise<EditionRecord | null>;
  /** 02_DATA_MODEL §6.2 : une seule édition par couple (event, year). */
  findByEventAndYear(eventId: string, year: number): Promise<EditionRecord | null>;
  listByEvent(eventId: string): Promise<readonly EditionRecord[]>;
  insert(input: InsertRow<'editions'>): Promise<EditionRecord>;
}

export const editionRepository = defineRepository<EditionRepository>((context) => ({
  async findById(editionId) {
    const row = unwrapMaybe(
      await context.client
        .from('editions')
        .select(selectColumns('editions', EDITION_COLUMNS))
        .eq('id', editionId)
        .maybeSingle(),
      'editions.findById',
    );

    return row === null ? null : toEdition(row);
  },

  async findByEventAndYear(eventId, year) {
    const row = unwrapMaybe(
      await context.client
        .from('editions')
        .select(selectColumns('editions', EDITION_COLUMNS))
        .eq('event_id', eventId)
        .eq('year', year)
        .maybeSingle(),
      'editions.findByEventAndYear',
    );

    return row === null ? null : toEdition(row);
  },

  async listByEvent(eventId) {
    const rows = unwrap(
      await context.client
        .from('editions')
        .select(selectColumns('editions', EDITION_COLUMNS))
        .eq('event_id', eventId)
        .order('year', { ascending: false }),
      'editions.listByEvent',
    );

    return rows.map(toEdition);
  },

  async insert(input) {
    return toEdition(
      unwrap(
        await context.client
          .from('editions')
          .insert(input)
          .select(selectColumns('editions', EDITION_COLUMNS))
          .single(),
        'editions.insert',
      ),
    );
  },
}));

export interface RaceRepository {
  findById(raceId: string): Promise<RaceRecord | null>;
  findByEditionAndSlug(editionId: string, slug: string): Promise<RaceRecord | null>;
  listByEdition(editionId: string): Promise<readonly RaceRecord[]>;
  insert(input: InsertRow<'races'>): Promise<RaceRecord>;
  update(raceId: string, patch: UpdateRow<'races'>): Promise<RaceRecord>;
  /**
   * Changement de statut conditionné au statut de départ.
   *
   * Rend `null` si la course n'est plus dans l'état sur lequel le use case a
   * raisonné. Deux administrateurs simultanés ne doivent pas pouvoir
   * enchaîner deux transitions à partir de la même lecture
   * (00_PRODUCT_SPEC §4.1).
   */
  changeStatus(
    raceId: string,
    from: RaceRecord['status'],
    to: RaceRecord['status'],
  ): Promise<RaceRecord | null>;
}

export const raceRepository = defineRepository<RaceRepository>((context) => ({
  async findById(raceId) {
    const row = unwrapMaybe(
      await context.client
        .from('races')
        .select(selectColumns('races', RACE_COLUMNS))
        .eq('id', raceId)
        .maybeSingle(),
      'races.findById',
    );

    return row === null ? null : toRace(row);
  },

  async findByEditionAndSlug(editionId, slug) {
    const row = unwrapMaybe(
      await context.client
        .from('races')
        .select(selectColumns('races', RACE_COLUMNS))
        .eq('edition_id', editionId)
        .eq('slug', slug)
        .maybeSingle(),
      'races.findByEditionAndSlug',
    );

    return row === null ? null : toRace(row);
  },

  async listByEdition(editionId) {
    const rows = unwrap(
      await context.client
        .from('races')
        .select(selectColumns('races', RACE_COLUMNS))
        .eq('edition_id', editionId)
        .order('start_datetime', { ascending: true }),
      'races.listByEdition',
    );

    return rows.map(toRace);
  },

  async insert(input) {
    return toRace(
      unwrap(
        await context.client
          .from('races')
          .insert(input)
          .select(selectColumns('races', RACE_COLUMNS))
          .single(),
        'races.insert',
      ),
    );
  },

  async update(raceId, patch) {
    return toRace(
      unwrap(
        await context.client
          .from('races')
          .update(patch)
          .eq('id', raceId)
          .select(selectColumns('races', RACE_COLUMNS))
          .single(),
        'races.update',
      ),
    );
  },

  async changeStatus(raceId, from, to) {
    const row = unwrapMaybe(
      await context.client
        .from('races')
        .update({ status: to })
        .eq('id', raceId)
        .eq('status', from)
        .select(selectColumns('races', RACE_COLUMNS))
        .maybeSingle(),
      'races.changeStatus',
    );

    return row === null ? null : toRace(row);
  },
}));

/**
 * Journal des transitions de statut.
 *
 * Lecture seule : les lignes sont produites par le trigger
 * `races_journal_status_change` (migration 0006), dans la transaction du
 * changement de statut. Aucune méthode d'écriture n'est exposée — un journal
 * qu'une application peut composer n'atteste plus rien.
 */
export interface RaceStatusTransitionRepository {
  listByRace(raceId: string, limit: number): Promise<readonly RaceStatusTransitionRecord[]>;
  /** Dernière entrée vers `archived` : elle porte le statut d'avant l'archivage. */
  findLastArchival(raceId: string): Promise<RaceStatusTransitionRecord | null>;
}

export const raceStatusTransitionRepository = defineRepository<RaceStatusTransitionRepository>(
  (context) => ({
    async listByRace(raceId, limit) {
      const rows = unwrap(
        await context.client
          .from('race_status_transitions')
          .select(selectColumns('race_status_transitions', TRANSITION_COLUMNS))
          .eq('race_id', raceId)
          .order('created_at', { ascending: false })
          .limit(limit),
        'race_status_transitions.listByRace',
      );

      return rows.map(toTransition);
    },

    async findLastArchival(raceId) {
      const row = unwrapMaybe(
        await context.client
          .from('race_status_transitions')
          .select(selectColumns('race_status_transitions', TRANSITION_COLUMNS))
          .eq('race_id', raceId)
          .eq('to_status', 'archived')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        'race_status_transitions.findLastArchival',
      );

      return row === null ? null : toTransition(row);
    },
  }),
);

/**
 * Identité de l'acteur.
 *
 * Ces deux lectures existent parce que le domaine ne doit jamais croire un
 * rôle annoncé par l'appelant : `platform_role` et le rôle d'organisation
 * sont relus en base à chaque commande (03_PRIVACY_RLS §4, §11, §178).
 */
export interface IdentityRepository {
  findMembership(userId: string, organizationId: string): Promise<MembershipRecord | null>;
  findPlatformIdentity(userId: string): Promise<PlatformIdentityRecord | null>;
}

export const identityRepository = defineRepository<IdentityRepository>((context) => ({
  async findMembership(userId, organizationId) {
    const row = unwrapMaybe(
      await context.client
        .from('organization_members')
        .select(selectColumns('organization_members', ['organization_id', 'user_id', 'role']))
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .maybeSingle(),
      'organization_members.findMembership',
    );

    return row === null
      ? null
      : { organizationId: row.organization_id, userId: row.user_id, role: row.role };
  },

  async findPlatformIdentity(userId) {
    const row = unwrapMaybe(
      await context.client
        .from('users')
        .select(selectColumns('users', ['id', 'platform_role']))
        .eq('id', userId)
        .maybeSingle(),
      'users.findPlatformIdentity',
    );

    return row === null ? null : { id: row.id, platformRole: row.platform_role };
  },
}));

/** Bundle passé aux use cases du domaine (01_ARCHITECTURE §5 : domaine → repositories). */
export interface CourseRepositories {
  readonly events: EventRepository;
  readonly editions: EditionRepository;
  readonly races: RaceRepository;
  readonly raceStatusTransitions: RaceStatusTransitionRepository;
  readonly identity: IdentityRepository;
}

export function createCourseRepositories(context: RepositoryContext): CourseRepositories {
  return {
    events: eventRepository(context),
    editions: editionRepository(context),
    races: raceRepository(context),
    raceStatusTransitions: raceStatusTransitionRepository(context),
    identity: identityRepository(context),
  };
}
