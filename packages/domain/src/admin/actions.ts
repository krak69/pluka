import { z } from 'zod';

import { DbError, type AdminActionsRepositories } from '@pluka/db';

import type { Actor } from '../authorization/organization-role.js';
import {
  forbiddenError,
  invalidStateError,
  notFoundError,
  parseCommand,
  validationError,
  type DomainError,
} from '../errors.js';

/**
 * Écritures de la console d'administration — 03_PRIVACY_RLS.md §55, §91,
 * §104 · migration 0029.
 *
 * Cinq gestes : masquer un contenu signalé, classer un signalement sans suite,
 * relancer un traitement, valider et archiver une fiche nutrition. Un sixième
 * vient de 0030 : créer une organisation (00_PRODUCT_SPEC §3.5), et un
 * septième de 0031 : l'éditer, et un huitième de 0032 : la supprimer
 * quand elle est vide.
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

/** Même règle que le slug d'un événement (`course/commands.ts`). */
const slug = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { error: 'slug attendu en minuscules, tirets simples' });

const organizationName = z.string().trim().min(1).max(200);
const contactEmail = z.email({ error: 'adresse email invalide' }).nullable().default(null);
const websiteUrl = z
  .url({ protocol: /^https?$/, error: 'adresse web attendue en http(s)://' })
  .nullable()
  .default(null);

export const createOrganizationCommandSchema = z
  .object({ name: organizationName, slug, contactEmail, websiteUrl })
  .strict();

/**
 * Édition — migration 0031. Le slug n'y figure pas : il ne change pas après
 * la création. Les quatre statuts de 0001 sont acceptés ; aucun ne retire
 * d'accès aux membres aujourd'hui.
 */
export const updateOrganizationCommandSchema = z
  .object({
    organizationId: uuid,
    name: organizationName,
    contactEmail,
    websiteUrl,
    status: z.enum(['prospect', 'active', 'suspended', 'archived'], {
      error: 'statut inconnu',
    }),
  })
  .strict();

export type UpdateOrganizationCommand = z.infer<typeof updateOrganizationCommandSchema>;

export const deleteOrganizationCommandSchema = z
  .object({ organizationId: uuid, confirmed })
  .strict();

export type DeleteOrganizationCommand = z.infer<typeof deleteOrganizationCommandSchema>;

/**
 * Migration 0044. `organizationId` nul détache l'événement : il devient
 * « Maintenu par PLUKA ». La confirmation est exigée — le geste déplace
 * l'accès organisateur à l'événement et à ses inscrits.
 */
export const changeEventOrganizationCommandSchema = z
  .object({ eventId: uuid, organizationId: uuid.nullable(), confirmed })
  .strict();

export type ChangeEventOrganizationCommand = z.infer<typeof changeEventOrganizationCommandSchema>;

export type CreateOrganizationCommand = z.infer<typeof createOrganizationCommandSchema>;

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

export interface CreateOrganizationResult {
  readonly organizationId: string;
}

/**
 * Crée une organisation, au statut par défaut de la colonne (`active`, 0001).
 * Elle naît sans membre : rattacher un premier responsable est un autre geste.
 *
 * Un slug déjà pris est rendu contre le champ `slug`, pas en refus global :
 * c'est la seule saisie à corriger.
 */
export async function createOrganization(
  context: AdminActionsContext,
  input: unknown,
): Promise<CreateOrganizationResult> {
  const useCase = 'createOrganization';
  const command = parseCommand(createOrganizationCommandSchema, input, useCase);

  try {
    const organizationId = await context.repositories.adminActions.createOrganization(command);
    return { organizationId };
  } catch (error) {
    if (error instanceof DbError && error.code === 'conflict') {
      throw validationError(useCase, 'slug déjà utilisé', {
        slug: 'ce slug d’organisation est déjà utilisé',
      });
    }

    throw translateRefusal(error, useCase, 'organisation', 'création refusée');
  }
}

export interface UpdateOrganizationResult {
  /** Champs modifiés — 0 quand la saisie reprend la fiche telle quelle. */
  readonly changedFields: number;
}

/** Édite nom, email de contact, site web et statut. Le slug ne change pas. */
export async function updateOrganization(
  context: AdminActionsContext,
  input: unknown,
): Promise<UpdateOrganizationResult> {
  const useCase = 'updateOrganization';
  const command = parseCommand(updateOrganizationCommandSchema, input, useCase);

  const changedFields = await run(useCase, 'organisation', 'édition refusée', () =>
    context.repositories.adminActions.updateOrganization(command),
  );

  return { changedFields };
}

/**
 * Supprime une organisation **vide** — migration 0032.
 *
 * Une organisation qui porte encore un membre, un événement, une source, la
 * provenance d'une information publiée, un droit ou un import est refusée :
 * la supprimer effacerait des accès ou une traçabilité. Elle se termine par
 * le statut « Terminé ». Le refus ne dit pas quelles données restent — la
 * base les nomme dans ses logs, l'écran dit quoi faire.
 */
export async function deleteOrganization(
  context: AdminActionsContext,
  input: unknown,
): Promise<void> {
  const useCase = 'deleteOrganization';
  const command = parseCommand(deleteOrganizationCommandSchema, input, useCase);

  await run(
    useCase,
    'organisation',
    'cette organisation porte encore des données (membres, événements, sources ou droits) : passez-la au statut « Terminé »',
    () => context.repositories.adminActions.deleteOrganization(command.organizationId),
  );
}

export interface ChangeEventOrganizationResult {
  /** `false` quand l'événement était déjà à cette organisation. */
  readonly changed: boolean;
}

/**
 * Change l'organisation qui gère un événement — migration 0044.
 *
 * Super-admin seul : la fonction SQL le vérifie, et un trigger interdit tout
 * autre chemin vers `events.organization_id`. L'ancienne organisation perd
 * l'accès à l'événement et à ses inscrits, la nouvelle le reçoit ; imports,
 * provenance des informations et droits des coureurs ne bougent pas.
 */
export async function changeEventOrganization(
  context: AdminActionsContext,
  input: unknown,
): Promise<ChangeEventOrganizationResult> {
  const useCase = 'changeEventOrganization';
  const command = parseCommand(changeEventOrganizationCommandSchema, input, useCase);

  const changed = await run(
    useCase,
    'événement ou organisation',
    'changement d’organisation refusé',
    () =>
      context.repositories.adminActions.changeEventOrganization(
        command.eventId,
        command.organizationId,
      ),
  );

  return { changed };
}
