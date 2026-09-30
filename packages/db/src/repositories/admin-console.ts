import { DbError, mapPostgrestError, type PostgrestLikeError } from '../errors.js';
import { defineRepository, type RepositoryContext } from '../repository.js';
import type { PlukaClient } from '../types.js';
import type {
  AdminAuditEntryRecord,
  AdminFactCandidateRecord,
  AdminJobRecord,
  AdminNutritionProductRecord,
  AdminOrganizationRecord,
  AdminPlatformCountersRecord,
  AdminReportDetailRecord,
  AdminReportRecord,
  AdminSourceRecord,
  AdminUserDetailRecord,
  AdminUserRecord,
} from './records.js';

/*
 * Repository de la console d'administration — migration 0028.
 *
 * Onze appels, onze écrans. Chacune des fonctions SQL contourne la RLS et pose
 * elle-même sa condition d'accès (03_PRIVACY_RLS §8) : ce repository ne
 * décide rien, il traduit des lignes.
 *
 * Il n'existe aucune variante « lire la table directement ». C'est le point de
 * §104 — « le simple statut `pluka_admin` ne doit pas transformer toutes les
 * données en contenu courant de l'admin UI » : la surface de lecture est
 * exactement celle de ces onze fonctions, et elle se voit d'un coup d'œil ici.
 *
 * Un refus remonte en `42501`, que `mapPostgrestError` traduit : l'application
 * n'a pas à distinguer un refus de fonction d'un refus de policy.
 */

/** Le sous-ensemble de `PlukaClient` dont ce repository a besoin. */
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

/** Les fonctions `returns table` rendent toujours un tableau. */
function rows(data: unknown, operation: string): readonly Record<string, unknown>[] {
  if (!Array.isArray(data)) {
    throw new DbError({
      code: 'unknown',
      operation,
      message: 'la fonction devait rendre un tableau de lignes',
    });
  }

  return data as readonly Record<string, unknown>[];
}

function text(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

function requiredText(row: Record<string, unknown>, key: string, operation: string): string {
  const value = text(row, key);

  if (value === null) {
    throw new DbError({
      code: 'unknown',
      operation,
      message: `colonne ${key} absente ou non textuelle`,
    });
  }

  return value;
}

function count(row: Record<string, unknown>, key: string): number {
  const value = row[key];

  // PostgREST rend un `bigint` en nombre quand il tient, en chaîne sinon.
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number.parseInt(value, 10);

  return 0;
}

function integer(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number.parseFloat(value);

  return null;
}

export interface AdminConsoleRepository {
  platformCounters(): Promise<AdminPlatformCountersRecord>;
  listOrganizations(limit: number): Promise<readonly AdminOrganizationRecord[]>;
  listSources(limit: number): Promise<readonly AdminSourceRecord[]>;
  listNutritionProducts(
    status: AdminNutritionProductRecord['status'] | null,
    limit: number,
  ): Promise<readonly AdminNutritionProductRecord[]>;
  listReports(limit: number): Promise<readonly AdminReportRecord[]>;
  /** Lecture personnelle : la fonction SQL écrit dans le journal d'audit. */
  getReport(reportId: string): Promise<AdminReportDetailRecord | null>;
  /** Lecture personnelle : auditée, terme et nombre de correspondances. */
  searchUsers(query: string | null, limit: number): Promise<readonly AdminUserRecord[]>;
  /** Lecture personnelle : auditée, identifiant consulté. */
  getUser(userId: string): Promise<AdminUserDetailRecord | null>;
  listJobs(limit: number): Promise<readonly AdminJobRecord[]>;
  listAudit(limit: number): Promise<readonly AdminAuditEntryRecord[]>;
  listFactCandidates(limit: number): Promise<readonly AdminFactCandidateRecord[]>;
}

export const adminConsoleRepository = defineRepository<AdminConsoleRepository>((context) => ({
  async platformCounters() {
    const operation = 'admin_platform_counters';
    const data = rows(
      unwrapRpc(await rpc(context.client).rpc(operation), operation),
      operation,
    );
    const row = data[0];

    if (row === undefined) {
      throw new DbError({
        code: 'unknown',
        operation,
        message: 'les compteurs de plateforme doivent rendre une ligne',
      });
    }

    return {
      eventsTotal: count(row, 'events_total'),
      eventsPublished: count(row, 'events_published'),
      editionsTotal: count(row, 'editions_total'),
      racesTotal: count(row, 'races_total'),
      racesPublished: count(row, 'races_published'),
      organizationsTotal: count(row, 'organizations_total'),
      organizationsActive: count(row, 'organizations_active'),
      participationsActive: count(row, 'participations_active'),
      candidatesPending: count(row, 'candidates_pending'),
      jobsFailed: count(row, 'jobs_failed'),
      reportsOpen: count(row, 'reports_open'),
      productsDraft: count(row, 'products_draft'),
      sourcesFailed: count(row, 'sources_failed'),
    };
  },

  async listOrganizations(limit) {
    const operation = 'admin_list_organizations';
    const data = rows(
      unwrapRpc(await rpc(context.client).rpc(operation, { p_limit: limit }), operation),
      operation,
    );

    return data.map((row) => ({
      organizationId: requiredText(row, 'organization_id', operation),
      name: requiredText(row, 'name', operation),
      slug: requiredText(row, 'slug', operation),
      status: requiredText(row, 'status', operation) as AdminOrganizationRecord['status'],
      contactEmail: text(row, 'contact_email'),
      eventsCount: count(row, 'events_count'),
      racesCount: count(row, 'races_count'),
      membersCount: count(row, 'members_count'),
      createdAt: requiredText(row, 'created_at', operation),
    }));
  },

  async listSources(limit) {
    const operation = 'admin_list_sources';
    const data = rows(
      unwrapRpc(await rpc(context.client).rpc(operation, { p_limit: limit }), operation),
      operation,
    );

    return data.map((row) => ({
      sourceId: requiredText(row, 'source_id', operation),
      title: requiredText(row, 'title', operation),
      sourceType: requiredText(row, 'source_type', operation) as AdminSourceRecord['sourceType'],
      status: requiredText(row, 'status', operation) as AdminSourceRecord['status'],
      url: text(row, 'url'),
      eventName: requiredText(row, 'event_name', operation),
      editionYear: integer(row, 'edition_year') ?? 0,
      snapshotRetrievedAt: text(row, 'snapshot_retrieved_at'),
      chunksCount: count(row, 'chunks_count'),
      importedAt: requiredText(row, 'imported_at', operation),
    }));
  },

  async listNutritionProducts(status, limit) {
    const operation = 'admin_list_nutrition_products';
    const data = rows(
      unwrapRpc(
        await rpc(context.client).rpc(operation, { p_status: status, p_limit: limit }),
        operation,
      ),
      operation,
    );

    return data.map((row) => ({
      productId: requiredText(row, 'product_id', operation),
      brand: text(row, 'brand'),
      name: requiredText(row, 'name', operation),
      variant: text(row, 'variant'),
      category: requiredText(
        row,
        'category',
        operation,
      ) as AdminNutritionProductRecord['category'],
      status: requiredText(row, 'status', operation) as AdminNutritionProductRecord['status'],
      carbsG: integer(row, 'carbs_g') ?? 0,
      sodiumMg: integer(row, 'sodium_mg') ?? 0,
      caffeineMg: integer(row, 'caffeine_mg') ?? 0,
      hydrationMl: integer(row, 'hydration_ml') ?? 0,
      sourceUrl: text(row, 'source_url'),
      verifiedAt: text(row, 'verified_at'),
      updatedAt: requiredText(row, 'updated_at', operation),
    }));
  },

  async listReports(limit) {
    const operation = 'admin_list_reports';
    const data = rows(
      unwrapRpc(await rpc(context.client).rpc(operation, { p_limit: limit }), operation),
      operation,
    );

    return data.map((row) => ({
      reportId: requiredText(row, 'report_id', operation),
      reason: requiredText(row, 'reason', operation) as AdminReportRecord['reason'],
      status: requiredText(row, 'status', operation) as AdminReportRecord['status'],
      targetKind: requiredText(row, 'target_kind', operation) as AdminReportRecord['targetKind'],
      createdAt: requiredText(row, 'created_at', operation),
      resolvedAt: text(row, 'resolved_at'),
    }));
  },

  async getReport(reportId) {
    const operation = 'admin_get_report';
    const data = rows(
      unwrapRpc(
        await rpc(context.client).rpc(operation, { p_report_id: reportId }),
        operation,
      ),
      operation,
    );
    const row = data[0];

    if (row === undefined) return null;

    return {
      reportId: requiredText(row, 'report_id', operation),
      reason: requiredText(row, 'reason', operation) as AdminReportRecord['reason'],
      status: requiredText(row, 'status', operation) as AdminReportRecord['status'],
      details: text(row, 'details'),
      reporterEmail: text(row, 'reporter_email'),
      targetKind: requiredText(row, 'target_kind', operation) as AdminReportRecord['targetKind'],
      targetContent: text(row, 'target_content'),
      targetAuthorEmail: text(row, 'target_author_email'),
      createdAt: requiredText(row, 'created_at', operation),
      resolvedAt: text(row, 'resolved_at'),
    };
  },

  async searchUsers(query, limit) {
    const operation = 'admin_search_users';
    const data = rows(
      unwrapRpc(
        await rpc(context.client).rpc(operation, { p_query: query, p_limit: limit }),
        operation,
      ),
      operation,
    );

    return data.map((row) => ({
      userId: requiredText(row, 'user_id', operation),
      email: requiredText(row, 'email', operation),
      firstName: text(row, 'first_name'),
      lastName: text(row, 'last_name'),
      platformRole: requiredText(
        row,
        'platform_role',
        operation,
      ) as AdminUserRecord['platformRole'],
      entitlementLevel: requiredText(
        row,
        'entitlement_level',
        operation,
      ) as AdminUserRecord['entitlementLevel'],
      racesCount: count(row, 'races_count'),
      createdAt: requiredText(row, 'created_at', operation),
    }));
  },

  async getUser(userId) {
    const operation = 'admin_get_user';
    const data = rows(
      unwrapRpc(await rpc(context.client).rpc(operation, { p_user_id: userId }), operation),
      operation,
    );
    const row = data[0];

    if (row === undefined) return null;

    return {
      userId: requiredText(row, 'user_id', operation),
      email: requiredText(row, 'email', operation),
      firstName: text(row, 'first_name'),
      lastName: text(row, 'last_name'),
      locale: requiredText(row, 'locale', operation),
      timezone: requiredText(row, 'timezone', operation),
      platformRole: requiredText(
        row,
        'platform_role',
        operation,
      ) as AdminUserRecord['platformRole'],
      entitlementLevel: requiredText(
        row,
        'entitlement_level',
        operation,
      ) as AdminUserRecord['entitlementLevel'],
      entitlements: Array.isArray(row['entitlements_detail'])
        ? (row['entitlements_detail'] as readonly Record<string, unknown>[]).map((entry) => ({
            kind: String(entry['kind']),
            source: String(entry['source']),
            status: String(entry['status']),
            startsAt: typeof entry['startsAt'] === 'string' ? entry['startsAt'] : null,
            endsAt: typeof entry['endsAt'] === 'string' ? entry['endsAt'] : null,
          }))
        : [],
      racesCount: count(row, 'races_count'),
      createdAt: requiredText(row, 'created_at', operation),
    };
  },

  async listJobs(limit) {
    const operation = 'admin_list_jobs';
    const data = rows(
      unwrapRpc(await rpc(context.client).rpc(operation, { p_limit: limit }), operation),
      operation,
    );

    return data.map((row) => ({
      jobId: requiredText(row, 'job_id', operation),
      jobType: requiredText(row, 'job_type', operation),
      status: requiredText(row, 'status', operation) as AdminJobRecord['status'],
      idempotencyKey: requiredText(row, 'idempotency_key', operation),
      attempts: integer(row, 'attempts') ?? 0,
      maxAttempts: integer(row, 'max_attempts') ?? 0,
      lastError: text(row, 'last_error'),
      availableAt: text(row, 'available_at'),
      startedAt: text(row, 'started_at'),
      completedAt: text(row, 'completed_at'),
      createdAt: requiredText(row, 'created_at', operation),
      sourceTitle: text(row, 'source_title'),
      eventName: text(row, 'event_name'),
    }));
  },

  async listAudit(limit) {
    const operation = 'admin_list_audit';
    const data = rows(
      unwrapRpc(await rpc(context.client).rpc(operation, { p_limit: limit }), operation),
      operation,
    );

    return data.map((row) => ({
      entryId: count(row, 'entry_id'),
      action: requiredText(row, 'action', operation),
      entityTable: requiredText(row, 'entity_table', operation),
      entityId: text(row, 'entity_id'),
      afterData: (row['after_data'] ?? null) as Readonly<Record<string, unknown>> | null,
      actorEmail: text(row, 'actor_email'),
      organizationName: text(row, 'organization_name'),
      requestId: text(row, 'request_id'),
      createdAt: requiredText(row, 'created_at', operation),
    }));
  },

  async listFactCandidates(limit) {
    const operation = 'admin_list_fact_candidates';
    const data = rows(
      unwrapRpc(await rpc(context.client).rpc(operation, { p_limit: limit }), operation),
      operation,
    );

    return data.map((row) => ({
      candidateId: requiredText(row, 'candidate_id', operation),
      raceId: requiredText(row, 'race_id', operation),
      raceName: requiredText(row, 'race_name', operation),
      eventName: requiredText(row, 'event_name', operation),
      category: requiredText(row, 'category', operation),
      factKey: requiredText(row, 'fact_key', operation),
      valueText: text(row, 'value_text'),
      status: requiredText(row, 'status', operation),
      conflictStatus: text(row, 'conflict_status'),
      confidenceLabel: text(row, 'confidence_label'),
      extractedAt: text(row, 'extracted_at'),
    }));
  },
}));

export interface AdminConsoleRepositories {
  readonly adminConsole: AdminConsoleRepository;
}

export function createAdminConsoleRepositories(
  context: RepositoryContext,
): AdminConsoleRepositories {
  return { adminConsole: adminConsoleRepository(context) };
}
