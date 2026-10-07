import { z } from 'zod';

import {
  DbError,
  type EditionDocumentsRecord,
  type EventDiscoveryRecord,
  type EventDiscoveryRepositories,
} from '@pluka/db';

import type { Actor } from '../authorization/organization-role.js';
import {
  DomainError,
  forbiddenError,
  invalidStateError,
  notFoundError,
  parseCommand,
  validationError,
} from '../errors.js';

/**
 * Création classique d'un événement, inventaire de son site, documents —
 * migrations 0040 et 0042, décision produit du 2026-10-07.
 *
 * Quatre étapes saisies par l'administrateur : événement, édition, épreuves,
 * puis documents. Les trois premières partent en une commande, une
 * transaction. Si un site officiel est donné, la base enfile son inventaire
 * — pages et documents liés, lus sans IA — que l'étape 4 propose à
 * l'analyse. L'IA n'intervient que dans l'extraction des sources choisies.
 *
 * La garde (administration qui écrit) et l'audit sont dans les fonctions SQL.
 * Ce module valide à la frontière et relit l'inventaire `jsonb` contre un
 * schéma : il vient du worker, donc d'au-delà d'une frontière.
 */

export interface EventDiscoveryContext {
  readonly repositories: EventDiscoveryRepositories;
  /** Non consulté : la base lit l'acteur dans le jeton. */
  readonly actor: Actor;
}

// ------------------------------------------------------------
// L'inventaire, relu
// ------------------------------------------------------------

const inventorySchema = z.object({
  version: z.string(),
  siteUrl: z.string(),
  finalUrl: z.string(),
  siteTitle: z.string().nullable(),
  pages: z
    .array(
      z.object({
        url: z.string(),
        title: z.string().nullable(),
        suggested: z.boolean().catch(false),
      }),
    )
    .catch([]),
  documents: z
    .array(
      z.object({
        url: z.string(),
        title: z.string(),
        kind: z.enum(['pdf', 'gpx']),
        foundOn: z.string(),
        suggested: z.boolean().catch(false),
      }),
    )
    .catch([]),
});

export type SiteInventoryView = z.infer<typeof inventorySchema>;

export interface EventDiscoveryView extends Omit<EventDiscoveryRecord, 'inventory'> {
  /** Nul avant la fin de la lecture, ou s'il ne se relit pas : jamais réparé. */
  readonly inventory: SiteInventoryView | null;
}

// ------------------------------------------------------------
// Commandes
// ------------------------------------------------------------

const uuid = z.uuid();
const slug = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { error: 'slug attendu en minuscules, tirets simples' });
const name = z.string().trim().min(1, { error: 'obligatoire' }).max(200);
const isoDate = z.iso.date({ error: 'date attendue' });
const httpUrl = z.url({ protocol: /^https?$/, error: 'adresse http(s) attendue' }).max(2048);

/** Fuseau IANA connu de l'environnement — la base le revérifie contre les siens. */
const timezone = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat('fr-FR', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { error: 'fuseau horaire inconnu' },
  );

export const createEventWithEditionCommandSchema = z
  .object({
    event: z.object({
      name,
      slug,
      organizationId: uuid.nullable(),
      city: z.string().trim().max(120).nullable(),
      officialWebsiteUrl: httpUrl.nullable(),
    }),
    edition: z
      .object({
        year: z.number({ error: 'année attendue' }).int().min(2000).max(2200),
        slug,
        startDate: isoDate,
        endDate: isoDate.nullable(),
      })
      .refine((edition) => edition.endDate === null || edition.endDate >= edition.startDate, {
        error: 'la fin précède le début',
        path: ['endDate'],
      }),
    races: z
      .array(
        z.object({
          name,
          slug,
          distanceKm: z.number({ error: 'distance attendue' }).positive().max(2000),
          elevationGainM: z.number().int().min(0).max(50000).nullable(),
          startDate: isoDate,
          startTime: z
            .string()
            .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, { error: 'heure attendue, HH:MM' }),
          timezone,
        }),
      )
      .max(20),
  })
  .refine(
    (command) => new Set(command.races.map((race) => race.slug)).size === command.races.length,
    { error: 'deux épreuves ont le même slug', path: ['races', 'slug'] },
  );

export type CreateEventWithEditionCommand = z.infer<typeof createEventWithEditionCommandSchema>;

export const addEditionDocumentsCommandSchema = z.object({
  editionId: uuid,
  documents: z
    .array(
      z.object({
        url: httpUrl,
        title: z.string().trim().min(1).max(300),
        kind: z.enum(['pdf', 'page']),
        raceId: uuid.nullable(),
      }),
    )
    .min(1, { error: 'aucun document choisi' })
    .max(60),
});

/** Même borne que le bucket `race-sources` (0008). */
export const MAX_DOCUMENT_BYTES = 52_428_800;

export const addEditionFileCommandSchema = z.object({
  editionId: uuid,
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/\.pdf$/i, { error: 'fichier .pdf attendu' }),
  bytes: z.instanceof(Uint8Array),
  /** Calculée par l'appelant sur les octets reçus, jamais déclarée par le navigateur. */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  raceId: uuid.nullable(),
});

const eventQuerySchema = z.object({ eventId: uuid });

// ------------------------------------------------------------
// Use cases
// ------------------------------------------------------------

function translate(error: unknown, useCase: string, subject: string): unknown {
  if (!(error instanceof DbError)) return error;

  const translated: Partial<Record<DbError['code'], DomainError>> = {
    permission_denied: forbiddenError(useCase),
    not_found: notFoundError(useCase, subject),
    invalid_state: invalidStateError(useCase, 'cet événement n’a pas de site officiel'),
  };
  return translated[error.code] ?? error;
}

/** Étapes 1 à 3 : événement, édition, épreuves — et l'inventaire du site s'il est donné. */
export async function createEventWithEdition(
  context: EventDiscoveryContext,
  input: unknown,
): Promise<{ readonly eventId: string }> {
  const useCase = 'createEventWithEdition';
  const command = parseCommand(createEventWithEditionCommandSchema, input, useCase);

  try {
    return { eventId: await context.repositories.eventDiscovery.createEvent(command) };
  } catch (error) {
    if (error instanceof DbError && error.code === 'conflict') {
      throw validationError(useCase, 'slug déjà utilisé', {
        'event.slug': 'ce slug d’événement est déjà utilisé',
      });
    }
    throw translate(error, useCase, 'organisation');
  }
}

export async function getEventInventory(
  context: EventDiscoveryContext,
  input: unknown,
): Promise<EventDiscoveryView | null> {
  const useCase = 'getEventInventory';
  const { eventId } = parseCommand(eventQuerySchema, input, useCase);

  try {
    const record = await context.repositories.eventDiscovery.latestDiscovery(eventId);
    if (record === null) return null;
    const parsed = inventorySchema.safeParse(record.inventory);
    return { ...record, inventory: parsed.success ? parsed.data : null };
  } catch (error) {
    throw translate(error, useCase, 'événement');
  }
}

export async function refreshEventInventory(
  context: EventDiscoveryContext,
  input: unknown,
): Promise<{ readonly discoveryId: string }> {
  const useCase = 'refreshEventInventory';
  const { eventId } = parseCommand(eventQuerySchema, input, useCase);

  try {
    return { discoveryId: await context.repositories.eventDiscovery.refreshDiscovery(eventId) };
  } catch (error) {
    throw translate(error, useCase, 'événement');
  }
}

export async function addEditionDocuments(
  context: EventDiscoveryContext,
  input: unknown,
): Promise<{ readonly created: number }> {
  const useCase = 'addEditionDocuments';
  const command = parseCommand(addEditionDocumentsCommandSchema, input, useCase);

  try {
    return {
      created: await context.repositories.eventDiscovery.addDocuments(
        command.editionId,
        command.documents,
      ),
    };
  } catch (error) {
    throw translate(error, useCase, 'édition');
  }
}

export async function addEditionFile(
  context: EventDiscoveryContext,
  input: unknown,
): Promise<{ readonly sourceId: string }> {
  const useCase = 'addEditionFile';
  const command = parseCommand(addEditionFileCommandSchema, input, useCase);

  if (command.bytes.byteLength === 0) {
    throw validationError(useCase, 'fichier vide', { file: 'fichier vide' });
  }
  if (command.bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw validationError(useCase, 'fichier trop volumineux', { file: '50 Mo au maximum' });
  }
  // `%PDF-` : un fichier renommé en .pdf n'est pas un PDF, et le parseur le
  // refuserait plus tard, loin de l'écran qui peut le dire.
  const magic = String.fromCharCode(...command.bytes.slice(0, 5));
  if (magic !== '%PDF-') {
    throw validationError(useCase, 'ce fichier n’est pas un PDF', { file: 'PDF attendu' });
  }

  try {
    const sourceId = await context.repositories.eventDiscovery.addFile({
      editionId: command.editionId,
      title: command.fileName.replace(/\.pdf$/i, ''),
      contentHash: command.contentHash,
      bytes: command.bytes,
      raceId: command.raceId,
    });
    return { sourceId };
  } catch (error) {
    throw translate(error, useCase, 'édition');
  }
}

export async function listEditionDocuments(
  context: EventDiscoveryContext,
  input: unknown,
): Promise<EditionDocumentsRecord> {
  const useCase = 'listEditionDocuments';
  const { editionId } = parseCommand(z.object({ editionId: uuid }), input, useCase);

  try {
    return await context.repositories.eventDiscovery.listDocuments(editionId);
  } catch (error) {
    throw translate(error, useCase, 'édition');
  }
}
