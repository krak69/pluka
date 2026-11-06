import {
  DbError,
  type ParticipantImportRepository,
  type ParticipantImportResult,
  type ParticipantImportView,
} from '@pluka/db';
import { z } from 'zod';

import { invalidStateError, forbiddenError, notFoundError, parseCommand, validationError } from '../errors.js';
import {
  MAX_IMPORT_ROWS,
  PARTICIPANT_FIELDS,
  decodeFile,
  judgeRows,
  parseParticipantFile,
  type ImportRace,
  type ParticipantColumns,
} from './import-file.js';

/**
 * Importer une liste de participants — 00_PRODUCT_SPEC §29.1, 03_PRIVACY_RLS §59.
 *
 * Les rôles sont revérifiés en base : owner et admin seulement. Une organisation
 * ne touche que ses éditions, et la base le redit à chaque geste.
 */

export interface ParticipantImportContext {
  readonly repositories: { readonly participantImports: ParticipantImportRepository };
}

const uuid = z.uuid();

function translate(error: unknown, useCase: string): unknown {
  if (!(error instanceof DbError)) return error;
  if (error.code === 'permission_denied') return forbiddenError(useCase);
  if (error.code === 'not_found') return notFoundError(useCase, 'import');
  if (error.code === 'invalid_state') return invalidStateError(useCase, 'import déjà terminé');
  return error;
}

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export const createParticipantImportCommandSchema = z.object({
  editionId: uuid,
  fileName: z.string().trim().min(1).max(255),
  bytes: z.instanceof(Uint8Array),
});

/** Lire le fichier et ouvrir l'import. Le fichier lui-même n'est pas conservé. */
export async function createParticipantImport(
  context: ParticipantImportContext,
  input: unknown,
): Promise<{ readonly importId: string }> {
  const useCase = 'createParticipantImport';
  const command = parseCommand(createParticipantImportCommandSchema, input, useCase);

  if (command.bytes.byteLength === 0) {
    throw validationError(useCase, 'fichier vide', { file: 'Ce fichier est vide.' });
  }
  if (command.bytes.byteLength > MAX_IMPORT_BYTES) {
    throw validationError(useCase, 'fichier trop lourd', { file: 'Ce fichier dépasse 5 Mo.' });
  }

  const { headers, rows } = parseParticipantFile(decodeFile(command.bytes));
  if (headers.length === 0 || rows.length === 0) {
    throw validationError(useCase, 'fichier sans ligne', {
      file: 'Aucune ligne de participant dans ce fichier.',
    });
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw validationError(useCase, 'trop de lignes', {
      file: `${MAX_IMPORT_ROWS.toLocaleString('fr-FR')} lignes au plus.`,
    });
  }

  try {
    return {
      importId: await context.repositories.participantImports.create(
        command.editionId,
        command.fileName,
        headers,
        rows,
      ),
    };
  } catch (error) {
    throw translate(error, useCase);
  }
}

export async function getParticipantImport(
  context: ParticipantImportContext,
  input: unknown,
): Promise<ParticipantImportView> {
  const useCase = 'getParticipantImport';
  const { importId } = parseCommand(z.object({ importId: uuid }), input, useCase);

  try {
    return await context.repositories.participantImports.find(importId);
  } catch (error) {
    throw translate(error, useCase);
  }
}

const FIELD_KEYS = PARTICIPANT_FIELDS.map((field) => field.key) as [
  (typeof PARTICIPANT_FIELDS)[number]['key'],
  ...(typeof PARTICIPANT_FIELDS)[number]['key'][],
];

export const validateParticipantImportCommandSchema = z.object({
  importId: uuid,
  columns: z.partialRecord(z.enum(FIELD_KEYS), z.string().min(1).max(255)),
  races: z.array(z.object({ id: uuid, name: z.string(), slug: z.string() })).min(1),
});

/** Les colonnes choisies : chaque ligne reçoit son verdict, rien n'est encore importé. */
export async function validateParticipantImport(
  context: ParticipantImportContext,
  input: unknown,
): Promise<void> {
  const useCase = 'validateParticipantImport';
  const command = parseCommand(validateParticipantImportCommandSchema, input, useCase);
  const columns: ParticipantColumns = command.columns;

  const missing = PARTICIPANT_FIELDS.filter(
    (field) => field.required && columns[field.key] === undefined,
  );
  if (missing.length > 0) {
    throw validationError(useCase, 'colonnes manquantes', {
      columns: `À choisir : ${missing.map((field) => field.label).join(', ')}.`,
    });
  }
  if (columns.race === undefined && command.races.length > 1) {
    throw validationError(useCase, 'épreuve manquante', {
      columns: 'À choisir : Épreuve. Cette édition en compte plusieurs.',
    });
  }

  try {
    const view = await context.repositories.participantImports.find(command.importId);
    const judged = judgeRows(view.rows, columns, command.races as readonly ImportRace[]);
    await context.repositories.participantImports.validate(command.importId, columns, judged);
  } catch (error) {
    throw translate(error, useCase);
  }
}

export async function commitParticipantImport(
  context: ParticipantImportContext,
  input: unknown,
): Promise<ParticipantImportResult> {
  const useCase = 'commitParticipantImport';
  const { importId } = parseCommand(z.object({ importId: uuid }), input, useCase);

  try {
    return await context.repositories.participantImports.commit(importId);
  } catch (error) {
    throw translate(error, useCase);
  }
}

export async function discardParticipantImport(
  context: ParticipantImportContext,
  input: unknown,
): Promise<void> {
  const useCase = 'discardParticipantImport';
  const { importId } = parseCommand(z.object({ importId: uuid }), input, useCase);

  try {
    await context.repositories.participantImports.discard(importId);
  } catch (error) {
    throw translate(error, useCase);
  }
}

export const correctParticipantCommandSchema = z.object({
  participantRaceId: uuid,
  bib: z.string().trim().max(30, 'Dossard : 30 caractères au plus.'),
  wave: z.string().trim().max(120, 'Vague : 120 caractères au plus.'),
});

/** Dossard et vague, et rien d'autre. Un champ vidé attend le prochain fichier. */
export async function correctParticipant(
  context: ParticipantImportContext,
  input: unknown,
): Promise<void> {
  const useCase = 'correctParticipant';
  const command = parseCommand(correctParticipantCommandSchema, input, useCase);

  try {
    await context.repositories.participantImports.correct(
      command.participantRaceId,
      command.bib,
      command.wave,
    );
  } catch (error) {
    throw translate(error, useCase);
  }
}

/** Retirer ou rétablir : la base refuse le geste sur un participant rattaché à un compte. */
export async function setParticipantWithdrawn(
  context: ParticipantImportContext,
  input: unknown,
): Promise<void> {
  const useCase = 'setParticipantWithdrawn';
  const { participantRaceId, withdrawn } = parseCommand(
    z.object({ participantRaceId: uuid, withdrawn: z.boolean() }),
    input,
    useCase,
  );

  try {
    await context.repositories.participantImports.setWithdrawn(participantRaceId, withdrawn);
  } catch (error) {
    throw translate(error, useCase);
  }
}

export async function listEditionParticipants(
  context: ParticipantImportContext,
  input: unknown,
) {
  const useCase = 'listEditionParticipants';
  const { editionId } = parseCommand(z.object({ editionId: uuid }), input, useCase);

  try {
    return await context.repositories.participantImports.listParticipants(editionId);
  } catch (error) {
    throw translate(error, useCase);
  }
}
