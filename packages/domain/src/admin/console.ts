import { z } from 'zod';

import type {
  AdminAuditEntryRecord,
  AdminConsoleRepositories,
  AdminFactCandidateRecord,
  AdminJobRecord,
  AdminNutritionProductRecord,
  AdminOrganizationDetailRecord,
  AdminOrganizationRecord,
  AdminPlatformCountersRecord,
  AdminReportDetailRecord,
  AdminReportRecord,
  AdminSourceRecord,
  AdminUserDetailRecord,
  AdminUserRecord,
} from '@pluka/db';

import type { Actor } from '../authorization/organization-role.js';
import { notFoundError, parseCommand } from '../errors.js';

/**
 * Console d'administration — 03_PRIVACY_RLS.md §8, §104 · migration 0028.
 *
 * Onze lectures, onze écrans. Chacune passe par une fonction SQL
 * `security definer` qui contourne la RLS et **porte elle-même sa condition
 * d'accès** : ces use cases ne réappliquent donc pas `assertPlatformAdmin`.
 *
 * Ce n'est pas un relâchement, c'est le motif déjà posé par
 * `listCandidatesForReview` : quand l'autorisation vit dans la fonction, la
 * dédoubler dans le domaine ajoute un aller-retour sans ajouter de garantie —
 * et fait croire, à tort, que retirer l'une des deux serait sans effet. Un
 * non-admin reçoit `42501`, que `mapPostgrestError` traduit en refus.
 *
 * Ce que ces use cases apportent en revanche : la validation des entrées à la
 * frontière (01_ARCHITECTURE §32), et le fait que l'application ne connaisse
 * ni le nom d'une fonction SQL ni celui d'une table.
 *
 * LECTURE SEULE
 *
 * Aucune écriture ici. Les actions d'administration — relancer un traitement,
 * modérer un signalement, valider ou archiver un produit — vivent dans
 * `actions.ts` (migration 0029), branchées sur `private.record_audit`.
 */

export interface AdminConsoleContext {
  readonly repositories: AdminConsoleRepositories;
  /**
   * L'acteur n'est pas consulté par ces use cases.
   *
   * Il figure dans le contexte parce que toutes les fonctions SQL le lisent
   * elles-mêmes depuis le jeton — `auth.uid()` — et qu'un contexte
   * d'administration sans acteur laisserait croire à une lecture anonyme.
   */
  readonly actor: Actor;
}

const limit = z.number().int().min(1).max(500);
const uuid = z.string().uuid();

export const listAdminOrganizationsQuerySchema = z.object({ limit: limit.default(100) }).strict();

export const listAdminSourcesQuerySchema = z.object({ limit: limit.default(100) }).strict();

export const listAdminNutritionProductsQuerySchema = z
  .object({
    status: z.enum(['draft', 'validated', 'archived']).nullable().default(null),
    limit: limit.default(200),
  })
  .strict();

export const listAdminReportsQuerySchema = z.object({ limit: limit.default(100) }).strict();

export const getAdminReportQuerySchema = z.object({ reportId: uuid }).strict();

export const searchAdminUsersQuerySchema = z
  .object({
    /** Vide ou absent : les plus récents, sans filtre. */
    query: z.string().trim().max(200).nullable().default(null),
    limit: limit.default(50),
  })
  .strict();

export const getAdminOrganizationQuerySchema = z.object({ organizationId: uuid }).strict();

export const getAdminUserQuerySchema = z.object({ userId: uuid }).strict();

export const listAdminJobsQuerySchema = z.object({ limit: limit.default(100) }).strict();

export const listAdminAuditQuerySchema = z.object({ limit: limit.default(200) }).strict();

export const listAdminFactCandidatesQuerySchema = z.object({ limit: limit.default(100) }).strict();

/** Cardinalités de la vue d'ensemble — aucune donnée personnelle, aucun audit. */
export async function getAdminPlatformCounters(
  context: AdminConsoleContext,
): Promise<AdminPlatformCountersRecord> {
  return context.repositories.adminConsole.platformCounters();
}

/** Organisations, tous statuts — `organizations__select__active` n'ouvre que les actives. */
export async function listAdminOrganizations(
  context: AdminConsoleContext,
  input: unknown = {},
): Promise<readonly AdminOrganizationRecord[]> {
  const query = parseCommand(listAdminOrganizationsQuerySchema, input, 'listAdminOrganizations');

  return context.repositories.adminConsole.listOrganizations(query.limit);
}

/** Fiche d'une organisation, tous statuts — migration 0031. Non auditée. */
export async function getAdminOrganization(
  context: AdminConsoleContext,
  input: unknown,
): Promise<AdminOrganizationDetailRecord> {
  const useCase = 'getAdminOrganization';
  const query = parseCommand(getAdminOrganizationQuerySchema, input, useCase);

  const organization = await context.repositories.adminConsole.getOrganization(
    query.organizationId,
  );
  if (organization === null) throw notFoundError(useCase, 'organisation');

  return organization;
}

/** Sources, toutes éditions — y compris celles d'un événement non publié. */
export async function listAdminSources(
  context: AdminConsoleContext,
  input: unknown = {},
): Promise<readonly AdminSourceRecord[]> {
  const query = parseCommand(listAdminSourcesQuerySchema, input, 'listAdminSources');

  return context.repositories.adminConsole.listSources(query.limit);
}

/**
 * Produits nutrition, tous statuts.
 *
 * `nutrition_products__select__validated` n'ouvre que les `validated` : sans
 * cette lecture, l'onglet « À vérifier » porterait sur des lignes que personne
 * ne peut voir.
 */
export async function listAdminNutritionProducts(
  context: AdminConsoleContext,
  input: unknown = {},
): Promise<readonly AdminNutritionProductRecord[]> {
  const query = parseCommand(
    listAdminNutritionProductsQuerySchema,
    input,
    'listAdminNutritionProducts',
  );

  return context.repositories.adminConsole.listNutritionProducts(query.status, query.limit);
}

/**
 * File de triage des signalements.
 *
 * Motif, statut, dates. Ni contenu signalé, ni déclarant : un signalement met
 * en cause deux personnes, et la file n'a besoin d'aucune des deux pour être
 * triée.
 */
export async function listAdminReports(
  context: AdminConsoleContext,
  input: unknown = {},
): Promise<readonly AdminReportRecord[]> {
  const query = parseCommand(listAdminReportsQuerySchema, input, 'listAdminReports');

  return context.repositories.adminConsole.listReports(query.limit);
}

/**
 * Détail d'un signalement — lecture de données personnelles.
 *
 * La fonction SQL écrit `report.read` dans le journal d'audit avant de rendre
 * quoi que ce soit : §104 veut un accès « justifié ; audité », et la trace
 * précède la lecture plutôt que de la suivre.
 */
export async function getAdminReport(
  context: AdminConsoleContext,
  input: unknown,
): Promise<AdminReportDetailRecord> {
  const useCase = 'getAdminReport';
  const query = parseCommand(getAdminReportQuerySchema, input, useCase);

  const report = await context.repositories.adminConsole.getReport(query.reportId);
  if (report === null) throw notFoundError(useCase, 'signalement');

  return report;
}

/**
 * Recherche d'utilisateurs — lecture de données personnelles.
 *
 * Auditée comme la fiche : une liste d'identités est une donnée personnelle.
 * La trace porte le terme cherché et le nombre de correspondances, jamais les
 * personnes trouvées.
 */
export async function searchAdminUsers(
  context: AdminConsoleContext,
  input: unknown = {},
): Promise<readonly AdminUserRecord[]> {
  const query = parseCommand(searchAdminUsersQuerySchema, input, 'searchAdminUsers');

  return context.repositories.adminConsole.searchUsers(query.query, query.limit);
}

/**
 * Fiche d'un utilisateur — lecture de données personnelles.
 *
 * Identité, droits commerciaux, nombre de courses. Aucun Plan, aucune
 * Nutrition, aucune Assistance, aucune sortie : les quatre interdictions valent
 * aussi pour l'administration, et la suite pgTAP 17 le rejoue sur ces
 * fonctions.
 */
export async function getAdminUser(
  context: AdminConsoleContext,
  input: unknown,
): Promise<AdminUserDetailRecord> {
  const useCase = 'getAdminUser';
  const query = parseCommand(getAdminUserQuerySchema, input, useCase);

  const user = await context.repositories.adminConsole.getUser(query.userId);
  if (user === null) throw notFoundError(useCase, 'utilisateur');

  return user;
}

/**
 * File des traitements — statut, erreur, clé d'idempotence.
 *
 * `private.ingestion_jobs` reste `service only` (§8) : cette lecture est son
 * seul chemin, et c'est ce qui remplace l'ouverture de psql quand un import
 * échoue.
 */
export async function listAdminJobs(
  context: AdminConsoleContext,
  input: unknown = {},
): Promise<readonly AdminJobRecord[]> {
  const query = parseCommand(listAdminJobsQuerySchema, input, 'listAdminJobs');

  return context.repositories.adminConsole.listJobs(query.limit);
}

/**
 * Journal d'audit.
 *
 * Cette lecture n'est pas journalisée : chaque visite ajouterait une ligne au
 * journal qu'elle affiche, et le bruit finirait par masquer les accès aux
 * données personnelles que §104 veut rendre visibles.
 */
export async function listAdminAudit(
  context: AdminConsoleContext,
  input: unknown = {},
): Promise<readonly AdminAuditEntryRecord[]> {
  const query = parseCommand(listAdminAuditQuerySchema, input, 'listAdminAudit');

  return context.repositories.adminConsole.listAudit(query.limit);
}

/**
 * File de validation, toutes courses confondues.
 *
 * Complète la revue par course sans la remplacer : celle-ci sert à choisir quoi
 * examiner, l'écran de `/courses/[raceId]/revue` à examiner.
 */
export async function listAdminFactCandidates(
  context: AdminConsoleContext,
  input: unknown = {},
): Promise<readonly AdminFactCandidateRecord[]> {
  const query = parseCommand(listAdminFactCandidatesQuerySchema, input, 'listAdminFactCandidates');

  return context.repositories.adminConsole.listFactCandidates(query.limit);
}
