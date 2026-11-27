import { randomUUID } from 'node:crypto';

import { createAccountIdentityRepositories } from '@pluka/db';
import type { AccountIdentityContext } from '@pluka/domain';

import { sharpAvatarImages } from '@/lib/avatar-images';
import type { Session } from '@/lib/session';
import { createDataClient } from '@/lib/supabase/data';

/**
 * Identité du compte et photo de profil — 0115.
 *
 * Sous la session du coureur : la base ne lui ouvre que sa propre ligne, et
 * le stockage que ses propres fichiers. Aucune clé de service.
 */
export function identityContext(session: Session): AccountIdentityContext {
  return {
    repositories: createAccountIdentityRepositories({
      client: createDataClient(session.accessToken),
    }),
    images: sharpAvatarImages,
    actor: { userId: session.userId },
    newKey: () => randomUUID(),
  };
}
