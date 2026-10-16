import {
  createOrganizationTeamRepositories,
  eventSiteAssetStore,
  eventSiteEditingRepository,
} from '@pluka/db';
import type { EventSiteImageContext } from '@pluka/domain';

import type { Session } from '@/lib/session';
import { sharpSiteImages } from '@/lib/site-images';
import { createDataClient } from '@/lib/supabase/data';

/**
 * Contexte de l'éditeur du site — `/org/[id]/parametres/site`.
 *
 * Tout passe sous la session du membre : lectures sous RLS, écritures par les
 * RPC de 0049 et 0050, dépôt des images sous les policies de stockage de
 * 0051. Aucune clé de service.
 */
export function sessionEventSiteContext(session: Session): EventSiteImageContext {
  const client = createDataClient(session.accessToken);

  return {
    repositories: {
      eventSiteEditing: eventSiteEditingRepository({ client }),
      organizationTeam: createOrganizationTeamRepositories({ client }).organizationTeam,
    },
    actor: { userId: session.userId },
    assets: eventSiteAssetStore({ client }),
    images: sharpSiteImages,
  };
}
