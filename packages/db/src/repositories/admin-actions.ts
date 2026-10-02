import { DbError, mapPostgrestError, type PostgrestLikeError } from '../errors.js';
import { defineRepository, type RepositoryContext } from '../repository.js';
import type { PlukaClient } from '../types.js';

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
}));

export interface AdminActionsRepositories {
  readonly adminActions: AdminActionsRepository;
}

export function createAdminActionsRepositories(
  context: RepositoryContext,
): AdminActionsRepositories {
  return { adminActions: adminActionsRepository(context) };
}
