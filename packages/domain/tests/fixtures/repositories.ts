import type {
  CourseRepositories,
  EditionRecord,
  EventRecord,
  MembershipRecord,
  PlatformIdentityRecord,
  RaceRecord,
  RaceStatusTransitionRecord,
} from '@pluka/db';

/**
 * Repositories en mémoire.
 *
 * Ils implémentent les mêmes interfaces que `@pluka/db` : les use cases
 * testés ici sont exactement ceux qui tourneront en production, sans base ni
 * réseau. On ne simule que les dépendances, jamais la fonction testée.
 *
 * Le fake reproduit deux comportements que le domaine tient pour acquis, et
 * qui viennent en réalité de PostgreSQL :
 *
 * - `changeStatus` est un compare-and-set : il ne rend rien si le statut de
 *   départ ne correspond plus ;
 * - un changement de statut alimente le journal, comme le trigger
 *   `races_journal_status_change` de la migration 0006.
 *
 * Sans le second, les tests de désarchivage passeraient sur un journal vide
 * et ne prouveraient rien.
 */
export interface FakeState {
  events: EventRecord[];
  editions: EditionRecord[];
  races: RaceRecord[];
  transitions: RaceStatusTransitionRecord[];
  memberships: MembershipRecord[];
  identities: PlatformIdentityRecord[];
}

export const ORG_A = 'aaaaaaaa-0000-4000-8000-000000000001';
export const ORG_B = 'aaaaaaaa-0000-4000-8000-000000000002';
export const EVENT_ID = 'aaaaaaaa-0000-4000-8000-000000000011';
export const EDITION_ID = 'aaaaaaaa-0000-4000-8000-000000000012';
export const RACE_ID = 'aaaaaaaa-0000-4000-8000-000000000013';
/** Événement sans organisation gestionnaire : administrable par `pluka_admin` seul (§4.1). */
export const ORPHAN_EVENT_ID = 'aaaaaaaa-0000-4000-8000-000000000021';
export const ORPHAN_EDITION_ID = 'aaaaaaaa-0000-4000-8000-000000000022';
export const ORPHAN_RACE_ID = 'aaaaaaaa-0000-4000-8000-000000000023';

export const OWNER_A = '33333333-3333-4333-8333-333333333333';
export const ADMIN_A = '44444444-4444-4444-8444-444444444444';
export const EDITOR_A = '55555555-5555-4555-8555-555555555555';
export const VIEWER_A = '66666666-6666-4666-8666-666666666666';
export const OWNER_B = '77777777-7777-4777-8777-777777777777';
export const PLUKA_ADMIN = '88888888-8888-4888-8888-888888888888';
export const OUTSIDER = '11111111-1111-4111-8111-111111111111';

export function baseState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    events: [
      {
        id: EVENT_ID,
        organizationId: ORG_A,
        name: 'Trail de Test',
        slug: 'trail-de-test',
        status: 'published',
      },
      {
        id: ORPHAN_EVENT_ID,
        organizationId: null,
        name: 'Trail Communautaire',
        slug: 'trail-communautaire',
        status: 'published',
      },
    ],
    editions: [
      {
        id: EDITION_ID,
        eventId: EVENT_ID,
        year: 2026,
        slug: 'trail-de-test-2026',
        startDate: '2026-06-20',
        endDate: null,
        status: 'published',
      },
      {
        id: ORPHAN_EDITION_ID,
        eventId: ORPHAN_EVENT_ID,
        year: 2026,
        slug: 'trail-communautaire-2026',
        startDate: '2026-08-15',
        endDate: null,
        status: 'published',
      },
    ],
    races: [
      {
        id: RACE_ID,
        editionId: EDITION_ID,
        name: '80K',
        slug: '80k',
        distanceKm: 80,
        elevationGainM: 4200,
        elevationLossM: 4200,
        startDatetime: '2026-06-20T04:00:00Z',
        cutoffDatetime: '2026-06-21T04:00:00Z',
        timezone: 'Europe/Paris',
        startLocationName: 'Val Test',
        finishLocationName: 'Val Test',
        status: 'draft',
        publicVisibility: 'private',
      },
      {
        id: ORPHAN_RACE_ID,
        editionId: ORPHAN_EDITION_ID,
        name: '30K',
        slug: '30k',
        distanceKm: 30,
        elevationGainM: 1200,
        elevationLossM: 1200,
        startDatetime: '2026-08-15T05:00:00Z',
        cutoffDatetime: null,
        timezone: 'Europe/Paris',
        startLocationName: null,
        finishLocationName: null,
        status: 'draft',
        publicVisibility: 'private',
      },
    ],
    transitions: [],
    memberships: [
      { organizationId: ORG_A, userId: OWNER_A, role: 'owner' },
      { organizationId: ORG_A, userId: ADMIN_A, role: 'admin' },
      { organizationId: ORG_A, userId: EDITOR_A, role: 'editor' },
      { organizationId: ORG_A, userId: VIEWER_A, role: 'viewer' },
      { organizationId: ORG_B, userId: OWNER_B, role: 'owner' },
    ],
    identities: [
      { id: OWNER_A, platformRole: 'user' },
      { id: ADMIN_A, platformRole: 'user' },
      { id: EDITOR_A, platformRole: 'user' },
      { id: VIEWER_A, platformRole: 'user' },
      { id: OWNER_B, platformRole: 'user' },
      { id: OUTSIDER, platformRole: 'user' },
      { id: PLUKA_ADMIN, platformRole: 'pluka_admin' },
    ],
    ...overrides,
  };
}

let sequence = 0;

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}${String(sequence).padStart(12, '0')}`;
}

/** Horloge monotone du fake : le journal doit pouvoir s'ordonner. */
let clock = 0;

function nextInstant(): string {
  clock += 1000;
  return new Date(Date.UTC(2026, 0, 1) + clock).toISOString();
}

export function createFakeRepositories(state: FakeState): CourseRepositories {
  return {
    events: {
      findById: async (id) => state.events.find((event) => event.id === id) ?? null,
      findBySlug: async (slug) => state.events.find((event) => event.slug === slug) ?? null,
      insert: async (input) => {
        const record: EventRecord = {
          id: nextId('bbbbbbbb-0000-4000-8000-'),
          organizationId: input.organization_id ?? null,
          name: input.name,
          slug: input.slug,
          status: input.status ?? 'draft',
        };
        state.events.push(record);
        return record;
      },
    },

    editions: {
      findById: async (id) => state.editions.find((edition) => edition.id === id) ?? null,
      findByEventAndYear: async (eventId, year) =>
        state.editions.find((edition) => edition.eventId === eventId && edition.year === year) ??
        null,
      listByEvent: async (eventId) =>
        state.editions
          .filter((edition) => edition.eventId === eventId)
          .sort((left, right) => right.year - left.year),
      insert: async (input) => {
        const record: EditionRecord = {
          id: nextId('cccccccc-0000-4000-8000-'),
          eventId: input.event_id,
          year: input.year,
          slug: input.slug,
          startDate: input.start_date,
          endDate: input.end_date ?? null,
          status: input.status ?? 'draft',
        };
        state.editions.push(record);
        return record;
      },
    },

    races: {
      findById: async (id) => state.races.find((race) => race.id === id) ?? null,
      findByEditionAndSlug: async (editionId, slug) =>
        state.races.find((race) => race.editionId === editionId && race.slug === slug) ?? null,
      listByEdition: async (editionId) =>
        state.races
          .filter((race) => race.editionId === editionId)
          .sort((left, right) => left.startDatetime.localeCompare(right.startDatetime)),
      insert: async (input) => {
        const record: RaceRecord = {
          id: nextId('dddddddd-0000-4000-8000-'),
          editionId: input.edition_id,
          name: input.name,
          slug: input.slug,
          distanceKm: input.distance_km,
          elevationGainM: input.elevation_gain_m ?? null,
          elevationLossM: input.elevation_loss_m ?? null,
          startDatetime: input.start_datetime,
          cutoffDatetime: input.cutoff_datetime ?? null,
          timezone: input.timezone ?? 'Europe/Paris',
          startLocationName: input.start_location_name ?? null,
          finishLocationName: input.finish_location_name ?? null,
          status: input.status ?? 'draft',
          publicVisibility: input.public_visibility ?? 'private',
        };
        state.races.push(record);
        return record;
      },
      update: async (raceId, patch) => {
        const index = state.races.findIndex((race) => race.id === raceId);
        if (index < 0) throw new Error(`race absente du fake : ${raceId}`);

        const current = state.races[index] as RaceRecord;
        const updated: RaceRecord = {
          ...current,
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.distance_km === undefined ? {} : { distanceKm: patch.distance_km }),
          ...(patch.elevation_gain_m === undefined
            ? {}
            : { elevationGainM: patch.elevation_gain_m }),
          ...(patch.elevation_loss_m === undefined
            ? {}
            : { elevationLossM: patch.elevation_loss_m }),
          ...(patch.start_datetime === undefined ? {} : { startDatetime: patch.start_datetime }),
          ...(patch.cutoff_datetime === undefined ? {} : { cutoffDatetime: patch.cutoff_datetime }),
          ...(patch.timezone === undefined ? {} : { timezone: patch.timezone }),
          ...(patch.start_location_name === undefined
            ? {}
            : { startLocationName: patch.start_location_name }),
          ...(patch.finish_location_name === undefined
            ? {}
            : { finishLocationName: patch.finish_location_name }),
          ...(patch.public_visibility === undefined
            ? {}
            : { publicVisibility: patch.public_visibility }),
        };

        state.races[index] = updated;
        return updated;
      },
      changeStatus: async (raceId, from, to) => {
        const index = state.races.findIndex((race) => race.id === raceId);
        if (index < 0) return null;

        const current = state.races[index] as RaceRecord;
        // Compare-and-set : `.eq('status', from)` côté PostgREST.
        if (current.status !== from) return null;

        const updated: RaceRecord = { ...current, status: to };
        state.races[index] = updated;

        // Le trigger de la migration 0006, reproduit ici.
        state.transitions.push({
          id: nextId('eeeeeeee-0000-4000-8000-'),
          raceId,
          fromStatus: from,
          toStatus: to,
          actorUserId: null,
          createdAt: nextInstant(),
        });

        return updated;
      },
    },

    raceStatusTransitions: {
      listByRace: async (raceId, limit) =>
        state.transitions
          .filter((transition) => transition.raceId === raceId)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
          .slice(0, limit),
      findLastArchival: async (raceId) =>
        state.transitions
          .filter(
            (transition) => transition.raceId === raceId && transition.toStatus === 'archived',
          )
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null,
    },

    identity: {
      findMembership: async (userId, organizationId) =>
        state.memberships.find(
          (membership) =>
            membership.userId === userId && membership.organizationId === organizationId,
        ) ?? null,
      findPlatformIdentity: async (userId) =>
        state.identities.find((identity) => identity.id === userId) ?? null,
    },
  };
}
