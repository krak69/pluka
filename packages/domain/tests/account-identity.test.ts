import { DbError, type AccountIdentityRecord } from '@pluka/db';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  AvatarImageRejected,
  communityAuthorLabel,
  getMyIdentity,
  illustrationFor,
  removeMyAvatar,
  updateMyIdentity,
  uploadMyAvatar,
  type AccountIdentityContext,
} from '../src/index.js';

/**
 * Identité du compte et photo de profil — 03_PRIVACY_RLS §54.1 ; 0115.
 *
 * La base garde la ligne du compte et vérifie la clé d'une photo (pgTAP 86).
 * Ici : la validation des saisies, l'ordre des gestes autour d'une photo
 * (réencoder, déposer, poser, retirer l'ancienne), et ce qui se passe quand
 * l'un d'eux échoue.
 */

const USER = '11111111-1111-4111-8111-111111111111';

let record: AccountIdentityRecord | null;
let steps: string[];
let signed: Record<string, string>;
let failSet: DbError | null;
let failRemove: boolean;
let failSign: boolean;
let rejectImage: boolean;
let updates: unknown[];

function context(): AccountIdentityContext {
  return {
    repositories: {
      identity: {
        findMine: async () => record,
        updateMine: async (_userId, input) => {
          updates.push(input);
        },
        setAvatarPhoto: async (path) => {
          steps.push(`set:${String(path)}`);
          if (failSet !== null) throw failSet;
          const previous = record?.avatarPath ?? null;
          if (record !== null) record = { ...record, avatarPath: path };
          return previous;
        },
      },
      avatars: {
        upload: async (path, bytes, contentType) => {
          steps.push(`upload:${path}:${bytes.length}:${contentType}`);
        },
        remove: async (paths) => {
          steps.push(`remove:${paths.join(',')}`);
          if (failRemove) throw new Error('stockage indisponible');
        },
        signedUrls: async (paths) => {
          steps.push(`sign:${paths.join(',')}`);
          if (failSign) throw new Error('stockage indisponible');
          return Object.fromEntries(
            paths.map((path) => [path, signed[path] ?? '']).filter(([, url]) => url !== ''),
          );
        },
      },
    },
    images: {
      process: async (bytes) => {
        steps.push(`process:${bytes.length}`);
        if (rejectImage) throw new AvatarImageRejected();
        return { bytes: new Uint8Array(7), contentType: 'image/webp' };
      },
    },
    actor: { userId: USER },
    newKey: () => 'k-1',
  };
}

beforeEach(() => {
  record = {
    email: 'alice@test.pluka',
    firstName: 'Alice',
    lastName: 'dupont',
    sex: 'female',
    avatarIllustration: null,
    avatarPath: null,
  };
  steps = [];
  signed = { 'old.webp': 'https://stockage/old' };
  failSet = null;
  failRemove = false;
  failSign = false;
  rejectImage = false;
  updates = [];
});

describe('libellés et illustration', () => {
  it('« Prénom N. », comme la Communauté ; « Participant » sans prénom', () => {
    expect(communityAuthorLabel('  Élodie ', 'martin')).toBe('Élodie M.');
    expect(communityAuthorLabel('Bruno', '  ')).toBe('Bruno');
    expect(communityAuthorLabel(null, 'Dupont')).toBe('Participant');
  });

  it('le choix l’emporte, sinon le sexe, sinon Neutre', () => {
    expect(illustrationFor('neutral', 'male')).toBe('neutral');
    expect(illustrationFor(null, 'male')).toBe('man');
    expect(illustrationFor(null, 'female')).toBe('woman');
    expect(illustrationFor(null, 'other')).toBe('neutral');
    expect(illustrationFor(null, null)).toBe('neutral');
  });
});

describe('lire son identité', () => {
  it('sans photo : l’illustration de son sexe, aucun lien demandé', async () => {
    const view = await getMyIdentity(context());

    expect(view).toMatchObject({
      firstName: 'Alice',
      illustration: 'woman',
      hasPhoto: false,
      photoUrl: null,
      communityLabel: 'Alice D.',
    });
    expect(steps).toEqual([]);
  });

  it('avec photo : un lien temporaire ; stockage en panne, le profil s’affiche sans', async () => {
    record = { ...record!, avatarPath: 'old.webp' };
    expect((await getMyIdentity(context())).photoUrl).toBe('https://stockage/old');

    failSign = true;
    const view = await getMyIdentity(context());
    expect(view.hasPhoto).toBe(true);
    expect(view.photoUrl).toBeNull();
  });
});

describe('modifier son identité', () => {
  it('noms nettoyés, champs vides lus comme absents', async () => {
    await updateMyIdentity(context(), {
      firstName: '  Alice ',
      lastName: '',
      sex: '',
      avatarIllustration: 'man',
    });

    expect(updates).toEqual([
      { firstName: 'Alice', lastName: null, sex: null, avatarIllustration: 'man' },
    ]);
  });

  it('une valeur hors liste, un nom trop long, un champ en trop : refusés, au bon champ', async () => {
    await expect(
      updateMyIdentity(context(), {
        firstName: 'A'.repeat(61),
        lastName: '',
        sex: 'robot',
        avatarIllustration: '',
      }),
    ).rejects.toMatchObject({
      code: 'validation',
      details: { firstName: expect.any(String), sex: expect.any(String) },
    });
    await expect(
      updateMyIdentity(context(), {
        firstName: 'Alice',
        lastName: '',
        sex: '',
        avatarIllustration: '',
        userId: 'quelqu-un-d-autre',
      }),
    ).rejects.toMatchObject({ code: 'validation' });
    expect(updates).toEqual([]);
  });
});

describe('déposer une photo', () => {
  it('réencodée, déposée sous une clé neuve, posée, puis l’ancienne retirée', async () => {
    record = { ...record!, avatarPath: 'old.webp' };

    await uploadMyAvatar(context(), { bytes: new Uint8Array(1200) });

    expect(steps).toEqual([
      'process:1200',
      'upload:k-1.webp:7:image/webp',
      'set:k-1.webp',
      'remove:old.webp',
    ]);
  });

  it('vide, trop lourde ou illisible : refusée au champ de la photo, sans rien déposer', async () => {
    await expect(uploadMyAvatar(context(), { bytes: new Uint8Array() })).rejects.toMatchObject({
      details: { photo: 'Choisis une photo.' },
    });
    await expect(
      uploadMyAvatar(context(), { bytes: new Uint8Array(10 * 1024 * 1024 + 1) }),
    ).rejects.toMatchObject({ details: { photo: 'Une photo de 10 Mo au plus.' } });

    rejectImage = true;
    await expect(uploadMyAvatar(context(), { bytes: new Uint8Array(10) })).rejects.toMatchObject({
      code: 'validation',
      details: { photo: expect.any(String) },
    });
    expect(steps.some((step) => step.startsWith('upload:'))).toBe(false);
  });

  it('une pose refusée retire le fichier déposé', async () => {
    failSet = new DbError({
      code: 'unknown',
      operation: 'set_my_avatar_photo',
      message: 'INVALID_AVATAR',
      cause: { code: '22023', message: 'INVALID_AVATAR' },
    });

    await expect(uploadMyAvatar(context(), { bytes: new Uint8Array(10) })).rejects.toMatchObject({
      code: 'validation',
      details: { photo: expect.any(String) },
    });
    expect(steps).toEqual([
      'process:10',
      'upload:k-1.webp:7:image/webp',
      'set:k-1.webp',
      'remove:k-1.webp',
    ]);
  });

  it('une pose faite mais dont la réponse s’est perdue : la photo posée n’est pas retirée', async () => {
    failSet = new DbError({
      code: 'unavailable',
      operation: 'set_my_avatar_photo',
      message: 'coupure',
    });
    const identity = context().repositories.identity;
    const ctx = context();
    const lostAnswer: AccountIdentityContext = {
      ...ctx,
      repositories: {
        ...ctx.repositories,
        identity: {
          ...identity,
          setAvatarPhoto: async (path) => {
            steps.push(`set:${String(path)}`);
            if (record !== null) record = { ...record, avatarPath: path };
            throw failSet;
          },
        },
      },
    };

    await expect(uploadMyAvatar(lostAnswer, { bytes: new Uint8Array(10) })).rejects.toBeDefined();
    expect(steps).not.toContain('remove:k-1.webp');
    expect(record?.avatarPath).toBe('k-1.webp');
  });

  it('l’ancienne qui ne part pas ne fait pas échouer le dépôt', async () => {
    record = { ...record!, avatarPath: 'old.webp' };
    failRemove = true;

    await expect(uploadMyAvatar(context(), { bytes: new Uint8Array(10) })).resolves.toBeUndefined();
    expect(record?.avatarPath).toBe('k-1.webp');
  });
});

describe('retirer sa photo', () => {
  it('le fichier d’abord, puis la clé ; sans photo, rien', async () => {
    await removeMyAvatar(context());
    expect(steps).toEqual([]);

    record = { ...record!, avatarPath: 'old.webp' };
    await removeMyAvatar(context());
    expect(steps).toEqual(['remove:old.webp', 'set:null']);
  });

  it('un retrait refusé laisse la photo en place et le dit', async () => {
    record = { ...record!, avatarPath: 'old.webp' };
    failRemove = true;

    await expect(removeMyAvatar(context())).rejects.toThrow();
    expect(steps).toEqual(['remove:old.webp']);
    expect(record?.avatarPath).toBe('old.webp');
  });
});
