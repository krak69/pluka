import { z } from 'zod';

import { DbError, type AdminActionsRepositories } from '@pluka/db';

import type { Actor } from '../authorization/organization-role.js';
import {
  forbiddenError,
  invalidStateError,
  notFoundError,
  parseCommand,
  type DomainError,
} from '../errors.js';

/**
 * Écritures de la console d'administration — 03_PRIVACY_RLS.md §55, §91,
 * §104 · migration 0029.
 *
 * Cinq gestes : masquer un contenu signalé, classer un signalement sans suite,
 * relancer un traitement, valider et archiver une fiche nutrition.
 *
 * LA GARDE EST DANS LA FONCTION SQL, ET SEULEMENT LÀ
 *
 * Décision du lot 4b, dans la continuité de 4a : chaque fonction de 0029 est
 * `security definer` et vérifie `platform_role` en première instruction. Ces
 * use cases ne la redoublent pas — une seconde vérification ajouterait un
 * aller-retour sans ajouter de garantie, et ferait croire que retirer l'une
 * des deux serait sans effet.
 *
 * Ce qu'ils apportent : la validation de l'entrée à la frontière, la
 * confirmation explicite des gestes destructeurs, et la traduction des refus
 * de la base en erreurs de domaine typées — `42501` en `forbidden`, `P0002`
 * en `not_found`, `55000` en `invalid_state`.
 *
 * L'AUDIT EST DANS LA MÊME TRANSACTION
 *
 * Aucun de ces use cases n'écrit le journal lui-même : la fonction SQL appelle
 * `private.record_audit` avant de valider. Une écriture réussie est donc
 * toujours journalisée, et un refus ne l'est jamais.
 */

export interface AdminActionsContext {
  readonly repositories: AdminActionsRepositories;
  /**
   * Non consulté : la fonction SQL lit l'acteur dans le jeton (`auth.uid()`),
   * et c'est lui que le journal d'audit désigne.
   */
  readonly actor: Actor;
}

const uuid = z.string().uuid();

/**
 * Confirmation d'un geste destructeur.
 *
 * Revérifiée ici, pas seulement cochée à l'écran : une requête forgée sans la
 * case est refusée par le domaine avant d'atteindre la base.
 */
const confirmed = z.literal(true, { error: 'Cochez la case pour confirmer ce geste.' });

export const hideReportedContentCommandSchema = z.object({ reportId: uuid, confirmed }).strict();

export const dismissReportCommandSchema = z.object({ reportId: uuid }).strict();

export const retryAdminJobCommandSchema = z.object({ jobId: uuid }).strict();

export const validateNutritionProductCommandSchema = z.object({ productId: uuid }).strict();

export const archiveNutritionProductCommandSchema = z
  .object({ productId: uuid, confirmed })
  .strict();

export type HideReportedContentCommand = z.infer<typeof hideReportedContentCommandSchema>;
export type DismissReportCommand = z.infer<typeof dismissReportCommandSchema>;
export type RetryAdminJobCommand = z.infer<typeof retryAdminJobCommandSchema>;
export type ValidateNutritionProductCommand = z.infer<typeof validateNutritionProductCommandSchema>;
export type ArchiveNutritionProductCommand = z.infer<typeof archiveNutritionProductCommandSchema>;

/**
 * Traduit le refus d'une fonction de 0029.
 *
 * `forbidden` ne porte aucun détail (03_PRIVACY_RLS §120). Les autres codes de
 * `DbError` — panne, contrainte — remontent tels quels : ce ne sont pas des
 * décisions du domaine, et les maquiller en refus masquerait une panne.
 */
function translateRefusal(error: unknown, useCase: string, subject: string, refusal: string) {
  if (!(error instanceof DbError)) return error;

  const translated: Partial<Record<DbError['code'], DomainError>> = {
    permission_denied: forbiddenError(useCase),
    not_found: notFoundError(useCase, subject),
    invalid_state: invalidStateError(useCase, refusal),
  };

  return translated[error.code] ?? error;
}

async function run<T>(
  useCase: string,
  subject: string,
  refusal: string,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    throw translateRefusal(error, useCase, subject, refusal);
  }
}

export interface HideReportedContentResult {
  /** Signalements clos par ce geste, celui traité compris. */
  readonly closedReports: number;
}

/**
 * Masque le contenu visé par un signalement.
 *
 * Clôt tous les signalements ouverts sur ce contenu — et, pour un fil, ceux de
 * ses messages — sous une seule entrée d'audit qui les liste. Le contenu n'est
 * pas supprimé.
 */
export async function hideReportedContent(
  context: AdminActionsContext,
  input: unknown,
): Promise<HideReportedContentResult> {
  const useCase = 'hideReportedContent';
  const command = parseCommand(hideReportedContentCommandSchema, input, useCase);

  const closedReports = await run(
    useCase,
    'signalement',
    'ce signalement est déjà traité, ou son contenu n’existe plus',
    () => context.repositories.adminActions.hideReportedContent(command.reportId),
  );

  return { closedReports };
}

/** Classe un signalement sans suite. Ni le contenu ni les autres signalements ne changent. */
export async function dismissReport(context: AdminActionsContext, input: unknown): Promise<void> {
  const useCase = 'dismissReport';
  const command = parseCommand(dismissReportCommandSchema, input, useCase);

  await run(useCase, 'signalement', 'ce signalement est déjà traité', () =>
    context.repositories.adminActions.dismissReport(command.reportId),
  );
}

export interface RetryAdminJobResult {
  /** Numéro de la relance — 1 pour la première. */
  readonly retry: number;
}

/**
 * Relance un traitement en échec.
 *
 * Seul un job `failed` se relance, et la fonction SQL rejoue l'événement
 * d'origine : deux clics produisent une relance et un refus, jamais deux
 * messages de file (01_ARCHITECTURE §22.1).
 */
export async function retryAdminJob(
  context: AdminActionsContext,
  input: unknown,
): Promise<RetryAdminJobResult> {
  const useCase = 'retryAdminJob';
  const command = parseCommand(retryAdminJobCommandSchema, input, useCase);

  const retry = await run(
    useCase,
    'traitement',
    'seul un traitement en échec, dont l’événement d’origine existe, se relance',
    () => context.repositories.adminActions.retryJob(command.jobId),
  );

  return { retry };
}

/** Valide une fiche à vérifier : elle devient trouvable par tous les coureurs. */
export async function validateNutritionProduct(
  context: AdminActionsContext,
  input: unknown,
): Promise<void> {
  const useCase = 'validateNutritionProduct';
  const command = parseCommand(validateNutritionProductCommandSchema, input, useCase);

  await run(useCase, 'fiche', 'seule une fiche à vérifier se valide', () =>
    context.repositories.adminActions.validateNutritionProduct(command.productId),
  );
}

/**
 * Archive une fiche — refus d'une proposition, ou retrait du catalogue.
 *
 * Rien n'est supprimé : une stratégie confirmée garde son instantané
 * (NUTRITION_ENGINE §734). Il n'existe pas de désarchivage.
 */
export async function archiveNutritionProduct(
  context: AdminActionsContext,
  input: unknown,
): Promise<void> {
  const useCase = 'archiveNutritionProduct';
  const command = parseCommand(archiveNutritionProductCommandSchema, input, useCase);

  await run(useCase, 'fiche', 'cette fiche est déjà archivée', () =>
    context.repositories.adminActions.archiveNutritionProduct(command.productId),
  );
}
