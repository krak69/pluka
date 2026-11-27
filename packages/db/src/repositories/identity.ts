import { selectColumns } from '../columns.js';
import { defineRepository, type RepositoryContext } from '../repository.js';
import { unwrapMaybe } from '../results.js';
import { storageError } from './gpx.js';

/**
 * Identité du compte et photo de profil — 03_PRIVACY_RLS §12, §54.1 ;
 * migration 0115.
 *
 * Le compte ne lit et n'écrit que sa propre ligne de `users` (0005). Prénom,
 * nom, sexe et illustration s'écrivent par des colonnes accordées ; la clé de
 * la photo, par `set_my_avatar_photo`, qui vérifie qu'elle désigne un fichier
 * du compte. Les fichiers vivent dans le bucket privé `avatars`, sous une clé
 * aléatoire : jamais l'identifiant du compte dans un chemin.
 */

export type ProfileSex = 'female' | 'male' | 'other';
export type AvatarIllustration = 'neutral' | 'man' | 'woman';

export const AVATARS_BUCKET = 'avatars';

export interface AccountIdentityRecord {
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly sex: ProfileSex | null;
  readonly avatarIllustration: AvatarIllustration | null;
  readonly avatarPath: string | null;
}

export interface UpdateAccountIdentityInput {
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly sex: ProfileSex | null;
  readonly avatarIllustration: AvatarIllustration | null;
}

export interface AccountIdentityRepository {
  findMine(userId: string): Promise<AccountIdentityRecord | null>;
  updateMine(userId: string, input: UpdateAccountIdentityInput): Promise<void>;
  /** Pose (ou retire, avec `null`) la photo ; rend la clé de la précédente, à retirer du stockage. */
  setAvatarPhoto(path: string | null): Promise<string | null>;
}

const IDENTITY_COLUMNS = [
  'email',
  'first_name',
  'last_name',
  'sex',
  'avatar_illustration',
  'avatar_path',
] as const;

const SEXES: readonly ProfileSex[] = ['female', 'male', 'other'];
const ILLUSTRATIONS: readonly AvatarIllustration[] = ['neutral', 'man', 'woman'];

/** Une valeur hors de la liste se lit comme une absence : la base la contraint déjà. */
function oneOf<T extends string>(values: readonly T[], value: unknown): T | null {
  return values.find((candidate) => candidate === value) ?? null;
}

export const accountIdentityRepository = defineRepository<AccountIdentityRepository>(
  (context: RepositoryContext) => ({
    async findMine(userId) {
      const row = unwrapMaybe(
        await context.client
          .from('users')
          .select(selectColumns('users', IDENTITY_COLUMNS))
          .eq('id', userId)
          .maybeSingle(),
        'users.findMine',
      );
      if (row === null) return null;

      return {
        email: String(row.email),
        firstName: row.first_name,
        lastName: row.last_name,
        sex: oneOf(SEXES, row.sex),
        avatarIllustration: oneOf(ILLUSTRATIONS, row.avatar_illustration),
        avatarPath: row.avatar_path,
      };
    },

    async updateMine(userId, input) {
      unwrapMaybe(
        await context.client
          .from('users')
          .update({
            first_name: input.firstName,
            last_name: input.lastName,
            sex: input.sex,
            avatar_illustration: input.avatarIllustration,
          })
          .eq('id', userId),
        'users.updateMine',
      );
    },

    async setAvatarPhoto(path) {
      // Une première photo n'en remplace aucune : la fonction rend nul, ce n'est pas une absence de ligne.
      const previous = unwrapMaybe(
        await context.client.rpc('set_my_avatar_photo', {
          // La fonction accepte une clé nulle (retirer la photo) ; les types générés ne savent pas le dire.
          p_path: path as string,
        }),
        'set_my_avatar_photo',
      ) as string | null;
      return previous ?? null;
    },
  }),
);

/** Les fichiers de photo, sous la session du compte (0115). */
export interface AvatarStore {
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  remove(paths: readonly string[]): Promise<void>;
  /**
   * Des liens de lecture temporaires, par clé. Une clé que la base ne laisse
   * pas lire au compte est absente du résultat : l'écran montre alors
   * l'illustration.
   */
  signedUrls(
    paths: readonly string[],
    expiresInSeconds: number,
  ): Promise<Readonly<Record<string, string>>>;
}

export function avatarStore(context: RepositoryContext): AvatarStore {
  const bucket = () => context.client.storage.from(AVATARS_BUCKET);

  return {
    async upload(path, bytes, contentType) {
      const { error } = await bucket().upload(path, bytes, { contentType, upsert: false });
      if (error !== null) throw storageError(error, 'avatars.upload');
    },

    async remove(paths) {
      if (paths.length === 0) return;
      const { error } = await bucket().remove([...paths]);
      if (error !== null) throw storageError(error, 'avatars.remove');
    },

    async signedUrls(paths, expiresInSeconds) {
      const unique = [...new Set(paths)];
      if (unique.length === 0) return {};

      const { data, error } = await bucket().createSignedUrls(unique, expiresInSeconds);
      if (error !== null) throw storageError(error, 'avatars.signedUrls');

      return Object.fromEntries(
        (data ?? []).flatMap((entry) =>
          entry.error === null &&
          typeof entry.path === 'string' &&
          typeof entry.signedUrl === 'string'
            ? [[entry.path, entry.signedUrl] as const]
            : [],
        ),
      );
    },
  };
}

export interface AccountIdentityRepositories {
  readonly identity: AccountIdentityRepository;
  readonly avatars: AvatarStore;
}

export function createAccountIdentityRepositories(
  context: RepositoryContext,
): AccountIdentityRepositories {
  return { identity: accountIdentityRepository(context), avatars: avatarStore(context) };
}
