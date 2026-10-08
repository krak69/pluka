import { DbError, mapPostgrestError, type PostgrestLikeError } from '../errors.js';
import { defineRepository, type RepositoryContext } from '../repository.js';
import type { Enum, PlukaClient } from '../types.js';

/*
 * Repository des écritures de la console d'administration — migration 0029.
 *
 * Cinq appels, cinq gestes. Chaque fonction SQL contourne la RLS, porte sa
 * garde `pluka_admin` en première instruction, vérifie la transition sur la
 * ligne verrouillée et écrit sa trace dans `private.audit_logs` dans la même
 * transaction. Ce repository ne décide donc rien : il transmet un identifiant
 * et traduit la réponse.
 *
 * Les refus remontent en `DbError` :
 *
 * - `permission_denied` (`42501`) — l'appelant n'est pas administrateur ;
 * - `not_found` (`P0002`) — l'objet visé n'existe pas ;
 * - `invalid_state` (`55000`) — la transition est refusée depuis l'état courant.
 */

interface RpcCapableClient {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

function rpc(client: PlukaClient): RpcCapableClient {
  return client as unknown as RpcCapableClient;
}

function unwrapRpc(result: { data: unknown; error: unknown }, operation: string): unknown {
  if (result.error !== null && result.error !== undefined) {
    throw mapPostgrestError(result.error as PostgrestLikeError, operation);
  }

  return result.data;
}

/** Une fonction `returns integer` : PostgREST rend le scalaire tel quel. */
function scalarCount(data: unknown, operation: string): number {
  if (typeof data === 'number') return data;
  if (typeof data === 'string' && /^\d+$/.test(data)) return Number.parseInt(data, 10);

  throw new DbError({
    code: 'unknown',
    operation,
    message: 'la fonction devait rendre un entier',
  });
}

export interface AdminActionsRepository {
  /** Rend le nombre de signalements clos, celui traité compris. */
  hideReportedContent(reportId: string): Promise<number>;
  dismissReport(reportId: string): Promise<void>;
  /** Rend le numéro de la relance — 1 pour la première. */
  retryJob(jobId: string): Promise<number>;
  validateNutritionProduct(productId: string): Promise<void>;
  archiveNutritionProduct(productId: string): Promise<void>;
  /** Migration 0030. Rend l'identifiant de l'organisation créée. */
  createOrganization(input: CreateOrganizationInput): Promise<string>;
  /** Migration 0031. Rend le nombre de champs modifiés — 0 si rien n'a changé. */
  updateOrganization(input: UpdateOrganizationInput): Promise<number>;
  /**
   * Migration 0044 — super-admin seul. `organizationId` nul détache
   * l'événement. Rend `false` quand il était déjà à cette organisation.
   */
  changeEventOrganization(eventId: string, organizationId: string | null): Promise<boolean>;
  /** Migration 0032. `invalid_state` tant que des données y restent liées. */
  deleteOrganization(organizationId: string): Promise<void>;
}

export interface UpdateOrganizationInput {
  readonly organizationId: string;
  readonly name: string;
  readonly contactEmail: string | null;
  readonly websiteUrl: string | null;
  readonly status: Enum<'organization_status'>;
}

export interface CreateOrganizationInput {
  readonly name: string;
  readonly slug: string;
  readonly contactEmail: string | null;
  readonly websiteUrl: string | null;
}

export const adminActionsRepository = defineRepository<AdminActionsRepository>((context) => ({
  async hideReportedContent(reportId) {
    const operation = 'admin_hide_reported_content';
    const data = unwrapRpc(
      await rpc(context.client).rpc(operation, { p_report_id: reportId }),
      operation,
    );

    return scalarCount(data, operation);
  },

  async dismissReport(reportId) {
    const operation = 'admin_dismiss_report';
    unwrapRpc(await rpc(context.client).rpc(operation, { p_report_id: reportId }), operation);
  },

  async retryJob(jobId) {
    const operation = 'admin_retry_job';
    const data = unwrapRpc(
      await rpc(context.client).rpc(operation, { p_job_id: jobId }),
      operation,
    );

    return scalarCount(data, operation);
  },

  async validateNutritionProduct(productId) {
    const operation = 'admin_validate_nutrition_product';
    unwrapRpc(await rpc(context.client).rpc(operation, { p_product_id: productId }), operation);
  },

  async archiveNutritionProduct(productId) {
    const operation = 'admin_archive_nutrition_product';
    unwrapRpc(await rpc(context.client).rpc(operation, { p_product_id: productId }), operation);
  },

  async createOrganization(input) {
    const operation = 'admin_create_organization';
    const data = unwrapRpc(
      await rpc(context.client).rpc(operation, {
        p_name: input.name,
        p_slug: input.slug,
        p_contact_email: input.contactEmail,
        p_website_url: input.websiteUrl,
      }),
      operation,
    );

    if (typeof data !== 'string') {
      throw new DbError({
        code: 'unknown',
        operation,
        message: 'la fonction devait rendre un uuid',
      });
    }

    return data;
  },

  async updateOrganization(input) {
    const operation = 'admin_update_organization';
    const data = unwrapRpc(
      await rpc(context.client).rpc(operation, {
        p_organization_id: input.organizationId,
        p_name: input.name,
        p_contact_email: input.contactEmail,
        p_website_url: input.websiteUrl,
        p_status: input.status,
      }),
      operation,
    );

    return scalarCount(data, operation);
  },

  async changeEventOrganization(eventId, organizationId) {
    const operation = 'admin_change_event_organization';
    const data = unwrapRpc(
      await rpc(context.client).rpc(operation, {
        p_event_id: eventId,
        p_organization_id: organizationId,
      }),
      operation,
    );

    if (typeof data !== 'boolean') {
      throw new DbError({
        code: 'unknown',
        operation,
        message: 'la fonction devait rendre un booléen',
      });
    }

    return data;
  },

  async deleteOrganization(organizationId) {
    const operation = 'admin_delete_organization';
    unwrapRpc(
      await rpc(context.client).rpc(operation, { p_organization_id: organizationId }),
      operation,
    );
  },
}));

export interface AdminActionsRepositories {
  readonly adminActions: AdminActionsRepository;
}

export function createAdminActionsRepositories(
  context: RepositoryContext,
): AdminActionsRepositories {
  return { adminActions: adminActionsRepository(context) };
}
