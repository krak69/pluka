import { DbError, mapPostgrestError, type PostgrestLikeError } from '../errors.js';
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

export interface SubmitEventSiteContactInput {
  readonly slug: string;
  readonly clientIp: string | null;
  readonly senderName: string;
  readonly senderEmail: string;
  readonly raceSlug: string | null;
  readonly body: string;
}

export interface EventSiteRepository {
  /** Charge brute pour un sous-domaine, ou `null` si rien n'est en ligne à cette adresse. */
  findPublicBySlug(slug: string): Promise<unknown>;
  /**
   * Met un message du formulaire de contact en file (0052). `limited` : la
   * limite de débit est atteinte. `not_found` : rien à envoyer à cette adresse.
   */
  submitContact(input: SubmitEventSiteContactInput): Promise<'sent' | 'limited'>;
  /** Le chemin du fichier d'un document diffusé d'un site en ligne, ou `null` (0052). */
  findDocumentPath(sourceId: string): Promise<string | null>;
  /** Une adresse de téléchargement signée, valable `seconds` secondes. */
  signDocument(path: string, seconds: number): Promise<string>;
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

  async submitContact(input) {
    const operation = 'submit_event_site_contact';
    const result = await context.client.rpc(operation, {
      p_slug: input.slug,
      p_client_ip: input.clientIp ?? '',
      p_sender_name: input.senderName,
      p_sender_email: input.senderEmail,
      p_race_slug: input.raceSlug ?? '',
      p_body: input.body,
    });

    if (result.error !== null) {
      throw mapPostgrestError(result.error as PostgrestLikeError, operation);
    }
    return result.data === 'limited' ? 'limited' : 'sent';
  },

  async findDocumentPath(sourceId) {
    const operation = 'event_site_document_path';
    const result = await context.client.rpc(operation, { p_source_id: sourceId });

    if (result.error !== null) {
      throw mapPostgrestError(result.error as PostgrestLikeError, operation);
    }
    return typeof result.data === 'string' ? result.data : null;
  },

  async signDocument(path, seconds) {
    // Le fichier est lisible par cette session seulement s'il est diffusé
    // (policy de 0052) : la signature échoue sinon.
    const { data, error } = await context.client.storage
      .from('race-sources')
      .createSignedUrl(path, seconds, { download: true });

    if (error !== null) {
      throw new DbError({
        code: 'not_found',
        operation: 'race-sources.sign',
        message: error.message,
        cause: error,
      });
    }
    return data.signedUrl;
  },
}));
