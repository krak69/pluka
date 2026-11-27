import {
  DbError,
  type AccountIdentityRepository,
  type AvatarIllustration,
  type AvatarStore,
  type ProfileSex,
} from '@pluka/db';
import { z } from 'zod';

import type { Actor } from '../authorization/organization-role.js';
import { notFoundError, parseCommand, validationError } from '../errors.js';

/**
 * Identité du compte et photo de profil — 03_PRIVACY_RLS §12, §54.1 ;
 * 00_PRODUCT_SPEC §21 ; migration 0115.
 *
 * Comme le Profil trailer, rien ici ne nomme un autre compte : on lit et on
 * écrit la ligne de `context.actor`. La photo est réencodée avant d'être
 * déposée (WebP carré, métadonnées retirées) et se range sous une clé
 * aléatoire ; la base vérifie qu'elle appartient au compte avant de la poser.
 *
 * Sans photo, une illustration représente le coureur : celle qu'il a choisie,
 * sinon celle de son sexe s'il l'a renseigné, sinon Neutre. La même règle est
 * écrite en SQL (`private.community_author_avatar`) pour les autres lecteurs.
 */

/** Recadre, réencode et nettoie une photo. Lève `AvatarImageRejected` si ce n'est pas une image. */
export interface AvatarImageProcessor {
  process(bytes: Uint8Array): Promise<{ readonly bytes: Uint8Array; readonly contentType: string }>;
}

export class AvatarImageRejected extends Error {
  constructor(message = 'image illisible') {
    super(message);
    this.name = 'AvatarImageRejected';
  }
}

export interface AccountIdentityContext {
  readonly repositories: {
    readonly identity: AccountIdentityRepository;
    readonly avatars: AvatarStore;
  };
  readonly images: AvatarImageProcessor;
  readonly actor: Actor;
  /** Une clé aléatoire (UUID) pour chaque nouvelle photo : injectée, pour les tests. */
  readonly newKey: () => string;
}

export const PROFILE_SEXES = ['female', 'male', 'other'] as const satisfies readonly ProfileSex[];
export const AVATAR_ILLUSTRATIONS = [
  'neutral',
  'man',
  'woman',
] as const satisfies readonly AvatarIllustration[];

export const NAME_MAX = 60;
/** Une photo plus lourde que ceci n'est pas une photo de profil : on la refuse avant de la décoder. */
export const AVATAR_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
/** Durée de vie d'un lien de lecture de photo. */
export const AVATAR_URL_SECONDS = 60 * 60;

export interface AccountIdentityView {
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly sex: ProfileSex | null;
  /** L'illustration choisie ; nulle sans choix. */
  readonly avatarIllustration: AvatarIllustration | null;
  /** Ce que les autres voient sans photo : le choix, sinon le sexe, sinon Neutre. */
  readonly illustration: AvatarIllustration;
  readonly hasPhoto: boolean;
  /** Un lien de lecture temporaire de sa photo ; nul sans photo ou si le stockage ne répond pas. */
  readonly photoUrl: string | null;
  /** Comment la Communauté l'affiche : « Prénom N. », ou « Participant » sans prénom. */
  readonly communityLabel: string;
}

/** L'illustration qui le représente sans photo — même règle que 0115. */
export function illustrationFor(
  choice: AvatarIllustration | null,
  sex: ProfileSex | null,
): AvatarIllustration {
  if (choice !== null) return choice;
  if (sex === 'male') return 'man';
  if (sex === 'female') return 'woman';
  return 'neutral';
}

/** « Prénom N. » — le libellé de `private.community_author_label` (0114). */
export function communityAuthorLabel(firstName: string | null, lastName: string | null): string {
  const first = firstName?.trim() ?? '';
  if (first === '') return 'Participant';
  const initial = lastName?.trim().charAt(0).toLocaleUpperCase('fr-FR') ?? '';
  return initial === '' ? first : `${first} ${initial}.`;
}

/** Un texte vide est une absence. */
function optionalName(field: string) {
  return z
    .string()
    .trim()
    .max(NAME_MAX, { error: `${field} : ${NAME_MAX} caractères au plus.` })
    .transform((value) => (value === '' ? null : value));
}

/** Une liste fermée, où le choix vide veut dire « non précisé ». */
function optionalChoice<const T extends readonly [string, ...string[]]>(values: T) {
  return z
    .union([z.enum(values), z.literal('')])
    .transform((value) => (value === '' ? null : value));
}

export const updateAccountIdentityCommandSchema = z
  .object({
    firstName: optionalName('Prénom'),
    lastName: optionalName('Nom'),
    sex: optionalChoice(PROFILE_SEXES),
    avatarIllustration: optionalChoice(AVATAR_ILLUSTRATIONS),
  })
  .strict();

function translate(error: unknown, useCase: string): unknown {
  if (!(error instanceof DbError)) return error;
  if (error.code === 'constraint_violation') {
    return validationError(useCase, 'valeur refusée par la base');
  }
  const cause = error.cause as { readonly code?: unknown; readonly message?: unknown } | undefined;
  if (cause?.code === '22023' && cause.message === 'INVALID_AVATAR') {
    return validationError(useCase, 'photo introuvable', {
      photo: 'La photo n’a pas pu être enregistrée. Réessaie.',
    });
  }
  return error;
}

async function attempt<T>(useCase: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw translate(error, useCase);
  }
}

export async function getMyIdentity(context: AccountIdentityContext): Promise<AccountIdentityView> {
  const useCase = 'getMyIdentity';
  const identity = await context.repositories.identity.findMine(context.actor.userId);
  if (identity === null) throw notFoundError(useCase, 'compte');

  let photoUrl: string | null = null;
  if (identity.avatarPath !== null) {
    // Un stockage qui ne répond pas n'empêche pas d'afficher le profil : l'illustration prend la place.
    const urls = await context.repositories.avatars
      .signedUrls([identity.avatarPath], AVATAR_URL_SECONDS)
      .catch(() => ({}) as Readonly<Record<string, string>>);
    photoUrl = urls[identity.avatarPath] ?? null;
  }

  return {
    email: identity.email,
    firstName: identity.firstName,
    lastName: identity.lastName,
    sex: identity.sex,
    avatarIllustration: identity.avatarIllustration,
    illustration: illustrationFor(identity.avatarIllustration, identity.sex),
    hasPhoto: identity.avatarPath !== null,
    photoUrl,
    communityLabel: communityAuthorLabel(identity.firstName, identity.lastName),
  };
}

export async function updateMyIdentity(
  context: AccountIdentityContext,
  input: unknown,
): Promise<void> {
  const useCase = 'updateMyIdentity';
  const command = parseCommand(updateAccountIdentityCommandSchema, input, useCase);

  await attempt(useCase, () =>
    context.repositories.identity.updateMine(context.actor.userId, command),
  );
}

/**
 * Déposer une photo : réencodée, rangée sous une clé neuve, puis posée. La
 * précédente est retirée du stockage ; si la pose échoue, la nouvelle aussi.
 */
export async function uploadMyAvatar(
  context: AccountIdentityContext,
  input: { readonly bytes: Uint8Array },
): Promise<void> {
  const useCase = 'uploadMyAvatar';
  if (input.bytes.length === 0) {
    throw validationError(useCase, 'aucun fichier', { photo: 'Choisis une photo.' });
  }
  if (input.bytes.length > AVATAR_UPLOAD_MAX_BYTES) {
    throw validationError(useCase, 'fichier trop lourd', {
      photo: 'Une photo de 10 Mo au plus.',
    });
  }

  let image: { readonly bytes: Uint8Array; readonly contentType: string };
  try {
    image = await context.images.process(input.bytes);
  } catch (error) {
    if (error instanceof AvatarImageRejected) {
      throw validationError(useCase, 'image illisible', {
        photo: 'Ce fichier n’est pas une image lisible (JPEG, PNG ou WebP).',
      });
    }
    throw error;
  }

  const key = `${context.newKey()}.webp`;
  await attempt(useCase, () =>
    context.repositories.avatars.upload(key, image.bytes, image.contentType),
  );

  let previous: string | null;
  try {
    previous = await context.repositories.identity.setAvatarPhoto(key);
  } catch (error) {
    // La nouvelle photo n'est rattachée à rien : elle ne reste pas dans le stockage. Sauf si
    // la pose a bien eu lieu et que seule la réponse s'est perdue : on relit avant de retirer.
    const current = await context.repositories.identity
      .findMine(context.actor.userId)
      .catch(() => null);
    if (current?.avatarPath !== key) {
      await context.repositories.avatars.remove([key]).catch(() => undefined);
    }
    throw translate(error, useCase);
  }

  if (previous !== null) {
    // Plus aucune lecture ne mène à l'ancienne : un échec de retrait ne fait pas échouer le dépôt.
    await context.repositories.avatars.remove([previous]).catch(() => undefined);
  }
}

/**
 * Retirer sa photo : le fichier d'abord, puis la clé. Un fichier introuvable
 * n'arrête rien ; un retrait refusé laisse la photo en place et le dit.
 */
export async function removeMyAvatar(context: AccountIdentityContext): Promise<void> {
  const useCase = 'removeMyAvatar';
  const identity = await context.repositories.identity.findMine(context.actor.userId);
  if (identity === null || identity.avatarPath === null) return;
  const path = identity.avatarPath;

  await attempt(useCase, () => context.repositories.avatars.remove([path]));
  await attempt(useCase, () => context.repositories.identity.setAvatarPhoto(null));
}
