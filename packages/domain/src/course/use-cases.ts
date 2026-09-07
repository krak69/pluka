import type {
  CourseRepositories,
  EditionRecord,
  EventRecord,
  RaceRecord,
  RaceStatusTransitionRecord,
} from '@pluka/db';

import {
  assertOrganizationRole,
  assertPlatformAdmin,
  hasOrganizationRole,
  resolveAuthority,
  type Actor,
  type Authority,
} from '../authorization/organization-role.js';
import {
  conflictError,
  forbiddenError,
  invalidStateError,
  notFoundError,
  parseCommand,
  validationError,
} from '../errors.js';
import {
  changeRaceStatusCommandSchema,
  createEditionCommandSchema,
  createEventCommandSchema,
  createRaceCommandSchema,
  getRaceOverviewQuerySchema,
  listRaceStatusHistoryQuerySchema,
  publishRaceCommandSchema,
  setRaceVisibilityCommandSchema,
  updateRaceCommandSchema,
} from './commands.js';
import { checkRacePublication, checkRaceSchedule, isRacePubliclyReadable } from './invariants.js';
import { findRaceTransition, isUnarchiving, type RaceStatus } from './lifecycle.js';

/**
 * Use cases Event / Edition / Race.
 *
 * Chaque commande suit l'ordre de 01_ARCHITECTURE §7 : valider l'entrée,
 * vérifier l'autorisation, appliquer les invariants, écrire.
 *
 * Les rôles ne sont jamais reçus de l'appelant : `context.actor` ne porte
 * qu'un `userId`, et l'autorité est relue en base à chaque commande
 * (03_PRIVACY_RLS §11, §178).
 *
 * Une seule commande écrit dans deux tables — `changeRaceStatus`, dont le
 * journal est alimenté par trigger, donc dans la même transaction que
 * l'`update`. Aucune commande n'a besoin de la frontière transactionnelle
 * applicative laissée ouverte par 01_ARCHITECTURE §31.
 */
export interface CourseContext {
  readonly repositories: CourseRepositories;
  readonly actor: Actor;
}

/**
 * Écriture de contenu de course : rôle `editor` minimum, aligné sur les
 * policies de la migration 0005. La RLS et le use case appliquent la même
 * règle sans se déléguer l'un à l'autre.
 */
const MIN_WRITE_ROLE = 'editor';

export interface RaceScope {
  readonly race: RaceRecord;
  readonly edition: EditionRecord;
  readonly event: EventRecord;
}

/**
 * Dépendances de lecture de la hiérarchie de course.
 *
 * Structurelle : le lot participation remonte la même chaîne pour savoir quelle
 * organisation gère une épreuve, sans dépendre du bundle de ce lot-ci.
 */
export interface RaceScopeRepositories {
  readonly races: Pick<CourseRepositories['races'], 'findById'>;
  readonly editions: Pick<CourseRepositories['editions'], 'findById'>;
  readonly events: Pick<CourseRepositories['events'], 'findById'>;
}

/** Remonte la hiérarchie complète d'une épreuve (02_DATA_MODEL §3.1). */
export async function loadRaceScope(
  repositories: RaceScopeRepositories,
  raceId: string,
  useCase: string,
): Promise<RaceScope> {
  const race = await repositories.races.findById(raceId);
  if (race === null) throw notFoundError(useCase, 'épreuve');

  const edition = await repositories.editions.findById(race.editionId);
  if (edition === null) throw notFoundError(useCase, 'édition');

  const event = await repositories.events.findById(edition.eventId);
  if (event === null) throw notFoundError(useCase, 'événement');

  return { race, edition, event };
}

export async function createEvent(context: CourseContext, input: unknown): Promise<EventRecord> {
  const useCase = 'createEvent';
  const command = parseCommand(createEventCommandSchema, input, useCase);

  await assertOrganizationRole(
    context.repositories,
    context.actor,
    command.organizationId,
    MIN_WRITE_ROLE,
    useCase,
  );

  const existing = await context.repositories.events.findBySlug(command.slug);
  if (existing !== null) throw conflictError(useCase, 'ce slug d’événement est déjà utilisé');

  return context.repositories.events.insert({
    organization_id: command.organizationId,
    name: command.name,
    slug: command.slug,
  });
}

export async function createEdition(
  context: CourseContext,
  input: unknown,
): Promise<EditionRecord> {
  const useCase = 'createEdition';
  const command = parseCommand(createEditionCommandSchema, input, useCase);

  const event = await context.repositories.events.findById(command.eventId);
  if (event === null) throw notFoundError(useCase, 'événement');

  await assertOrganizationRole(
    context.repositories,
    context.actor,
    event.organizationId,
    MIN_WRITE_ROLE,
    useCase,
  );

  // 02_DATA_MODEL §6.2 : une seule édition par couple (event, year).
  const existing = await context.repositories.editions.findByEventAndYear(
    command.eventId,
    command.year,
  );
  if (existing !== null) {
    throw conflictError(useCase, 'cet événement possède déjà une édition pour cette année');
  }

  return context.repositories.editions.insert({
    event_id: command.eventId,
    year: command.year,
    slug: command.slug,
    start_date: command.startDate,
    end_date: command.endDate,
  });
}

export async function createRace(context: CourseContext, input: unknown): Promise<RaceRecord> {
  const useCase = 'createRace';
  const command = parseCommand(createRaceCommandSchema, input, useCase);

  const edition = await context.repositories.editions.findById(command.editionId);
  if (edition === null) throw notFoundError(useCase, 'édition');

  const event = await context.repositories.events.findById(edition.eventId);
  if (event === null) throw notFoundError(useCase, 'événement');

  await assertOrganizationRole(
    context.repositories,
    context.actor,
    event.organizationId,
    MIN_WRITE_ROLE,
    useCase,
  );

  const schedule = checkRaceSchedule({
    startDatetime: command.startDatetime,
    cutoffDatetime: command.cutoffDatetime,
    timezone: command.timezone,
  });
  if (!schedule.ok) {
    throw validationError(useCase, 'horaires incohérents', { raison: schedule.reason });
  }

  const existing = await context.repositories.races.findByEditionAndSlug(
    command.editionId,
    command.slug,
  );
  if (existing !== null) {
    throw conflictError(useCase, 'ce slug d’épreuve existe déjà sur l’édition');
  }

  return context.repositories.races.insert({
    edition_id: command.editionId,
    name: command.name,
    slug: command.slug,
    distance_km: command.distanceKm,
    elevation_gain_m: command.elevationGainM,
    elevation_loss_m: command.elevationLossM,
    start_datetime: command.startDatetime,
    cutoff_datetime: command.cutoffDatetime,
    timezone: command.timezone,
    start_location_name: command.startLocationName,
    finish_location_name: command.finishLocationName,
  });
}

export async function updateRace(context: CourseContext, input: unknown): Promise<RaceRecord> {
  const useCase = 'updateRace';
  const command = parseCommand(updateRaceCommandSchema, input, useCase);

  const scope = await loadRaceScope(context.repositories, command.raceId, useCase);

  await assertOrganizationRole(
    context.repositories,
    context.actor,
    scope.event.organizationId,
    MIN_WRITE_ROLE,
    useCase,
  );

  // Les invariants portent sur l'état résultant, pas sur le patch : ne
  // modifier que la barrière doit rester cohérent avec le départ existant.
  const merged = {
    startDatetime: command.startDatetime ?? scope.race.startDatetime,
    cutoffDatetime:
      command.cutoffDatetime === undefined ? scope.race.cutoffDatetime : command.cutoffDatetime,
    timezone: command.timezone ?? scope.race.timezone,
  };

  const schedule = checkRaceSchedule(merged);
  if (!schedule.ok) {
    throw validationError(useCase, 'horaires incohérents', { raison: schedule.reason });
  }

  return context.repositories.races.update(command.raceId, {
    ...(command.name === undefined ? {} : { name: command.name }),
    ...(command.distanceKm === undefined ? {} : { distance_km: command.distanceKm }),
    ...(command.elevationGainM === undefined ? {} : { elevation_gain_m: command.elevationGainM }),
    ...(command.elevationLossM === undefined ? {} : { elevation_loss_m: command.elevationLossM }),
    ...(command.startDatetime === undefined ? {} : { start_datetime: command.startDatetime }),
    ...(command.cutoffDatetime === undefined ? {} : { cutoff_datetime: command.cutoffDatetime }),
    ...(command.timezone === undefined ? {} : { timezone: command.timezone }),
    ...(command.startLocationName === undefined
      ? {}
      : { start_location_name: command.startLocationName }),
    ...(command.finishLocationName === undefined
      ? {}
      : { finish_location_name: command.finishLocationName }),
  });
}

/**
 * Autorité requise par une transition — traduction du tableau « Qui peut
 * faire quoi » de §4.1.
 *
 * Rendue séparément pour que la règle d'autorisation reste lisible à côté de
 * la table de transitions, plutôt que dispersée dans le use case.
 */
async function assertTransitionAuthority(
  context: CourseContext,
  scope: RaceScope,
  transition: {
    readonly authority: 'organization_editor' | 'organization_admin' | 'platform_admin';
  },
  useCase: string,
): Promise<Authority> {
  if (transition.authority === 'platform_admin') {
    return assertPlatformAdmin(context.repositories, context.actor, useCase);
  }

  const minimum = transition.authority === 'organization_admin' ? 'admin' : 'editor';

  return assertOrganizationRole(
    context.repositories,
    context.actor,
    scope.event.organizationId,
    minimum,
    useCase,
  );
}

/**
 * Changement de statut d'une Race — 00_PRODUCT_SPEC §4.1.
 *
 * L'ordre des vérifications est délibéré. Une appartenance minimale est
 * exigée avant toute autre réponse : sans cela, un inconnu apprendrait par le
 * code d'erreur si une transition est valide, donc dans quel statut se trouve
 * une course qu'il n'a pas le droit de voir (03_PRIVACY_RLS §120).
 */
export async function changeRaceStatus(
  context: CourseContext,
  input: unknown,
): Promise<RaceRecord> {
  const useCase = 'changeRaceStatus';
  const command = parseCommand(changeRaceStatusCommandSchema, input, useCase);

  const scope = await loadRaceScope(context.repositories, command.raceId, useCase);

  // Garde de périmètre : membre de l'organisation gestionnaire, ou admin
  // plateforme. Le rôle exact est vérifié ensuite, selon la transition.
  const authority = await resolveAuthority(
    context.repositories,
    context.actor,
    scope.event.organizationId,
  );
  if (authority === null) throw forbiddenError(useCase);

  const transition = findRaceTransition(scope.race.status, command.status);
  if (transition === null) {
    throw invalidStateError(
      useCase,
      `transition ${scope.race.status} → ${command.status} non autorisée`,
    );
  }

  await assertTransitionAuthority(context, scope, transition, useCase);

  if (command.status === 'published') {
    const verdict = checkRacePublication(scope.race, scope.edition, scope.event);
    if (!verdict.ok) throw invalidStateError(useCase, publicationMessage(verdict.reason));
  }

  if (isUnarchiving(transition)) {
    await assertRestoresPreviousStatus(context, command.raceId, command.status, useCase);
  }

  const updated = await context.repositories.races.changeStatus(
    command.raceId,
    scope.race.status,
    command.status,
  );

  // La course a changé de statut entre la lecture et l'écriture : le use case
  // a raisonné sur un état périmé, et rien ne dit que la transition reste
  // valide depuis le nouveau.
  if (updated === null) {
    throw conflictError(useCase, 'le statut de l’épreuve a changé entre-temps');
  }

  return updated;
}

function publicationMessage(
  reason: 'event_not_published' | 'edition_not_published' | 'race_not_draft',
): string {
  if (reason === 'event_not_published') return 'l’événement doit être publié avant ses épreuves';
  if (reason === 'edition_not_published') return 'l’édition doit être publiée avant ses épreuves';

  return 'seule une épreuve en brouillon peut être publiée';
}

/**
 * §4.1 : le désarchivage est un « retour au statut antérieur à l'archivage ».
 *
 * La cible n'est donc pas au choix de l'appelant — le journal la dicte. Sans
 * entrée d'archivage, la question n'a pas de réponse : refuser vaut mieux que
 * deviner, une course remise en `completed` alors qu'elle avait été annulée
 * réapparaîtrait comme ayant eu lieu.
 */
async function assertRestoresPreviousStatus(
  context: CourseContext,
  raceId: string,
  target: RaceStatus,
  useCase: string,
): Promise<void> {
  const archival = await context.repositories.raceStatusTransitions.findLastArchival(raceId);

  if (archival === null) {
    throw invalidStateError(
      useCase,
      'statut antérieur à l’archivage inconnu : le journal ne porte aucune entrée',
    );
  }

  if (archival.fromStatus !== target) {
    throw invalidStateError(
      useCase,
      `le désarchivage ramène à ${archival.fromStatus}, pas à ${target}`,
    );
  }
}

/** Raccourci de `changeRaceStatus` vers `published`, transition la plus courante. */
export async function publishRace(context: CourseContext, input: unknown): Promise<RaceRecord> {
  const command = parseCommand(publishRaceCommandSchema, input, 'publishRace');

  return changeRaceStatus(context, { raceId: command.raceId, status: 'published' });
}

export async function setRaceVisibility(
  context: CourseContext,
  input: unknown,
): Promise<RaceRecord> {
  const useCase = 'setRaceVisibility';
  const command = parseCommand(setRaceVisibilityCommandSchema, input, useCase);

  const scope = await loadRaceScope(context.repositories, command.raceId, useCase);

  await assertOrganizationRole(
    context.repositories,
    context.actor,
    scope.event.organizationId,
    MIN_WRITE_ROLE,
    useCase,
  );

  return context.repositories.races.update(command.raceId, {
    public_visibility: command.visibility,
  });
}

export interface RaceOverview extends RaceScope {
  readonly publiclyReadable: boolean;
}

/**
 * Lecture d'une épreuve avec sa hiérarchie.
 *
 * Une course non publique reste `not_found` pour qui ne la gère pas :
 * répondre « interdit » confirmerait son existence à partir d'un simple UUID
 * (03_PRIVACY_RLS §120).
 */
export async function getRaceOverview(
  context: CourseContext,
  input: unknown,
): Promise<RaceOverview> {
  const useCase = 'getRaceOverview';
  const query = parseCommand(getRaceOverviewQuerySchema, input, useCase);

  const scope = await loadRaceScope(context.repositories, query.raceId, useCase);
  const publiclyReadable = isRacePubliclyReadable(scope.race, scope.edition, scope.event);

  if (publiclyReadable) return { ...scope, publiclyReadable };

  const authority = await resolveAuthority(
    context.repositories,
    context.actor,
    scope.event.organizationId,
  );
  if (authority === null) throw notFoundError(useCase, 'épreuve');

  return { ...scope, publiclyReadable };
}

/**
 * Historique des changements de statut — §4.1, invariant 4.
 *
 * Réservé à l'organisation gestionnaire et à l'admin plateforme : savoir qui
 * a annulé une course, et quand, est une information interne. Le coureur voit
 * « Annulée », pas la main qui l'a décidé.
 */
export async function listRaceStatusHistory(
  context: CourseContext,
  input: unknown,
): Promise<readonly RaceStatusTransitionRecord[]> {
  const useCase = 'listRaceStatusHistory';
  const query = parseCommand(listRaceStatusHistoryQuerySchema, input, useCase);

  const scope = await loadRaceScope(context.repositories, query.raceId, useCase);

  const authority = await resolveAuthority(
    context.repositories,
    context.actor,
    scope.event.organizationId,
  );
  if (authority === null) throw notFoundError(useCase, 'épreuve');

  if (authority.kind === 'organization_member' && !hasOrganizationRole(authority.role, 'viewer')) {
    throw forbiddenError(useCase);
  }

  return context.repositories.raceStatusTransitions.listByRace(query.raceId, query.limit);
}
