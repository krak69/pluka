import { mapPostgrestError, type PostgrestLikeError } from '../errors.js';
import { defineRepository } from '../repository.js';

/*
 * Lecture publique du site d'un événement — migration 0049.
 *
 * Une seule fonction : `event_site_public` construit la charge publique côté
 * base (AGENTS §79) et décide de ce qui est en ligne. Ce repository ne
 * filtre rien et ne la façonne pas ; il la transmet telle quelle, et le
 * domaine la valide à l'entrée (AGENTS §60).
 *
 * Elle se lit sous la clé publiable, sans session : la fonction est ouverte à
 * `anon`, et la table `event_sites` ne l'est pas.
 */

export interface EventSiteRepository {
  /** Charge brute pour un sous-domaine, ou `null` si rien n'est en ligne à cette adresse. */
  findPublicBySlug(slug: string): Promise<unknown>;
}

export const eventSiteRepository = defineRepository<EventSiteRepository>((context) => ({
  async findPublicBySlug(slug) {
    const operation = 'event_site_public';
    const result = await context.client.rpc(operation, { p_slug: slug });

    if (result.error !== null) {
      throw mapPostgrestError(result.error as PostgrestLikeError, operation);
    }

    return result.data ?? null;
  },
}));
