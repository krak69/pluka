import { describe, expect, it } from 'vitest';

import { DbError, communityRepository, type PlukaClient } from '../src/index.js';

/**
 * Repository de la communauté — migration 0114.
 *
 * Il nomme la fonction, passe les arguments et traduit les lignes. Ce que ce
 * fichier vérifie : la cible « sujet ou réponse » passe l'autre en nul, une
 * course et un point facultatifs ne sont pas envoyés, et une colonne nulle
 * d'une fonction `returns table` reste nulle.
 */

function fakeClient(answer: { data: unknown; error: unknown }) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];

  const client = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve(answer);
    },
  } as unknown as PlukaClient;

  return { client, calls };
}

describe('communityRepository', () => {
  it('liste les sujets d’une édition ; course et point restent nuls sans rattachement', async () => {
    const { client, calls } = fakeClient({
      data: [
        {
          id: 't-1',
          race_id: null,
          race_name: null,
          category: 'logistics',
          title: 'Navette retour ?',
          waypoint_id: null,
          waypoint_name: null,
          author_label: 'Alice D.',
          is_mine: false,
          status: 'published',
          created_at: '2026-11-27T09:00:00+00:00',
          last_activity_at: '2026-11-27T09:30:00+00:00',
          reply_count: 2,
          useful_count: 1,
          useful_by_me: true,
        },
      ],
      error: null,
    });

    const threads = await communityRepository({ client }).listThreads('e-1');

    expect(calls).toEqual([{ name: 'community_threads_list', args: { p_edition_id: 'e-1' } }]);
    expect(threads[0]).toMatchObject({
      raceId: null,
      waypointName: null,
      authorLabel: 'Alice D.',
      replyCount: 2,
      usefulByMe: true,
    });
  });

  it('un sujet sans course ni point n’envoie ni l’une ni l’autre', async () => {
    const { client, calls } = fakeClient({ data: 't-1', error: null });

    await communityRepository({ client }).createThread({
      editionId: 'e-1',
      category: 'other',
      title: 'Question',
      body: '',
      raceId: null,
      waypointId: null,
    });

    expect(calls[0]).toEqual({
      name: 'create_community_thread',
      args: { p_edition_id: 'e-1', p_category: 'other', p_title: 'Question', p_body: '' },
    });
  });

  it('une cible est un sujet ou une réponse : l’autre part nul', async () => {
    const { client, calls } = fakeClient({ data: 4, error: null });
    const repository = communityRepository({ client });

    await expect(repository.setUseful({ postId: 'p-1' }, true)).resolves.toBe(4);
    await repository.report({ threadId: 't-1' }, 'spam', null);

    expect(calls).toEqual([
      {
        name: 'set_community_useful',
        args: { p_thread_id: null, p_post_id: 'p-1', p_useful: true },
      },
      {
        name: 'report_community_content',
        args: { p_thread_id: 't-1', p_post_id: null, p_reason: 'spam' },
      },
    ]);
  });

  it('supprimer ne rend rien et ne prend pas un vide pour une erreur', async () => {
    const { client, calls } = fakeClient({ data: null, error: null });

    await expect(
      communityRepository({ client }).deleteContent({ threadId: 't-1' }),
    ).resolves.toBeUndefined();
    expect(calls[0]?.args).toEqual({ p_thread_id: 't-1', p_post_id: null });
  });

  it('garde le motif SQL pour le domaine', async () => {
    const { client } = fakeClient({
      data: null,
      error: { code: '22023', message: 'THREAD_CLOSED' },
    });

    const failure = await communityRepository({ client })
      .reply('t-1', 'Encore ?')
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DbError);
    expect((failure as DbError).cause).toMatchObject({ code: '22023', message: 'THREAD_CLOSED' });
  });
});
