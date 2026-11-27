import type { Enum } from '../types.js';
import { defineRepository, type RepositoryContext } from '../repository.js';
import { unwrap, unwrapMaybe } from '../results.js';

/**
 * Communauté d'édition — 03_PRIVACY_RLS §53 à §55 ; migration 0114.
 *
 * Tout passe par les fonctions de 0114 : elles vérifient la participation, la
 * portée (course et point de l'édition) et l'état du contenu, et ne rendent
 * jamais l'identifiant d'un autre compte, seulement son libellé « Prénom N. ».
 * Le paquet ne décide de rien ; il traduit les lignes.
 */

export type CommunityCategory = Enum<'community_category'>;
export type CommunityContentStatus = Enum<'community_content_status'>;
export type CommunityReportReason = Enum<'report_reason'>;

/** Exactement un sujet ou une réponse. */
export type CommunityTarget =
  | { readonly threadId: string; readonly postId?: undefined }
  | { readonly postId: string; readonly threadId?: undefined };

export interface CommunityThreadSummaryRecord {
  readonly id: string;
  readonly raceId: string | null;
  readonly raceName: string | null;
  readonly category: CommunityCategory;
  readonly title: string;
  readonly waypointId: string | null;
  readonly waypointName: string | null;
  readonly authorLabel: string;
  readonly isMine: boolean;
  readonly status: CommunityContentStatus;
  readonly createdAt: string;
  readonly lastActivityAt: string;
  readonly replyCount: number;
  readonly usefulCount: number;
  readonly usefulByMe: boolean;
}

export interface CreateCommunityThreadInput {
  readonly editionId: string;
  readonly category: CommunityCategory;
  readonly title: string;
  readonly body: string;
  readonly raceId: string | null;
  readonly waypointId: string | null;
}

export interface CommunityRepository {
  /** Les sujets d'une édition, du plus récemment actif au plus ancien. */
  listThreads(editionId: string): Promise<readonly CommunityThreadSummaryRecord[]>;
  /**
   * Un sujet et ses réponses, tels que `community_thread_read` les construit :
   * le domaine en valide la forme. Nul quand le sujet n'est plus visible.
   */
  readThread(threadId: string): Promise<unknown>;
  createThread(input: CreateCommunityThreadInput): Promise<string>;
  reply(threadId: string, body: string): Promise<string>;
  /** Rend le nombre de « utile » après le geste. */
  setUseful(target: CommunityTarget, useful: boolean): Promise<number>;
  report(
    target: CommunityTarget,
    reason: CommunityReportReason,
    details: string | null,
  ): Promise<string>;
  deleteContent(target: CommunityTarget): Promise<void>;
}

// Les arguments nuls sont acceptés par la fonction SQL ; les types générés
// ne savent pas le dire (même convention que `aid-stations.ts`).
function targetArgs(target: CommunityTarget): { p_thread_id: string; p_post_id: string } {
  return {
    p_thread_id: (target.threadId ?? null) as string,
    p_post_id: (target.postId ?? null) as string,
  };
}

export const communityRepository = defineRepository<CommunityRepository>(
  (context: RepositoryContext) => ({
    async listThreads(editionId) {
      const rows = unwrap(
        await context.client.rpc('community_threads_list', { p_edition_id: editionId }),
        'community_threads_list',
      );
      // Les colonnes d'une fonction `returns table` sont typées non nulles par
      // le générateur ; course et point, eux, sont facultatifs.
      return rows.map((row) => ({
        id: row.id,
        raceId: (row.race_id as string | null) ?? null,
        raceName: (row.race_name as string | null) ?? null,
        category: row.category,
        title: row.title,
        waypointId: (row.waypoint_id as string | null) ?? null,
        waypointName: (row.waypoint_name as string | null) ?? null,
        authorLabel: row.author_label,
        isMine: row.is_mine,
        status: row.status,
        createdAt: row.created_at,
        lastActivityAt: row.last_activity_at,
        replyCount: row.reply_count,
        usefulCount: row.useful_count,
        usefulByMe: row.useful_by_me,
      }));
    },

    async readThread(threadId) {
      return unwrapMaybe(
        await context.client.rpc('community_thread_read', { p_thread_id: threadId }),
        'community_thread_read',
      );
    },

    async createThread(input) {
      return unwrap(
        await context.client.rpc('create_community_thread', {
          p_edition_id: input.editionId,
          p_category: input.category,
          p_title: input.title,
          p_body: input.body,
          ...(input.raceId === null ? {} : { p_race_id: input.raceId }),
          ...(input.waypointId === null ? {} : { p_waypoint_id: input.waypointId }),
        }),
        'create_community_thread',
      );
    },

    async reply(threadId, body) {
      return unwrap(
        await context.client.rpc('reply_community_thread', {
          p_thread_id: threadId,
          p_body: body,
        }),
        'reply_community_thread',
      );
    },

    async setUseful(target, useful) {
      return unwrap(
        await context.client.rpc('set_community_useful', {
          ...targetArgs(target),
          p_useful: useful,
        }),
        'set_community_useful',
      );
    },

    async report(target, reason, details) {
      return unwrap(
        await context.client.rpc('report_community_content', {
          ...targetArgs(target),
          p_reason: reason,
          ...(details === null ? {} : { p_details: details }),
        }),
        'report_community_content',
      );
    },

    async deleteContent(target) {
      const result = await context.client.rpc('delete_community_content', targetArgs(target));
      unwrapMaybe(result, 'delete_community_content');
    },
  }),
);
