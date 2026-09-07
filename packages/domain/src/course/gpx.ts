import type { GpxRepositories, RaceGpxImportRecord } from '@pluka/db';
import { z } from 'zod';

import type { Actor } from '../authorization/organization-role.js';
import { assertOrganizationRole } from '../authorization/organization-role.js';
import { parseCommand, validationError } from '../errors.js';
import { loadRaceScope } from './use-cases.js';

/**
 * Import GPX d'une épreuve — 01_ARCHITECTURE §15, PLAN_ENGINE §8.
 *
 * Le use case ne traite pas le fichier : il le dépose et enfile un job. Tout
 * le reste — parsing, géométrie, prétraitement, micro-segments — appartient au
 * worker, et §15 le veut ainsi : « le GPX brut n'est pas reparsé à chaque
 * recalcul du Plan ». Un import est donc une intention, pas un calcul.
 *
 * L'autorité est celle de l'écriture de contenu de course : `editor` sur
 * l'organisation gestionnaire, ou `pluka_admin`. La même que `createRace` et
 * `updateRace`, et la même que la policy du bucket et la garde de
 * `enqueue_race_gpx` appliquent de leur côté. Trois barrières superposées, et
 * aucune ne délègue à l'autre (03_PRIVACY_RLS §8).
 */

export interface GpxImportContext {
  readonly repositories: GpxRepositories;
  readonly actor: Actor;
}

/** Rôle minimum pour écrire du contenu de course, aligné sur `MIN_WRITE_ROLE`. */
const MIN_IMPORT_ROLE = 'editor';

/**
 * Taille maximale d'un GPX, alignée sur le bucket `race-sources` (0008).
 *
 * Bornée ici aussi pour que le refus soit un `validation` lisible plutôt qu'un
 * échec de transport à 50 Mo transférés.
 */
export const MAX_GPX_BYTES = 52_428_800;

/**
 * Extensions acceptées.
 *
 * Ce n'est pas une validation de contenu : le fichier est jugé par le parseur
 * du worker, qui refusera un XML qui n'est pas un GPX. C'est une garde de
 * saisie — déposer une photo par erreur ne doit pas produire un job voué à
 * échouer une minute plus tard.
 */
const GPX_EXTENSION = /\.gpx$/i;

const contentHash = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{64}$/, { error: 'empreinte SHA-256 attendue, en minuscules' });

export const importRaceGpxCommandSchema = z.object({
  raceId: z.uuid(),
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(GPX_EXTENSION, { error: 'fichier .gpx attendu' }),
  /** Contenu brut du fichier. Le hash en est dérivé par l'appelant, jamais déclaré seul. */
  content: z.string().min(1, { error: 'fichier vide' }),
  contentHash,
});

export type ImportRaceGpxCommand = z.infer<typeof importRaceGpxCommandSchema>;

export const getRaceGpxImportQuerySchema = z.object({ raceId: z.uuid() });
export type GetRaceGpxImportQuery = z.infer<typeof getRaceGpxImportQuerySchema>;

export interface RaceGpxImportReceipt {
  readonly raceId: string;
  readonly storagePath: string;
  readonly sourceSnapshotId: string;
}

/**
 * Dépose un GPX et enfile son traitement.
 *
 * L'ordre compte : le fichier d'abord, l'enfilage ensuite. L'inverse
 * produirait un job dont le worker ne trouverait pas le fichier — un échec
 * transitoire réessayé cinq fois pour rien. Dans ce sens-ci, un enfilage
 * manqué ne laisse qu'un objet orphelin dans le bucket, que le dépôt suivant
 * réécrira au même chemin.
 */
export async function importRaceGpx(
  context: GpxImportContext,
  input: unknown,
): Promise<RaceGpxImportReceipt> {
  const useCase = 'importRaceGpx';
  const command = parseCommand(importRaceGpxCommandSchema, input, useCase);

  if (byteLength(command.content) > MAX_GPX_BYTES) {
    throw validationError(useCase, 'fichier trop volumineux', {
      content: `${MAX_GPX_BYTES} octets au maximum`,
    });
  }

  const scope = await loadRaceScope(context.repositories, command.raceId, useCase);

  await assertOrganizationRole(
    context.repositories,
    context.actor,
    scope.event.organizationId,
    MIN_IMPORT_ROLE,
    useCase,
  );

  const storagePath = await context.repositories.raceGpx.upload({
    raceId: command.raceId,
    contentHash: command.contentHash,
    content: command.content,
  });

  const sourceSnapshotId = await context.repositories.raceGpx.enqueue({
    raceId: command.raceId,
    storagePath,
    contentHash: command.contentHash,
    // Le nom du fichier déposé : c'est ce qu'un réviseur reconnaîtra dans la
    // liste des sources de l'édition.
    title: command.fileName,
  });

  return { raceId: command.raceId, storagePath, sourceSnapshotId };
}

/**
 * Où en est l'import — 01_ARCHITECTURE §22, PLAN_ENGINE §9.
 *
 * Même autorité que le dépôt : savoir qu'un traitement a échoué est une
 * information d'administration de course.
 */
export async function getRaceGpxImport(
  context: GpxImportContext,
  input: unknown,
): Promise<RaceGpxImport> {
  const useCase = 'getRaceGpxImport';
  const query = parseCommand(getRaceGpxImportQuerySchema, input, useCase);

  const scope = await loadRaceScope(context.repositories, query.raceId, useCase);

  await assertOrganizationRole(
    context.repositories,
    context.actor,
    scope.event.organizationId,
    MIN_IMPORT_ROLE,
    useCase,
  );

  const record = await context.repositories.raceGpx.findImport(query.raceId);

  return { ...record, stage: importStage(record), quality: courseQuality(record) };
}

/**
 * Avancement lisible d'un import.
 *
 * Il se déduit de ce qui est présent, dans l'ordre où la chaîne le produit.
 * L'écran n'a donc aucune règle à tenir de son côté : il affiche une étape.
 *
 * `blocked` n'est pas un échec du traitement. §9.1 : la géométrie est valide,
 * c'est le référentiel de parcours qui demande une décision — et sans elle,
 * aucun Plan ne peut être calculé.
 */
export type RaceGpxImportStage =
  'none' | 'queued' | 'running' | 'failed' | 'preprocessing_pending' | 'blocked' | 'completed';

export function importStage(record: RaceGpxImportRecord): RaceGpxImportStage {
  if (record.job === null) return record.source === null ? 'none' : 'queued';

  if (record.job.status === 'failed' || record.job.status === 'cancelled') return 'failed';
  if (record.job.status === 'queued') return 'queued';
  if (record.job.status === 'running') return 'running';

  // Job terminé : c'est le prétraitement qui dit si un Plan est possible.
  if (record.geometry === null) return 'running';
  if (record.geometry.preprocessingStatus === 'blocked') return 'blocked';
  if (record.geometry.preprocessingStatus === 'pending') return 'preprocessing_pending';

  return 'completed';
}

/**
 * Contrôles qualité — PLAN_ENGINE §9, §9.1.
 *
 * Ils sont **lus**, pas recalculés. Le moteur les produit pendant le
 * prétraitement — `qualityWarnings` compare la distance et le D+ mesurés aux
 * valeurs officielles, avec ses propres seuils — et 0026 les persiste avec les
 * micro-segments. Les refaire ici donnerait deux verdicts pour le même écart :
 * le domaine mesurerait sur `length_m`, la longueur brute de la trace, quand
 * le moteur mesure sur le parcours ré-échantillonné. Ils divergeraient.
 *
 * S'y ajoute l'état de blocage de §9.1, qui n'est pas un warning du moteur mais
 * un refus du prétraitement : la géométrie est bonne, le référentiel non.
 *
 * Ce que l'écran montre à côté — D+ mesuré face au D+ déclaré — n'est pas un
 * contrôle mais le fait brut. §9.1 veut que l'écart soit visible, pas résolu.
 */
export interface CourseQualityFinding {
  readonly code: string;
  readonly level: 'warning' | 'error';
  readonly message: string;
}

export function courseQuality(record: RaceGpxImportRecord): readonly CourseQualityFinding[] {
  const findings: CourseQualityFinding[] = (record.geometry?.preprocessingWarnings ?? []).map(
    (warning) => ({
      code: warning.code,
      level: warning.level === 'error' ? 'error' : 'warning',
      message: warning.message,
    }),
  );

  if (record.geometry?.preprocessingStatus === 'blocked') {
    findings.push({
      code: 'PREPROCESSING_BLOCKED',
      level: 'error',
      message: record.geometry.preprocessingIssue ?? 'prétraitement bloqué, motif non enregistré',
    });
  }

  return findings;
}

/**
 * Écart entre une valeur mesurée et la valeur officielle, en pourcentage.
 *
 * Rendu pour l'affichage, jamais pour décider : le verdict appartient aux
 * warnings du moteur. `null` quand la comparaison n'a pas de sens — valeur
 * officielle absente ou nulle, mesure absente.
 */
export function divergenceRatio(
  measured: number | null | undefined,
  official: number | null | undefined,
): number | null {
  if (measured === null || measured === undefined) return null;
  if (official === null || official === undefined || official <= 0) return null;

  return Math.abs(measured - official) / official;
}

export interface RaceGpxImport extends RaceGpxImportRecord {
  readonly stage: RaceGpxImportStage;
  readonly quality: readonly CourseQualityFinding[];
}

/** Taille réelle du contenu, en octets — un GPX est de l'UTF-8, pas de l'ASCII. */
function byteLength(content: string): number {
  return new TextEncoder().encode(content).length;
}
