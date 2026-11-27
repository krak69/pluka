import { describe, expect, it } from 'vitest';

import {
  accountIdentityRepository,
  avatarStore,
  DbError,
  toCommunityAvatar,
  type PlukaClient,
} from '../src/index.js';

/**
 * Identité du compte et photo de profil — migration 0115.
 *
 * Ce que ce fichier vérifie : la projection nommée de `users`, une mise à
 * jour qui ne touche jamais la clé de la photo (elle passe par la fonction
 * serveur), et les liens de lecture qui n'incluent que ce que le stockage a
 * accepté de signer.
 */

function fakeUsers(row: unknown, rpcAnswer: unknown = 'ancienne.webp') {
  const calls: string[] = [];
  const answer = Promise.resolve({ data: row, error: null });
  const builder: Record<string, unknown> = {
    select: (columns: string) => {
      calls.push(`select:${columns}`);
      return builder;
    },
    update: (values: unknown) => {
      calls.push(`update:${JSON.stringify(values)}`);
      return builder;
    },
    eq: (column: string, value: unknown) => {
      calls.push(`eq:${column}=${String(value)}`);
      return Object.assign(answer, builder);
    },
    maybeSingle: () => answer,
  };
  const rpcCalls: { name: string; args: unknown }[] = [];
  const client = {
    from: (table: string) => {
      calls.push(`from:${table}`);
      return builder;
    },
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: rpcAnswer, error: null });
    },
  } as unknown as PlukaClient;
  return { client, calls, rpcCalls };
}

function fakeStorage(answers: Record<string, { data?: unknown; error: unknown }>) {
  const calls: { method: string; args: unknown[] }[] = [];
  const bucket = (name: string) => ({
    upload: (...args: unknown[]) => {
      calls.push({ method: `${name}.upload`, args });
      return Promise.resolve(answers.upload ?? { error: null });
    },
    remove: (...args: unknown[]) => {
      calls.push({ method: `${name}.remove`, args });
      return Promise.resolve(answers.remove ?? { error: null });
    },
    createSignedUrls: (...args: unknown[]) => {
      calls.push({ method: `${name}.createSignedUrls`, args });
      return Promise.resolve(answers.createSignedUrls ?? { data: [], error: null });
    },
  });
  const client = { storage: { from: bucket } } as unknown as PlukaClient;
  return { client, calls };
}

describe('accountIdentityRepository', () => {
  it('lit sa propre ligne par une projection nommée ; une valeur hors liste se lit absente', async () => {
    const { client, calls } = fakeUsers({
      email: 'alice@test.pluka',
      first_name: 'Alice',
      last_name: null,
      sex: 'robot',
      avatar_illustration: 'woman',
      avatar_path: null,
    });

    const identity = await accountIdentityRepository({ client }).findMine('user-1');

    expect(calls).toEqual([
      'from:users',
      'select:email,first_name,last_name,sex,avatar_illustration,avatar_path',
      'eq:id=user-1',
    ]);
    expect(identity).toEqual({
      email: 'alice@test.pluka',
      firstName: 'Alice',
      lastName: null,
      sex: null,
      avatarIllustration: 'woman',
      avatarPath: null,
    });
  });

  it('une mise à jour ne touche jamais la clé de la photo', async () => {
    const { client, calls } = fakeUsers(null);

    await accountIdentityRepository({ client }).updateMine('user-1', {
      firstName: 'Alice',
      lastName: 'Dupont',
      sex: 'female',
      avatarIllustration: null,
    });

    expect(calls[1]).toBe(
      'update:{"first_name":"Alice","last_name":"Dupont","sex":"female","avatar_illustration":null}',
    );
    expect(calls).toContain('eq:id=user-1');
  });

  it('poser ou retirer la photo passe par la fonction serveur, qui rend l’ancienne clé', async () => {
    const { client, rpcCalls } = fakeUsers(null);

    await expect(accountIdentityRepository({ client }).setAvatarPhoto(null)).resolves.toBe(
      'ancienne.webp',
    );
    expect(rpcCalls).toEqual([{ name: 'set_my_avatar_photo', args: { p_path: null } }]);
  });
});

describe('première photo', () => {
  it('rien à remplacer : la fonction rend nul, ce n’est pas une ligne manquante', async () => {
    const { client } = fakeUsers(null, null);

    await expect(
      accountIdentityRepository({ client }).setAvatarPhoto('k.webp'),
    ).resolves.toBeNull();
  });
});

describe('avatarStore', () => {
  it('dépose dans le bucket des photos, sans jamais remplacer un fichier', async () => {
    const { client, calls } = fakeStorage({});
    const bytes = new Uint8Array([1, 2, 3]);

    await avatarStore({ client }).upload('k.webp', bytes, 'image/webp');

    expect(calls).toEqual([
      {
        method: 'avatars.upload',
        args: ['k.webp', bytes, { contentType: 'image/webp', upsert: false }],
      },
    ]);
  });

  it('un refus de policy devient une DbError de droit', async () => {
    const { client } = fakeStorage({
      upload: {
        error: { statusCode: '403', message: 'new row violates row-level security policy' },
      },
    });

    const failure = await avatarStore({ client })
      .upload('k.webp', new Uint8Array(), 'image/webp')
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DbError);
    expect((failure as DbError).code).toBe('permission_denied');
  });

  it('des liens de lecture pour les clés signées seulement, chaque clé une fois', async () => {
    const { client, calls } = fakeStorage({
      createSignedUrls: {
        data: [
          { path: 'a.webp', signedUrl: 'https://stockage/a', error: null },
          { path: 'b.webp', signedUrl: '', error: 'Either the object does not exist' },
        ],
        error: null,
      },
    });

    const urls = await avatarStore({ client }).signedUrls(['a.webp', 'b.webp', 'a.webp'], 3600);

    expect(urls).toEqual({ 'a.webp': 'https://stockage/a' });
    expect(calls[0]?.args).toEqual([['a.webp', 'b.webp'], 3600]);
  });

  it('aucune clé, aucun appel', async () => {
    const { client, calls } = fakeStorage({});

    expect(await avatarStore({ client }).signedUrls([], 3600)).toEqual({});
    await avatarStore({ client }).remove([]);
    expect(calls).toEqual([]);
  });
});

describe('toCommunityAvatar', () => {
  it('la photo par sa clé, sinon l’illustration ; une forme inattendue se lit Neutre', () => {
    expect(toCommunityAvatar({ kind: 'photo', path: 'k.webp' })).toEqual({
      kind: 'photo',
      path: 'k.webp',
    });
    expect(toCommunityAvatar({ kind: 'woman' })).toEqual({ kind: 'woman' });
    expect(toCommunityAvatar({ kind: 'photo' })).toEqual({ kind: 'neutral' });
    expect(toCommunityAvatar(null)).toEqual({ kind: 'neutral' });
  });
});
