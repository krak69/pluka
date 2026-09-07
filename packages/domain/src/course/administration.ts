import type { EditionRecord, EventRecord, RaceRecord, RaceStatusTransitionRecord } from '@pluka/db';

import { assertPlatformAdmin } from '../authorization/organization-role.js';
import { notFoundError, parseCommand } from '../errors.js';
import {
  getEditionAdministrationQuerySchema,
  getEventAdministrationQuerySchema,
  getRaceAdministrationQuerySchema,
  listEventsForAdministrationQuerySchema,
} from './commands.js';
import type { CourseContext } from './use-cases.js';

/**
 * Lectures d'administration de la base courses — 00_PRODUCT_SPEC §3.5.
 *
 * Séparées des use cases produit parce qu'elles répondent à une autre
 * question : non pas « que puis-je voir en tant que participant ou
 * organisation », mais « que contient la base ». Elles traversent donc les
 * brouillons et les événements sans organisation gestionnaire, et sont
 * réservées à `pluka_admin`.
 *
 * Le rôle est relu en base à chaque appel (03_PRIVACY_RLS §11, §178) — comme
 * partout ailleurs dans ce paquet.
 *
 * §104 en fixe la limite : « le simple statut pluka_admin ne doit pas
 * transformer toutes les données en contenu courant de l'admin UI ». Ces
 * lectures s'arrêtent au référentiel de course. Aucune ne touche à un
 * participant, à un Plan, à une Nutrition ni à une Assistance.
 */

export interface EventAdministration {
  readonly event: EventRecord;
  readonly editions: readonly EditionRecord[];
}

export interface EditionAdministration {
  readonly event: EventRecord;
  readonly edition: EditionRecord;
  readonly races: readonly RaceRecord[];
}

export async function listEventsForAdministration(
  context: CourseContext,
  input: unknown,
): Promise<readonly EventRecord[]> {
  const useCase = 'listEventsForAdministration';
  const query = parseCommand(listEventsForAdministrationQuerySchema, input, useCase);

  await assertPlatformAdmin(context.repositories, context.actor, useCase);

  return context.repositories.events.list(query.limit);
}

export async function getEventAdministration(
  context: CourseContext,
  input: unknown,
): Promise<EventAdministration> {
  const useCase = 'getEventAdministration';
  const query = parseCommand(getEventAdministrationQuerySchema, input, useCase);

  await assertPlatformAdmin(context.repositories, context.actor, useCase);

  const event = await context.repositories.events.findById(query.eventId);
  if (event === null) throw notFoundError(useCase, 'événement');

  return { event, editions: await context.repositories.editions.listByEvent(event.id) };
}

export async function getEditionAdministration(
  context: CourseContext,
  input: unknown,
): Promise<EditionAdministration> {
  const useCase = 'getEditionAdministration';
  const query = parseCommand(getEditionAdministrationQuerySchema, input, useCase);

  await assertPlatformAdmin(context.repositories, context.actor, useCase);

  const edition = await context.repositories.editions.findById(query.editionId);
  if (edition === null) throw notFoundError(useCase, 'édition');

  const event = await context.repositories.events.findById(edition.eventId);
  if (event === null) throw notFoundError(useCase, 'événement');

  return { event, edition, races: await context.repositories.races.listByEdition(edition.id) };
}

export interface RaceAdministration {
  readonly event: EventRecord;
  readonly edition: EditionRecord;
  readonly race: RaceRecord;
  readonly history: readonly RaceStatusTransitionRecord[];
}

/**
 * Épreuve vue depuis l'administration — 00_PRODUCT_SPEC §3.5, §4.1.
 *
 * Distincte de `getRaceOverview`, qui répond à « cette personne peut-elle voir
 * cette course » et rend `not_found` à qui n'y a pas droit. Ici la question
 * est « qu'y a-t-il dans la base », et la réponse à un non-administrateur est
 * un refus franc : l'écran d'administration ne doit pas se comporter comme
 * une page publique.
 */
export async function getRaceAdministration(
  context: CourseContext,
  input: unknown,
): Promise<RaceAdministration> {
  const useCase = 'getRaceAdministration';
  const query = parseCommand(getRaceAdministrationQuerySchema, input, useCase);

  await assertPlatformAdmin(context.repositories, context.actor, useCase);

  const race = await context.repositories.races.findById(query.raceId);
  if (race === null) throw notFoundError(useCase, 'épreuve');

  const edition = await context.repositories.editions.findById(race.editionId);
  if (edition === null) throw notFoundError(useCase, 'édition');

  const event = await context.repositories.events.findById(edition.eventId);
  if (event === null) throw notFoundError(useCase, 'événement');

  return {
    event,
    edition,
    race,
    history: await context.repositories.raceStatusTransitions.listByRace(race.id, query.limit),
  };
}
