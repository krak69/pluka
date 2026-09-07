import { DbError, mapPostgrestError } from '../errors.js';
import { defineRepository, type RepositoryContext } from '../repository.js';
import { unwrap } from '../results.js';
import { identityRepository, type IdentityRepository } from './course.js';
import type { EditionRepository, EventRepository, RaceRepository } from './course.js';
import { editionRepository, eventRepository, raceRepository } from './course.js';
import type { RaceGpxImportRecord } from './records.js';

/**
 * Dépôt d'un GPX et état de son traitement — 01_ARCHITECTURE §15, §22.
 *
 * Deux surfaces, et aucune requête écrite ici :
 *
 * - le fichier passe par le Storage, sous la session de l'utilisateur. La
 *   policy `race_sources__insert__course_editor` (0023) décide, et le chemin
 *   `races/<race_id>/gpx/<hash>.gpx` porte l'épreuve qu'elle interroge ;
 * - l'enfilage et la lecture d'état passent par les fonctions SQL de 0008 et
 *   0023, atomiques par construction (§22.2, §31).
 *
 * Aucune méthode n'écrit dans `sources`, `source_snapshots` ni
 * `ingestion_jobs` : ces trois écritures n'ont de sens qu'ensemble, et c'est
 * `enqueue_race_gpx` qui les tient dans une transaction.
 */

/** Bucket privé des sources de course — 03_PRIVACY_RLS §84. */
export const RACE_SOURCES_BUCKET = 'race-sources';

/**
 * Chemin d'un GPX dans le bucket.
 *
 * Sa forme n'est pas cosmétique : la policy de 0023 en extrait l'épreuve pour
 * décider qui peut écrire. Le construire ici, une fois, évite qu'un appelant
 * en invente un que la base refuserait sans dire pourquoi.
 *
 * Le hash du contenu sert de nom : redéposer le même fichier réécrit le même
 * objet, et `enqueue_race_gpx` reconnaît le doublon (§22.1).
 */
export function raceGpxStoragePath(raceId: string, contentHash: string): string {
  return `races/${raceId}/gpx/${contentHash}.gpx`;
}

export interface UploadRaceGpxInput {
  readonly raceId: string;
  readonly contentHash: string;
  readonly content: string;
}

export interface EnqueueRaceGpxInput {
  readonly raceId: string;
  readonly storagePath: string;
  readonly contentHash: string;
  readonly title: string;
}

export interface RaceGpxRepository {
  /** Dépose le fichier et rend son chemin. La policy du bucket autorise ou refuse. */
  upload(input: UploadRaceGpxInput): Promise<string>;
  /** Source, snapshot, job et événement outbox en une transaction. Rend le snapshot. */
  enqueue(input: EnqueueRaceGpxInput): Promise<string>;
  findImport(raceId: string): Promise<RaceGpxImportRecord>;
}

export const raceGpxRepository = defineRepository<RaceGpxRepository>((context) => ({
  async upload(input) {
    const path = raceGpxStoragePath(input.raceId, input.contentHash);

    const { error } = await context.client.storage
      .from(RACE_SOURCES_BUCKET)
      .upload(path, new Blob([input.content], { type: 'application/gpx+xml' }), {
        contentType: 'application/gpx+xml',
        // Le chemin dérive du contenu : le réécrire ne peut produire que le
        // même fichier. Sans cela, un second dépôt échouerait sur un objet
        // déjà présent, alors qu'il n'y a rien à corriger.
        upsert: true,
      });

    if (error !== null) throw storageError(error, 'race_gpx.upload');

    return path;
  },

  async enqueue(input) {
    const snapshotId = unwrap(
      await context.client.rpc('enqueue_race_gpx', {
        p_race_id: input.raceId,
        p_storage_path: input.storagePath,
        p_content_hash: input.contentHash,
        p_title: input.title,
      }),
      'enqueue_race_gpx',
    );

    return snapshotId;
  },

  async findImport(raceId) {
    const payload = unwrap(
      await context.client.rpc('get_race_gpx_import', { p_race_id: raceId }),
      'get_race_gpx_import',
    );

    return payload as unknown as RaceGpxImportRecord;
  },
}));

/**
 * Traduit une erreur de Storage.
 *
 * Le Storage ne rend pas de `PostgrestError` : son refus de policy arrive en
 * HTTP 403 sans SQLSTATE. On le rapproche donc du code applicatif qui lui
 * correspond, pour qu'un refus d'autorisation se lise comme tel plutôt que
 * comme une panne (voir `mapPostgrestError`).
 */
function storageError(
  error: { message?: string | undefined; statusCode?: string | undefined },
  operation: string,
): DbError {
  const status = Number(error.statusCode ?? 0);

  if (status === 403 || status === 401) {
    return mapPostgrestError({ code: '42501', message: 'dépôt refusé' }, operation);
  }

  return new DbError({
    code: status === 413 ? 'constraint_violation' : 'unavailable',
    operation,
    message: error.message ?? 'dépôt impossible',
    cause: error,
  });
}

/**
 * Dépendances de l'import GPX.
 *
 * La hiérarchie de course y figure parce que l'autorisation la remonte :
 * modifier le contenu d'une épreuve demande un rôle sur l'organisation qui
 * gère son événement (§4.1), et `loadRaceScope` va le chercher.
 */
export interface GpxRepositories {
  readonly raceGpx: RaceGpxRepository;
  readonly races: RaceRepository;
  readonly editions: EditionRepository;
  readonly events: EventRepository;
  readonly identity: IdentityRepository;
}

export function createGpxRepositories(context: RepositoryContext): GpxRepositories {
  return {
    raceGpx: raceGpxRepository(context),
    races: raceRepository(context),
    editions: editionRepository(context),
    events: eventRepository(context),
    identity: identityRepository(context),
  };
}
