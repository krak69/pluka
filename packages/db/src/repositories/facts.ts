import { DbError, mapPostgrestError, type PostgrestLikeError } from '../errors.js';
import { defineRepository, type RepositoryContext } from '../repository.js';
import type { PlukaClient } from '../types.js';
import { identityRepository, type IdentityRepository } from './course.js';
import type {
  FactCandidateReviewRecord,
  FactCandidateScopeRecord,
  FactPublicationActRecord,
  FactReviewAction,
  PublishedFactRecord,
} from './records.js';

/*
 * Repositories de revue et de publication de facts.
 *
 * Ils exécutent des appels et traduisent des lignes. Aucune décision
 * d'autorisation n'est prise ici : elle appartient au use case, et la base la
 * réapplique de son côté (01_ARCHITECTURE §4.5, §5 règle 5).
 *
 * Toutes les écritures passent par des fonctions SQL. §33 énumère huit étapes
 * qui n'ont de sens qu'ensemble — version, sources, pointeur courant, journal,
 * événement métier — et PostgREST n'exécute qu'une instruction par appel
 * (01_ARCHITECTURE §31). Les découper laisserait un fact pointant vers une
 * version dont les preuves manquent.
 */

/** Les fonctions de 0012 ne figurent pas dans les types générés. */
type RpcClient = {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};

function rpc(client: PlukaClient): RpcClient {
  return client as unknown as RpcClient;
}

function unwrapRpc(result: { data: unknown; error: unknown }, operation: string): unknown {
  const error = result.error as PostgrestLikeError | null | undefined;

  // Le refus de la base est traduit par le même classificateur que partout
  // ailleurs : un `42501` venu d'un trigger de publication n'a pas à être lu
  // autrement qu'un `42501` venu d'une policy.
  if (error !== null && error !== undefined) throw mapPostgrestError(error, operation);

  return result.data;
}

function rows(data: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function number(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function toScope(row: Record<string, unknown>): FactCandidateScopeRecord {
  return {
    candidateId: String(row.candidate_id),
    raceId: String(row.race_id),
    organizationId: text(row.organization_id),
    category: row.category as FactCandidateScopeRecord['category'],
    factKey: String(row.fact_key),
    status: String(row.status) as FactCandidateScopeRecord['status'],
    origin: text(row.origin),
    matchedFactId: text(row.matched_fact_id),
    valueText: text(row.value_text),
    valueNumber: number(row.value_number),
    unit: text(row.unit),
    evidenceCount: Number(row.evidence_count ?? 0),
    conflictStatus: text(row.conflict_status),
  };
}

function toReview(row: Record<string, unknown>): FactCandidateReviewRecord {
  return {
    candidateId: String(row.candidate_id),
    raceId: String(row.race_id),
    category: row.category as FactCandidateReviewRecord['category'],
    factKey: String(row.fact_key),
    valueText: text(row.value_text),
    valueNumber: number(row.value_number),
    unit: text(row.unit),
    valueJson: (row.value_json ?? null) as FactCandidateReviewRecord['valueJson'],
    confidenceLabel: text(row.confidence_label) as FactCandidateReviewRecord['confidenceLabel'],
    status: String(row.status) as FactCandidateReviewRecord['status'],
    origin: text(row.origin),
    notes: text(row.notes),
    matchedFactId: text(row.matched_fact_id),
    publishedValueText: text(row.published_value_text),
    publishedVersionId: text(row.published_version_id),
    publishedTrustLevel: text(
      row.published_trust_level,
    ) as FactCandidateReviewRecord['publishedTrustLevel'],
    conflictType: text(row.conflict_type),
    conflictStatus: text(row.conflict_status),
    excerpt: text(row.excerpt),
    pageNumber: number(row.page_number),
    sectionPath: Array.isArray(row.section_path) ? (row.section_path as string[]) : [],
    locator: (row.locator ?? {}) as Readonly<Record<string, unknown>>,
    sourceTitle: text(row.source_title),
    sourceUrl: text(row.source_url),
    snapshotRetrievedAt: text(row.snapshot_retrieved_at),
    provider: text(row.provider),
    model: text(row.model),
    extractedAt: text(row.extracted_at),
  };
}

function toAct(row: Record<string, unknown>): FactPublicationActRecord {
  return {
    actId: String(row.act_id),
    candidateId: text(row.candidate_id),
    factId: text(row.fact_id),
    factVersionId: text(row.fact_version_id),
    action: String(row.action) as FactPublicationActRecord['action'],
    actorUserId: String(row.actor_user_id),
    authority: String(row.authority) as FactPublicationActRecord['authority'],
    actorRole: text(row.actor_role) as FactPublicationActRecord['actorRole'],
    trustLevel: text(row.trust_level) as FactPublicationActRecord['trustLevel'],
    originalValue: (row.original_value ?? null) as FactPublicationActRecord['originalValue'],
    publishedValue: (row.published_value ?? null) as FactPublicationActRecord['publishedValue'],
    note: text(row.note),
    createdAt: String(row.created_at),
  };
}

export interface PublishFactInput {
  readonly candidateId: string;
  readonly actorUserId: string;
  readonly trustLevel: PublishedFactRecord['trustLevel'];
  readonly valueText?: string | null;
  readonly valueNumber?: number | null;
  readonly valueJson?: Readonly<Record<string, unknown>> | null;
  readonly unit?: string | null;
  readonly note?: string | null;
  readonly resolveConflict?: boolean;
}

export interface FactReviewRepository {
  /** Portée d'un candidat, pour relire l'autorité avant d'agir. */
  findCandidateScope(candidateId: string): Promise<FactCandidateScopeRecord | null>;
  /** Les huit colonnes que §30 impose à l'écran de revue. */
  listForReview(raceId: string, limit: number): Promise<readonly FactCandidateReviewRecord[]>;
  /** Les huit étapes de §33, en une transaction. */
  publish(input: PublishFactInput): Promise<PublishedFactRecord>;
  /** Le journal des décisions — §30, §31. */
  listPublicationActs(raceId: string, limit: number): Promise<readonly FactPublicationActRecord[]>;
  /** Les décisions de §31 qui ne publient pas. */
  decide(
    candidateId: string,
    actorUserId: string,
    action: Exclude<FactReviewAction, 'publish' | 'edit_and_publish'>,
    note: string | null,
  ): Promise<string>;
}

export const factReviewRepository = defineRepository<FactReviewRepository>((context) => ({
  async findCandidateScope(candidateId) {
    const data = unwrapRpc(
      await rpc(context.client).rpc('get_fact_candidate_scope', { p_candidate_id: candidateId }),
      'get_fact_candidate_scope',
    );

    const row = rows(data)[0];

    return row === undefined ? null : toScope(row);
  },

  async listForReview(raceId, limit) {
    const data = unwrapRpc(
      await rpc(context.client).rpc('list_fact_candidates_for_review', {
        p_race_id: raceId,
        p_limit: limit,
      }),
      'list_fact_candidates_for_review',
    );

    return rows(data).map(toReview);
  },

  async publish(input) {
    const data = unwrapRpc(
      await rpc(context.client).rpc('publish_fact_candidate', {
        p_candidate_id: input.candidateId,
        // L'identifiant est transmis pour que l'intention soit explicite et
        // vérifiable ; il ne confère rien. La fonction SQL exige qu'il
        // corresponde à la session, et refuse quand il n'y en a pas.
        p_actor_user_id: input.actorUserId,
        p_trust_level: input.trustLevel,
        p_value_text: input.valueText ?? null,
        p_value_number: input.valueNumber ?? null,
        p_value_json: input.valueJson ?? null,
        p_unit: input.unit ?? null,
        p_note: input.note ?? null,
        p_resolve_conflict: input.resolveConflict ?? false,
      }),
      'publish_fact_candidate',
    );

    const row = rows(data)[0];

    if (row === undefined) {
      throw new DbError({
        code: 'unknown',
        operation: 'publish_fact_candidate',
        message: 'publication sans résultat',
      });
    }

    return {
      factId: String(row.fact_id),
      factVersionId: String(row.fact_version_id),
      versionNumber: Number(row.version_number),
      action: String(row.action) as PublishedFactRecord['action'],
      supersededVersionId: text(row.superseded_version_id),
      trustLevel: input.trustLevel,
    };
  },

  async listPublicationActs(raceId, limit) {
    const data = unwrapRpc(
      await rpc(context.client).rpc('list_fact_publication_acts', {
        p_race_id: raceId,
        p_limit: limit,
      }),
      'list_fact_publication_acts',
    );

    return rows(data).map(toAct);
  },

  async decide(candidateId, actorUserId, action, note) {
    const data = unwrapRpc(
      await rpc(context.client).rpc('decide_fact_candidate', {
        p_candidate_id: candidateId,
        p_actor_user_id: actorUserId,
        p_action: action,
        p_note: note,
      }),
      'decide_fact_candidate',
    );

    return String(data);
  },
}));

/**
 * Bundle passé aux use cases de publication (01_ARCHITECTURE §5).
 *
 * `identity` est celui du bundle de course, réemployé tel quel : deux façons
 * de lire un rôle finiraient par diverger, et c'est précisément le genre
 * d'écart que 03_PRIVACY_RLS §178 ferme.
 */
export interface FactRepositories {
  readonly factReview: FactReviewRepository;
  readonly identity: IdentityRepository;
}

export function createFactRepositories(context: RepositoryContext): FactRepositories {
  return {
    factReview: factReviewRepository(context),
    identity: identityRepository(context),
  };
}
