import { z } from 'zod';

import {
  DbError,
  type AvatarIllustration,
  type AvatarStore,
  type CommunityAvatar,
  type CommunityRepository,
  type CommunityTarget,
  type CommunityThreadSummaryRecord,
  type EditionRepository,
  type EventRepository,
  type ParticipantRaceRepository,
  type RaceRepository,
  type RaceWaypointRepository,
} from '@pluka/db';

import type { Actor } from '../authorization/organization-role.js';
import {
  forbiddenError,
  invalidStateError,
  notFoundError,
  parseCommand,
  validationError,
} from '../errors.js';
import { AVATAR_URL_SECONDS } from '../profile/identity.js';

/**
 * Communauté d'édition — 00_PRODUCT_SPEC §21 ; 03_PRIVACY_RLS §53 à §55 ;
 * 05_ROUTES_FLOWS §12.4 ; AC-COM-01 à AC-COM-04 ; migration 0114.
 *
 * Une communauté par édition : ses participants y ouvrent des sujets, y
 * répondent, trouvent un message utile, le signalent. Pas de followers, pas de
 * messages privés, pas de fil global (AC-COM-02). La base vérifie la
 * participation et la portée de chaque geste ; le domaine valide les entrées,
 * range les communautés du coureur et traduit les refus.
 *
 * Rien ici ne donne à un contenu communautaire le poids d'une information
 * officielle (AC-COM-04) : aucun fait n'en est tiré.
 */

export const COMMUNITY_CATEGORIES = [
  'other',
  'preparation',
  'race',
  'logistics',
  'equipment_nutrition',
  'assistance',
  'review',
] as const;

export type CommunityCategory = (typeof COMMUNITY_CATEGORIES)[number];

export const COMMUNITY_REPORT_REASONS = [
  'spam',
  'abuse',
  'misinformation',
  'privacy',
  'other',
] as const;

export const COMMUNITY_TITLE_MAX = 140;
export const COMMUNITY_BODY_MAX = 4000;
export const COMMUNITY_REPORT_DETAILS_MAX = 1000;

export interface CommunityContext {
  readonly repositories: {
    readonly community: CommunityRepository;
    readonly participantRaces: Pick<ParticipantRaceRepository, 'listForUser'>;
    readonly races: Pick<RaceRepository, 'findById' | 'listByEdition'>;
    readonly editions: Pick<EditionRepository, 'findById'>;
    readonly events: Pick<EventRepository, 'findById'>;
    readonly waypoints: Pick<RaceWaypointRepository, 'listByRace'>;
    /** Les photos des auteurs, lues par lien temporaire (0115). */
    readonly avatars: Pick<AvatarStore, 'signedUrls'>;
  };
  readonly actor: Actor;
  readonly now: () => Date;
}

/** Une communauté où le coureur a sa place : l'édition de l'une de ses courses. */
export interface CommunitySummary {
  readonly editionId: string;
  readonly eventName: string;
  readonly year: number;
  /** Ses courses dans cette édition, par heure de départ. */
  readonly myRaces: readonly {
    readonly raceId: string;
    readonly participantRaceId: string;
    readonly name: string;
  }[];
  /** Le premier départ de ses courses dans l'édition. */
  readonly startsAt: string;
  /** Le fuseau IANA de cette première course : les messages se datent à l'heure de l'épreuve. */
  readonly timezone: string;
  /** Toutes ses courses de l'édition sont parties. */
  readonly past: boolean;
}

/**
 * L'avatar d'un auteur, prêt à afficher : un lien de lecture temporaire vers
 * sa photo, ou son illustration. Une photo que le stockage n'a pas signée
 * s'affiche Neutre.
 */
export type CommunityAvatarView =
  { readonly kind: 'photo'; readonly url: string } | { readonly kind: AvatarIllustration };

export type CommunityThreadSummary = Omit<CommunityThreadSummaryRecord, 'authorAvatar'> & {
  readonly authorAvatar: CommunityAvatarView;
};

/** Un point du parcours auquel rattacher un sujet. */
export interface CommunityPoint {
  readonly waypointId: string;
  readonly name: string;
  readonly distanceKm: number;
}

export interface CommunityView {
  readonly community: CommunitySummary;
  /** Les courses de l'édition et leurs points, par départ puis par kilomètre. */
  readonly races: readonly {
    readonly raceId: string;
    readonly name: string;
    readonly points: readonly CommunityPoint[];
  }[];
  readonly threads: readonly CommunityThreadSummary[];
}

/**
 * La communauté vue depuis une participation : son édition, sa course, et les
 * sujets publiés rattachés à un point de cette course — pour le Plan et La
 * course (prototype `pointDrawer.threads`).
 */
export interface ParticipationCommunity {
  readonly editionId: string;
  readonly raceId: string;
  readonly pointThreads: readonly CommunityThreadSummaryRecord[];
}

const avatarSchema = z.union([
  z.object({ kind: z.literal('photo'), path: z.string() }),
  z.object({ kind: z.enum(['neutral', 'man', 'woman']) }),
]);

const postViewSchema = z.object({
  id: z.string(),
  authorLabel: z.string(),
  authorAvatar: avatarSchema,
  isMine: z.boolean(),
  status: z.enum(['published', 'hidden', 'deleted']),
  body: z.string(),
  createdAt: z.string(),
  usefulCount: z.number().int().nonnegative(),
  usefulByMe: z.boolean(),
});

const threadViewSchema = z.object({
  id: z.string(),
  editionId: z.string(),
  raceId: z.string().nullable(),
  raceName: z.string().nullable(),
  category: z.enum(COMMUNITY_CATEGORIES),
  title: z.string(),
  body: z.string(),
  waypointId: z.string().nullable(),
  waypointName: z.string().nullable(),
  authorLabel: z.string(),
  authorAvatar: avatarSchema,
  isMine: z.boolean(),
  status: z.enum(['published', 'hidden', 'deleted']),
  createdAt: z.string(),
  usefulCount: z.number().int().nonnegative(),
  usefulByMe: z.boolean(),
  canReply: z.boolean(),
  canModerate: z.boolean(),
  posts: z.array(postViewSchema),
});

type ParsedPost = z.infer<typeof postViewSchema>;
type ParsedThread = z.infer<typeof threadViewSchema>;

export type CommunityPostView = Omit<ParsedPost, 'authorAvatar'> & {
  readonly authorAvatar: CommunityAvatarView;
};
export type CommunityThreadView = Omit<ParsedThread, 'authorAvatar' | 'posts'> & {
  readonly authorAvatar: CommunityAvatarView;
  readonly posts: readonly CommunityPostView[];
};

const editionQuerySchema = z.object({ editionId: z.uuid() }).strict();
const participationQuerySchema = z.object({ participantRaceId: z.uuid() }).strict();
const threadQuerySchema = z.object({ threadId: z.uuid() }).strict();

const targetSchema = z.union([
  z.object({ threadId: z.uuid() }).strict(),
  z.object({ postId: z.uuid() }).strict(),
]);

export const createCommunityThreadCommandSchema = z
  .object({
    editionId: z.uuid(),
    category: z.enum(COMMUNITY_CATEGORIES, { error: 'Choisis une catégorie.' }),
    title: z
      .string()
      .trim()
      .min(3, { error: 'Un titre d’au moins 3 caractères.' })
      .max(COMMUNITY_TITLE_MAX, { error: `${COMMUNITY_TITLE_MAX} caractères au plus.` }),
    body: z
      .string()
      .trim()
      .max(COMMUNITY_BODY_MAX, { error: `${COMMUNITY_BODY_MAX} caractères au plus.` })
      .default(''),
    raceId: z.uuid().nullable().default(null),
    waypointId: z.uuid().nullable().default(null),
  })
  .strict();

export const replyCommunityThreadCommandSchema = z
  .object({
    threadId: z.uuid(),
    body: z
      .string()
      .trim()
      .min(1, { error: 'Écris ta réponse.' })
      .max(COMMUNITY_BODY_MAX, { error: `${COMMUNITY_BODY_MAX} caractères au plus.` }),
  })
  .strict();

export const setCommunityUsefulCommandSchema = z
  .object({ target: targetSchema, useful: z.boolean() })
  .strict();

export const reportCommunityContentCommandSchema = z
  .object({
    target: targetSchema,
    reason: z.enum(COMMUNITY_REPORT_REASONS, { error: 'Choisis un motif.' }),
    details: z
      .string()
      .trim()
      .max(COMMUNITY_REPORT_DETAILS_MAX, {
        error: `${COMMUNITY_REPORT_DETAILS_MAX} caractères au plus.`,
      })
      .optional(),
  })
  .strict();

export const deleteCommunityContentCommandSchema = z.object({ target: targetSchema }).strict();

/** Le motif levé par une fonction de 0114 (`22023`), s'il y en a un. */
function sqlReason(error: DbError): string | null {
  const cause = error.cause as { readonly code?: unknown; readonly message?: unknown } | undefined;
  return cause?.code === '22023' && typeof cause.message === 'string' ? cause.message : null;
}

/**
 * Les refus de la base, en codes de domaine. Un refus d'accès ne dit pas
 * pourquoi : confirmer qu'une communauté existe serait déjà en dire trop
 * (03_PRIVACY_RLS §120).
 */
function translate(error: unknown, useCase: string): unknown {
  if (!(error instanceof DbError)) return error;

  switch (error.code) {
    case 'permission_denied':
      return forbiddenError(useCase);
    case 'not_found':
      return notFoundError(useCase, 'sujet');
    case 'constraint_violation':
      return validationError(useCase, 'contenu hors des longueurs admises');
    case 'unknown':
      switch (sqlReason(error)) {
        case 'INVALID_RACE':
          return validationError(useCase, 'course hors de cette édition', {
            raceId: 'Cette course ne fait pas partie de cette édition.',
          });
        case 'INVALID_WAYPOINT':
          return validationError(useCase, 'point hors de la course', {
            waypointId: 'Ce point ne fait pas partie de la course choisie.',
          });
        case 'INVALID_TARGET':
          return validationError(useCase, 'un sujet ou une réponse, pas les deux');
        case 'THREAD_CLOSED':
          return invalidStateError(useCase, 'ce sujet ne reçoit plus de réponses');
        default:
          return error;
      }
    default:
      return error;
  }
}

async function attempt<T>(useCase: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw translate(error, useCase);
  }
}

/**
 * Les photos d'une page signées d'un seul appel ; une photo refusée, ou un
 * stockage qui ne répond pas, laisse place à l'illustration Neutre : la
 * discussion s'affiche quand même.
 */
async function avatarResolver(
  context: CommunityContext,
  avatars: readonly CommunityAvatar[],
): Promise<(avatar: CommunityAvatar) => CommunityAvatarView> {
  const paths = avatars.flatMap((avatar) => (avatar.kind === 'photo' ? [avatar.path] : []));
  const urls: Readonly<Record<string, string>> =
    paths.length === 0
      ? {}
      : await context.repositories.avatars.signedUrls(paths, AVATAR_URL_SECONDS).catch(() => ({}));

  return (avatar) => {
    if (avatar.kind !== 'photo') return avatar;
    const url = urls[avatar.path];
    return url === undefined ? { kind: 'neutral' } : { kind: 'photo', url };
  };
}

function asTarget(target: z.infer<typeof targetSchema>): CommunityTarget {
  return 'threadId' in target ? { threadId: target.threadId } : { postId: target.postId };
}

/**
 * Les communautés du coureur : une par édition où il a une participation non
 * archivée. Les prochaines d'abord, par départ ; les passées ensuite, de la
 * plus récente à la plus ancienne. Une course, une édition ou un événement que
 * la RLS ne rend pas est absent, sans erreur.
 */
export async function listMyCommunities(
  context: CommunityContext,
): Promise<readonly CommunitySummary[]> {
  const participations = (
    await context.repositories.participantRaces.listForUser(context.actor.userId)
  ).filter((participation) => participation.status !== 'archived');

  const races = (
    await Promise.all(
      participations.map(async (participation) => ({
        participation,
        race: await context.repositories.races.findById(participation.raceId),
      })),
    )
  ).flatMap(({ participation, race }) => (race === null ? [] : [{ participation, race }]));

  const byEdition = new Map<string, typeof races>();
  for (const entry of races) {
    byEdition.set(entry.race.editionId, [...(byEdition.get(entry.race.editionId) ?? []), entry]);
  }

  const now = context.now().getTime();
  const summaries = await Promise.all(
    [...byEdition.entries()].map(async ([editionId, entries]): Promise<CommunitySummary | null> => {
      const edition = await context.repositories.editions.findById(editionId);
      if (edition === null) return null;
      const event = await context.repositories.events.findById(edition.eventId);
      if (event === null) return null;

      const mine = [...entries].sort((left, right) =>
        left.race.startDatetime.localeCompare(right.race.startDatetime),
      );
      const first = mine[0];
      const last = mine[mine.length - 1];
      if (first === undefined || last === undefined) return null;

      return {
        editionId,
        eventName: event.name,
        year: edition.year,
        myRaces: mine.map(({ participation, race }) => ({
          raceId: race.id,
          participantRaceId: participation.participantRaceId,
          name: race.name,
        })),
        startsAt: first.race.startDatetime,
        timezone: first.race.timezone,
        past: Date.parse(last.race.startDatetime) < now,
      };
    }),
  );

  const kept = summaries.filter((summary): summary is CommunitySummary => summary !== null);
  const upcoming = kept
    .filter((summary) => !summary.past)
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  const past = kept
    .filter((summary) => summary.past)
    .sort((left, right) => right.startsAt.localeCompare(left.startsAt));

  return [...upcoming, ...past];
}

/**
 * La communauté d'une édition : son en-tête, ses courses et ses sujets. Le
 * coureur doit y avoir sa place ; la base le revérifie (0114).
 */
export async function getCommunity(
  context: CommunityContext,
  input: unknown,
): Promise<CommunityView> {
  const useCase = 'getCommunity';
  const { editionId } = parseCommand(editionQuerySchema, input, useCase);

  const community = (await listMyCommunities(context)).find(
    (summary) => summary.editionId === editionId,
  );
  if (community === undefined) throw forbiddenError(useCase);

  const [threads, races] = await Promise.all([
    attempt(useCase, () => context.repositories.community.listThreads(editionId)),
    context.repositories.races.listByEdition(editionId),
  ]);
  const ordered = [...races].sort((left, right) =>
    left.startDatetime.localeCompare(right.startDatetime),
  );
  const waypoints = await Promise.all(
    ordered.map((race) => context.repositories.waypoints.listByRace(race.id)),
  );

  const avatarOf = await avatarResolver(
    context,
    threads.map((thread) => thread.authorAvatar),
  );

  return {
    community,
    races: ordered.map((race, index) => ({
      raceId: race.id,
      name: race.name,
      points: [...(waypoints[index] ?? [])]
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((waypoint) => ({
          waypointId: waypoint.id,
          name: waypoint.name,
          distanceKm: waypoint.distanceKm,
        })),
    })),
    threads: threads.map((thread) => ({ ...thread, authorAvatar: avatarOf(thread.authorAvatar) })),
  };
}

/**
 * Les sujets rattachés aux points de la course d'une participation. Nul quand
 * la participation n'ouvre aucune communauté (archivée, ou pas la sienne) :
 * le Plan s'affiche alors sans rien en dire.
 */
export async function getParticipationCommunity(
  context: CommunityContext,
  input: unknown,
): Promise<ParticipationCommunity | null> {
  const useCase = 'getParticipationCommunity';
  const { participantRaceId } = parseCommand(participationQuerySchema, input, useCase);

  for (const community of await listMyCommunities(context)) {
    const race = community.myRaces.find((mine) => mine.participantRaceId === participantRaceId);
    if (race === undefined) continue;

    const threads = await attempt(useCase, () =>
      context.repositories.community.listThreads(community.editionId),
    );
    return {
      editionId: community.editionId,
      raceId: race.raceId,
      // Un sujet masqué par la modération n'a rien à faire sur le Plan, même pour son auteur.
      pointThreads: threads.filter(
        (thread) =>
          thread.status === 'published' &&
          thread.waypointId !== null &&
          thread.raceId === race.raceId,
      ),
    };
  }
  return null;
}

/** Un sujet et ses réponses. */
export async function getCommunityThread(
  context: CommunityContext,
  input: unknown,
): Promise<CommunityThreadView> {
  const useCase = 'getCommunityThread';
  const { threadId } = parseCommand(threadQuerySchema, input, useCase);

  const raw = await attempt(useCase, () => context.repositories.community.readThread(threadId));
  if (raw === null) throw notFoundError(useCase, 'sujet');

  const parsed = threadViewSchema.safeParse(raw);
  // La forme est celle de 0114 : un écart est un défaut de contrat, pas une saisie.
  if (!parsed.success) throw new Error(`[${useCase}] sujet illisible : contrat 0114 rompu`);

  const thread = parsed.data;
  const avatarOf = await avatarResolver(context, [
    thread.authorAvatar,
    ...thread.posts.map((post) => post.authorAvatar),
  ]);
  return {
    ...thread,
    authorAvatar: avatarOf(thread.authorAvatar),
    posts: thread.posts.map((post) => ({ ...post, authorAvatar: avatarOf(post.authorAvatar) })),
  };
}

export async function createCommunityThread(
  context: CommunityContext,
  input: unknown,
): Promise<{ readonly threadId: string }> {
  const useCase = 'createCommunityThread';
  const command = parseCommand(createCommunityThreadCommandSchema, input, useCase);

  const threadId = await attempt(useCase, () =>
    context.repositories.community.createThread({
      editionId: command.editionId,
      category: command.category,
      title: command.title,
      body: command.body,
      raceId: command.raceId,
      waypointId: command.waypointId,
    }),
  );
  return { threadId };
}

export async function replyToCommunityThread(
  context: CommunityContext,
  input: unknown,
): Promise<{ readonly postId: string }> {
  const useCase = 'replyToCommunityThread';
  const command = parseCommand(replyCommunityThreadCommandSchema, input, useCase);

  const postId = await attempt(useCase, () =>
    context.repositories.community.reply(command.threadId, command.body),
  );
  return { postId };
}

export async function setCommunityUseful(
  context: CommunityContext,
  input: unknown,
): Promise<{ readonly usefulCount: number }> {
  const useCase = 'setCommunityUseful';
  const command = parseCommand(setCommunityUsefulCommandSchema, input, useCase);

  const usefulCount = await attempt(useCase, () =>
    context.repositories.community.setUseful(asTarget(command.target), command.useful),
  );
  return { usefulCount };
}

export async function reportCommunityContent(
  context: CommunityContext,
  input: unknown,
): Promise<{ readonly reportId: string }> {
  const useCase = 'reportCommunityContent';
  const command = parseCommand(reportCommunityContentCommandSchema, input, useCase);
  const details = command.details === undefined || command.details === '' ? null : command.details;

  const reportId = await attempt(useCase, () =>
    context.repositories.community.report(asTarget(command.target), command.reason, details),
  );
  return { reportId };
}

export async function deleteCommunityContent(
  context: CommunityContext,
  input: unknown,
): Promise<void> {
  const useCase = 'deleteCommunityContent';
  const command = parseCommand(deleteCommunityContentCommandSchema, input, useCase);

  await attempt(useCase, () =>
    context.repositories.community.deleteContent(asTarget(command.target)),
  );
}
