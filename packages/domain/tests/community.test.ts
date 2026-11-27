import {
  DbError,
  type CommunityRepository,
  type CommunityTarget,
  type CommunityThreadSummaryRecord,
  type CourseWaypointRecord,
  type CreateCommunityThreadInput,
  type EditionRecord,
  type EventRecord,
  type ParticipantRaceEntry,
  type RaceRecord,
} from '@pluka/db';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createCommunityThread,
  deleteCommunityContent,
  DomainError,
  getCommunity,
  getCommunityThread,
  getParticipationCommunity,
  listMyCommunities,
  replyToCommunityThread,
  reportCommunityContent,
  setCommunityUseful,
  type CommunityContext,
} from '../src/index.js';

/**
 * Communauté d'édition — 00_PRODUCT_SPEC §21 ; 03_PRIVACY_RLS §53 à §55 ;
 * AC-COM-01 à AC-COM-04. La base (0114, pgTAP 85) tient les droits et la
 * portée ; ici : le rangement des communautés, la validation des entrées et
 * la traduction des refus.
 */

const NOW = new Date('2026-11-27T10:00:00.000Z');
const RUNNER = '11111111-1111-4111-8111-111111111111';

const EDITION_CLOCHERS = 'aaaaaaaa-0000-4000-8000-000000000012';
const EDITION_PAST = 'aaaaaaaa-0000-4000-8000-000000000022';
const EDITION_LATER = 'aaaaaaaa-0000-4000-8000-000000000032';
const THREAD = 'aaaaaaaa-0000-4000-8000-000000000191';
const POST = 'aaaaaaaa-0000-4000-8000-000000000192';

function race(id: string, editionId: string, name: string, start: string): RaceRecord {
  return { id, editionId, name, startDatetime: start, timezone: 'Europe/Paris' } as RaceRecord;
}

const RACES: RaceRecord[] = [
  race('r-9', EDITION_CLOCHERS, 'Les 9 clochers', '2027-10-10T07:20:00.000Z'),
  race('r-5', EDITION_CLOCHERS, 'Les 5 clochers', '2027-10-10T07:00:00.000Z'),
  race('r-2', EDITION_CLOCHERS, 'Les 2 clochers', '2027-10-10T07:10:00.000Z'),
  race('r-past', EDITION_PAST, 'Trail d’automne', '2026-10-04T06:00:00.000Z'),
  race('r-later', EDITION_LATER, 'Ultra de printemps', '2028-04-02T05:00:00.000Z'),
  race(
    'r-archived',
    'aaaaaaaa-0000-4000-8000-000000000042',
    'Course quittée',
    '2027-05-01T06:00:00.000Z',
  ),
];

function waypoint(id: string, name: string, sortOrder: number, distanceKm: number) {
  return { id, name, sortOrder, distanceKm } as CourseWaypointRecord;
}

const WAYPOINTS: Record<string, CourseWaypointRecord[]> = {
  'r-5': [waypoint('w-lenk', 'Lenk', 2, 12.3), waypoint('w-start', 'Départ', 1, 0)],
};

const EDITIONS: Record<string, EditionRecord> = {
  [EDITION_CLOCHERS]: { id: EDITION_CLOCHERS, eventId: 'ev-clochers', year: 2027 } as EditionRecord,
  [EDITION_PAST]: { id: EDITION_PAST, eventId: 'ev-automne', year: 2026 } as EditionRecord,
  [EDITION_LATER]: { id: EDITION_LATER, eventId: 'ev-printemps', year: 2028 } as EditionRecord,
};

const EVENTS: Record<string, EventRecord> = {
  'ev-clochers': { id: 'ev-clochers', name: 'Les Clochers' } as EventRecord,
  'ev-automne': { id: 'ev-automne', name: 'Trail d’automne' } as EventRecord,
  'ev-printemps': { id: 'ev-printemps', name: 'Ultra de printemps' } as EventRecord,
};

let participations: ParticipantRaceEntry[];
let threads: CommunityThreadSummaryRecord[];
let thread: unknown;
let calls: { method: string; args: unknown[] }[];
let failure: DbError | null;
let signed: Record<string, string>;
let signCalls: string[][];
let storageDown: boolean;

function dbFailure(code: DbError['code'], sqlState: string, message: string): DbError {
  return new DbError({
    code,
    operation: 'test',
    message,
    cause: { code: sqlState, message },
  });
}

function recorded<T>(method: string, args: unknown[], value: T): Promise<T> {
  calls.push({ method, args });
  if (failure !== null) return Promise.reject(failure);
  return Promise.resolve(value);
}

const community: CommunityRepository = {
  listThreads: (editionId) => recorded('listThreads', [editionId], threads),
  readThread: (threadId) => recorded('readThread', [threadId], thread),
  createThread: (input: CreateCommunityThreadInput) => recorded('createThread', [input], THREAD),
  reply: (threadId, body) => recorded('reply', [threadId, body], POST),
  setUseful: (target: CommunityTarget, useful) => recorded('setUseful', [target, useful], 3),
  report: (target, reason, details) => recorded('report', [target, reason, details], 'report-1'),
  deleteContent: (target) => recorded('deleteContent', [target], undefined),
};

function context(): CommunityContext {
  return {
    repositories: {
      community,
      participantRaces: { listForUser: async () => participations },
      races: {
        findById: async (id) => RACES.find((candidate) => candidate.id === id) ?? null,
        listByEdition: async (editionId) =>
          RACES.filter((candidate) => candidate.editionId === editionId),
      },
      editions: { findById: async (id) => EDITIONS[id] ?? null },
      events: { findById: async (id) => EVENTS[id] ?? null },
      waypoints: { listByRace: async (raceId) => WAYPOINTS[raceId] ?? [] },
      avatars: {
        signedUrls: async (paths) => {
          signCalls.push([...paths]);
          if (storageDown) throw new Error('stockage indisponible');
          return Object.fromEntries(
            paths.flatMap((path) => (signed[path] === undefined ? [] : [[path, signed[path]]])),
          );
        },
      },
    },
    actor: { userId: RUNNER },
    now: () => NOW,
  };
}

const THREAD_VIEW = {
  id: THREAD,
  editionId: EDITION_CLOCHERS,
  raceId: 'r-9',
  raceName: 'Les 9 clochers',
  category: 'race',
  title: 'Descente du col : technique ?',
  body: 'Roulant ou technique ?',
  waypointId: null,
  waypointName: null,
  authorLabel: 'Alice D.',
  authorAvatar: { kind: 'photo', path: 'alice.webp' },
  isMine: false,
  status: 'published',
  createdAt: '2026-11-27T09:00:00.000+00:00',
  usefulCount: 2,
  usefulByMe: true,
  canReply: true,
  canModerate: false,
  posts: [
    {
      id: POST,
      authorLabel: 'Bruno',
      authorAvatar: { kind: 'woman' },
      isMine: true,
      status: 'published',
      body: 'Technique sur la fin.',
      createdAt: '2026-11-27T09:30:00.000+00:00',
      usefulCount: 0,
      usefulByMe: false,
    },
  ],
};

beforeEach(() => {
  participations = [
    { participantRaceId: 'pr-9', raceId: 'r-9', status: 'active' },
    { participantRaceId: 'pr-past', raceId: 'r-past', status: 'finished' },
    { participantRaceId: 'pr-later', raceId: 'r-later', status: 'active' },
    { participantRaceId: 'pr-archived', raceId: 'r-archived', status: 'archived' },
  ];
  threads = [];
  thread = THREAD_VIEW;
  calls = [];
  failure = null;
  signed = { 'alice.webp': 'https://stockage/alice' };
  signCalls = [];
  storageDown = false;
});

describe('mes communautés', () => {
  it('une par édition, les prochaines par départ puis les passées ; jamais une participation archivée', async () => {
    const communities = await listMyCommunities(context());

    expect(communities.map((summary) => [summary.eventName, summary.year, summary.past])).toEqual([
      ['Les Clochers', 2027, false],
      ['Ultra de printemps', 2028, false],
      ['Trail d’automne', 2026, true],
    ]);
  });

  it('deux courses de la même édition : une seule communauté, ses courses dans l’ordre des départs', async () => {
    participations.push({ participantRaceId: 'pr-5', raceId: 'r-5', status: 'active' });

    const [clochers] = await listMyCommunities(context());

    expect(clochers?.editionId).toBe(EDITION_CLOCHERS);
    expect(clochers?.myRaces.map((entry) => entry.name)).toEqual([
      'Les 5 clochers',
      'Les 9 clochers',
    ]);
    expect(clochers?.startsAt).toBe('2027-10-10T07:00:00.000Z');
    expect(clochers?.timezone).toBe('Europe/Paris');
  });

  it('une course que la RLS ne rend pas est absente, sans erreur', async () => {
    participations.push({ participantRaceId: 'pr-x', raceId: 'r-invisible', status: 'active' });

    expect(await listMyCommunities(context())).toHaveLength(3);
  });
});

describe('une communauté', () => {
  it('son en-tête, toutes les courses de l’édition par départ, ses sujets', async () => {
    const view = await getCommunity(context(), { editionId: EDITION_CLOCHERS });

    expect(view.community.eventName).toBe('Les Clochers');
    expect(view.races.map((entry) => entry.name)).toEqual([
      'Les 5 clochers',
      'Les 2 clochers',
      'Les 9 clochers',
    ]);
    expect(view.races[0]?.points).toEqual([
      { waypointId: 'w-start', name: 'Départ', distanceKm: 0 },
      { waypointId: 'w-lenk', name: 'Lenk', distanceKm: 12.3 },
    ]);
    expect(view.races[2]?.points).toEqual([]);
    expect(calls).toEqual([{ method: 'listThreads', args: [EDITION_CLOCHERS] }]);
  });

  it('les sujets montrent la photo de leur auteur par lien temporaire ; sans photo, aucun appel au stockage', async () => {
    threads = [
      { id: 't-1', authorAvatar: { kind: 'photo', path: 'alice.webp' } },
      { id: 't-2', authorAvatar: { kind: 'man' } },
    ] as CommunityThreadSummaryRecord[];

    const view = await getCommunity(context(), { editionId: EDITION_CLOCHERS });

    expect(view.threads.map((thread) => thread.authorAvatar)).toEqual([
      { kind: 'photo', url: 'https://stockage/alice' },
      { kind: 'man' },
    ]);

    threads = [{ id: 't-2', authorAvatar: { kind: 'man' } }] as CommunityThreadSummaryRecord[];
    signCalls = [];
    await getCommunity(context(), { editionId: EDITION_CLOCHERS });
    expect(signCalls).toEqual([]);
  });

  it('§53 — une édition où il ne court pas : refusée sans interroger la base', async () => {
    await expect(
      getCommunity(context(), { editionId: 'aaaaaaaa-0000-4000-8000-000000000042' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(calls).toEqual([]);
  });

  it('le refus de la base devient un refus de domaine, sans détail', async () => {
    failure = dbFailure('permission_denied', '42501', 'communauté inaccessible');

    await expect(getCommunity(context(), { editionId: EDITION_CLOCHERS })).rejects.toMatchObject({
      code: 'forbidden',
      message: expect.not.stringContaining('communauté inaccessible'),
    });
  });
});

describe('depuis une participation', () => {
  const PR_5 = 'aaaaaaaa-0000-4000-8000-000000000305';

  function summary(
    id: string,
    raceId: string | null,
    waypointId: string | null,
    status: 'published' | 'hidden' = 'published',
  ): CommunityThreadSummaryRecord {
    return { id, raceId, waypointId, status, title: id } as CommunityThreadSummaryRecord;
  }

  it('les sujets publiés rattachés à un point de sa course, et seulement ceux-là', async () => {
    participations.push({ participantRaceId: PR_5, raceId: 'r-5', status: 'active' });
    threads = [
      summary('au-point', 'r-5', 'w-lenk'),
      summary('sans-point', 'r-5', null),
      summary('autre-course', 'r-9', 'w-9'),
      summary('masque', 'r-5', 'w-lenk', 'hidden'),
    ];

    const view = await getParticipationCommunity(context(), { participantRaceId: PR_5 });

    expect(view?.editionId).toBe(EDITION_CLOCHERS);
    expect(view?.raceId).toBe('r-5');
    expect(view?.pointThreads.map((entry) => entry.id)).toEqual(['au-point']);
  });

  it('une participation qui n’ouvre aucune communauté : rien, sans lire de sujet', async () => {
    participations.push({ participantRaceId: PR_5, raceId: 'r-5', status: 'archived' });

    expect(await getParticipationCommunity(context(), { participantRaceId: PR_5 })).toBeNull();
    expect(
      await getParticipationCommunity(context(), {
        participantRaceId: 'aaaaaaaa-0000-4000-8000-000000000399',
      }),
    ).toBeNull();
    expect(calls).toEqual([]);
  });

  it('un identifiant mal formé est une saisie refusée', async () => {
    await expect(
      getParticipationCommunity(context(), { participantRaceId: 'pr-9' }),
    ).rejects.toMatchObject({ code: 'validation' });
  });
});

describe('un sujet', () => {
  it('se lit tel que la base le construit', async () => {
    const view = await getCommunityThread(context(), { threadId: THREAD });

    expect(view.authorLabel).toBe('Alice D.');
    expect(view.posts).toHaveLength(1);
    expect(view.canReply).toBe(true);
  });

  it('la photo d’un auteur devient un lien temporaire, signé en un seul appel', async () => {
    const view = await getCommunityThread(context(), { threadId: THREAD });

    expect(view.authorAvatar).toEqual({ kind: 'photo', url: 'https://stockage/alice' });
    expect(view.posts[0]?.authorAvatar).toEqual({ kind: 'woman' });
    expect(signCalls).toEqual([['alice.webp']]);
  });

  it('une photo non signée, ou un stockage en panne : l’illustration Neutre, et le sujet s’affiche', async () => {
    signed = {};
    expect((await getCommunityThread(context(), { threadId: THREAD })).authorAvatar).toEqual({
      kind: 'neutral',
    });

    storageDown = true;
    const view = await getCommunityThread(context(), { threadId: THREAD });
    expect(view.authorAvatar).toEqual({ kind: 'neutral' });
    expect(view.title).toBe('Descente du col : technique ?');
  });

  it('masqué ou supprimé : introuvable', async () => {
    failure = dbFailure('not_found', 'P0002', 'NOT_FOUND');

    await expect(getCommunityThread(context(), { threadId: THREAD })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('un contrat rompu n’est pas pris pour une saisie', async () => {
    thread = { ...THREAD_VIEW, posts: 'pas une liste' };

    await expect(getCommunityThread(context(), { threadId: THREAD })).rejects.not.toBeInstanceOf(
      DomainError,
    );
  });
});

describe('écrire', () => {
  it('un sujet : titre nettoyé, corps facultatif, sans course ni point par défaut', async () => {
    const result = await createCommunityThread(context(), {
      editionId: EDITION_CLOCHERS,
      category: 'logistics',
      title: '  Navette retour ?  ',
    });

    expect(result).toEqual({ threadId: THREAD });
    expect(calls[0]?.args[0]).toEqual({
      editionId: EDITION_CLOCHERS,
      category: 'logistics',
      title: 'Navette retour ?',
      body: '',
      raceId: null,
      waypointId: null,
    });
  });

  it('un titre trop court ou une catégorie inconnue : refusés avant la base', async () => {
    await expect(
      createCommunityThread(context(), {
        editionId: EDITION_CLOCHERS,
        category: 'logistics',
        title: ' a ',
      }),
    ).rejects.toMatchObject({ code: 'validation', details: { title: expect.any(String) } });
    await expect(
      createCommunityThread(context(), {
        editionId: EDITION_CLOCHERS,
        category: 'followers',
        title: 'Qui me suit ?',
      }),
    ).rejects.toMatchObject({
      code: 'validation',
      details: { category: 'Choisis une catégorie.' },
    });
    expect(calls).toEqual([]);
  });

  it('une course ou un point hors de l’édition : le refus nomme le champ', async () => {
    failure = dbFailure('unknown', '22023', 'INVALID_WAYPOINT');

    await expect(
      createCommunityThread(context(), {
        editionId: EDITION_CLOCHERS,
        category: 'race',
        title: 'Le col de nuit ?',
        waypointId: 'aaaaaaaa-0000-4000-8000-000000000023',
      }),
    ).rejects.toMatchObject({ code: 'validation', details: { waypointId: expect.any(String) } });
  });

  it('une réponse vide est refusée ; un sujet fermé est un état, pas une panne', async () => {
    await expect(
      replyToCommunityThread(context(), { threadId: THREAD, body: '   ' }),
    ).rejects.toMatchObject({ code: 'validation', details: { body: 'Écris ta réponse.' } });

    failure = dbFailure('unknown', '22023', 'THREAD_CLOSED');
    await expect(
      replyToCommunityThread(context(), { threadId: THREAD, body: 'Encore ?' }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('« utile » vise un sujet ou une réponse, jamais les deux', async () => {
    expect(await setCommunityUseful(context(), { target: { postId: POST }, useful: true })).toEqual(
      { usefulCount: 3 },
    );
    expect(calls[0]?.args).toEqual([{ postId: POST }, true]);

    await expect(
      setCommunityUseful(context(), { target: { threadId: THREAD, postId: POST }, useful: true }),
    ).rejects.toMatchObject({ code: 'validation' });
  });

  it('un signalement : motif connu, précision facultative et nettoyée', async () => {
    await reportCommunityContent(context(), {
      target: { threadId: THREAD },
      reason: 'misinformation',
      details: '   ',
    });
    expect(calls[0]?.args).toEqual([{ threadId: THREAD }, 'misinformation', null]);

    await expect(
      reportCommunityContent(context(), { target: { threadId: THREAD }, reason: 'boring' }),
    ).rejects.toMatchObject({ code: 'validation', details: { reason: 'Choisis un motif.' } });
  });

  it('supprimer le contenu d’un autre : refusé', async () => {
    failure = dbFailure('permission_denied', '42501', 'contenu inaccessible');

    await expect(
      deleteCommunityContent(context(), { target: { postId: POST } }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
