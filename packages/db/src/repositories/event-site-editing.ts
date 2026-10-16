import { selectColumns } from '../columns.js';
import { DbError, mapPostgrestError, type PostgrestLikeError } from '../errors.js';
import { defineRepository, type RepositoryContext } from '../repository.js';
import { unwrap, unwrapMaybe } from '../results.js';
import type { Enum, PlukaClient } from '../types.js';

/*
 * Édition du site d'un événement — migrations 0049, 0050.
 *
 * Les lectures passent sous la session du membre : la RLS ouvre aux membres
 * de l'organisation ses événements, ses éditions, ses épreuves et son site,
 * et rien d'autre. Les écritures passent par les RPC, qui revérifient le rôle
 * du geste (editor édite, admin publie) et journalisent.
 *
 * Le dépôt des images passe lui aussi par la session : les policies de 0051
 * n'ouvrent le bucket `event-site-assets` qu'aux éditeurs de l'événement,
 * dans son dossier. Aucune clé de service.
 */

export interface EventSiteEventRecord {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: Enum<'record_status'>;
}

export interface EventSiteRecord {
  readonly eventId: string;
  readonly status: Enum<'event_site_status'>;
  readonly accentColor: string | null;
  readonly headingFont: string | null;
  readonly logoPath: string | null;
  readonly coverPath: string | null;
  readonly contactEmail: string | null;
  readonly publishedAt: string | null;
}

export interface EventSiteSectionRecord {
  readonly title: string;
  readonly body: string;
}

export interface EventSiteEditionRecord {
  readonly id: string;
  readonly year: number;
  readonly slug: string;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly status: Enum<'edition_status'>;
  readonly registrationUrl: string | null;
}

export interface EventSiteRaceRecord {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly startDatetime: string;
  readonly registrationUrl: string | null;
  readonly publicVisibility: Enum<'race_visibility'>;
  readonly status: Enum<'race_status'>;
}

export interface EventSiteDocumentRecord {
  readonly id: string;
  readonly title: string;
  readonly sourceType: Enum<'source_type'>;
  readonly hasFile: boolean;
  readonly url: string | null;
  readonly publicDownloadAt: string | null;
}

export interface SaveEventSiteInput {
  readonly eventId: string;
  readonly accentColor: string | null;
  readonly headingFont: string | null;
  readonly contactEmail: string | null;
  readonly sections: readonly EventSiteSectionRecord[];
  /** Nul : les liens d'inscription ne sont pas touchés (0050). */
  readonly registration: {
    readonly editionId: string;
    readonly editionUrl: string | null;
    readonly races: readonly { readonly raceId: string; readonly url: string | null }[];
  } | null;
}

export interface EventSiteEditingRepository {
  listOrganizationEvents(organizationId: string): Promise<readonly EventSiteEventRecord[]>;
  findSite(eventId: string): Promise<EventSiteRecord | null>;
  listSections(eventId: string): Promise<readonly EventSiteSectionRecord[]>;
  listEditions(eventId: string): Promise<readonly EventSiteEditionRecord[]>;
  listRaces(editionId: string): Promise<readonly EventSiteRaceRecord[]>;
  save(input: SaveEventSiteInput): Promise<void>;
  /** `invalid_state` : le site est déjà dans cet état. */
  setStatus(eventId: string, status: 'published' | 'draft'): Promise<void>;
  setImage(eventId: string, kind: 'logo' | 'cover', path: string | null): Promise<void>;
  /** Les documents de l'édition, hors archivés et hors traces GPX. */
  listDocuments(editionId: string): Promise<readonly EventSiteDocumentRecord[]>;
  /** `invalid_state` : le document est déjà dans cet état (0049). */
  setDocumentPublic(sourceId: string, isPublic: boolean): Promise<void>;
}

interface RpcCapableClient {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

/* Les signatures étendues de 0050 ne sont pas toutes dans les types générés de la même façon. */
function rpc(client: PlukaClient): RpcCapableClient {
  return client as unknown as RpcCapableClient;
}

async function call(client: PlukaClient, operation: string, args: Record<string, unknown>) {
  const result = await rpc(client).rpc(operation, args);
  if (result.error !== null && result.error !== undefined) {
    throw mapPostgrestError(result.error as PostgrestLikeError, operation);
  }
}

const EVENT_COLUMNS = ['id', 'name', 'slug', 'status'] as const;
const SITE_COLUMNS = [
  'event_id',
  'status',
  'accent_color',
  'heading_font',
  'logo_path',
  'cover_path',
  'contact_email',
  'published_at',
] as const;
const SECTION_COLUMNS = ['title', 'body', 'sort_order'] as const;
const EDITION_COLUMNS = [
  'id',
  'year',
  'slug',
  'start_date',
  'end_date',
  'status',
  'registration_url',
] as const;
const DOCUMENT_COLUMNS = [
  'id',
  'title',
  'source_type',
  'storage_path',
  'url',
  'public_download_at',
  'status',
] as const;
const RACE_COLUMNS = [
  'id',
  'name',
  'slug',
  'start_datetime',
  'registration_url',
  'public_visibility',
  'status',
] as const;

export const eventSiteEditingRepository = defineRepository<EventSiteEditingRepository>(
  (context) => ({
    async listOrganizationEvents(organizationId) {
      const rows = unwrap(
        await context.client
          .from('events')
          .select(selectColumns('events', EVENT_COLUMNS))
          .eq('organization_id', organizationId)
          .order('name', { ascending: true }),
        'events.listForSite',
      );
      return rows.map((row) => ({ id: row.id, name: row.name, slug: row.slug, status: row.status }));
    },

    async findSite(eventId) {
      const row = unwrapMaybe(
        await context.client
          .from('event_sites')
          .select(selectColumns('event_sites', SITE_COLUMNS))
          .eq('event_id', eventId)
          .maybeSingle(),
        'event_sites.find',
      );
      if (row === null) return null;

      return {
        eventId: row.event_id,
        status: row.status,
        accentColor: row.accent_color,
        headingFont: row.heading_font,
        logoPath: row.logo_path,
        coverPath: row.cover_path,
        contactEmail: row.contact_email,
        publishedAt: row.published_at,
      };
    },

    async listSections(eventId) {
      const rows = unwrap(
        await context.client
          .from('event_site_sections')
          .select(selectColumns('event_site_sections', SECTION_COLUMNS))
          .eq('event_id', eventId)
          .order('sort_order', { ascending: true }),
        'event_site_sections.list',
      );
      return rows.map((row) => ({ title: row.title, body: row.body }));
    },

    async listEditions(eventId) {
      const rows = unwrap(
        await context.client
          .from('editions')
          .select(selectColumns('editions', EDITION_COLUMNS))
          .eq('event_id', eventId)
          .order('start_date', { ascending: false }),
        'editions.listForSite',
      );
      return rows.map((row) => ({
        id: row.id,
        year: row.year,
        slug: row.slug,
        startDate: row.start_date,
        endDate: row.end_date,
        status: row.status,
        registrationUrl: row.registration_url,
      }));
    },

    async listRaces(editionId) {
      const rows = unwrap(
        await context.client
          .from('races')
          .select(selectColumns('races', RACE_COLUMNS))
          .eq('edition_id', editionId)
          .order('start_datetime', { ascending: true }),
        'races.listForSite',
      );
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        startDatetime: row.start_datetime,
        registrationUrl: row.registration_url,
        publicVisibility: row.public_visibility,
        status: row.status,
      }));
    },

    async save(input) {
      await call(context.client, 'save_event_site', {
        p_event_id: input.eventId,
        p_accent_color: input.accentColor,
        p_heading_font: input.headingFont,
        p_contact_email: input.contactEmail,
        p_sections: input.sections.map((section) => ({ title: section.title, body: section.body })),
        p_edition_id: input.registration?.editionId ?? null,
        p_edition_registration_url: input.registration?.editionUrl ?? null,
        p_race_registration_urls:
          input.registration === null
            ? null
            : input.registration.races.map((race) => ({ raceId: race.raceId, url: race.url })),
      });
    },

    async setStatus(eventId, status) {
      await call(context.client, 'set_event_site_status', {
        p_event_id: eventId,
        p_status: status,
      });
    },

    async setImage(eventId, kind, path) {
      await call(context.client, 'set_event_site_image', {
        p_event_id: eventId,
        p_kind: kind,
        p_path: path,
      });
    },

    async listDocuments(editionId) {
      const rows = unwrap(
        await context.client
          .from('sources')
          .select(selectColumns('sources', DOCUMENT_COLUMNS))
          .eq('edition_id', editionId)
          .neq('status', 'archived')
          .neq('source_type', 'gpx')
          .order('title', { ascending: true }),
        'sources.listForSite',
      );
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        sourceType: row.source_type,
        hasFile: row.storage_path !== null,
        url: row.url,
        publicDownloadAt: row.public_download_at,
      }));
    },

    async setDocumentPublic(sourceId, isPublic) {
      await call(context.client, 'set_source_public_download', {
        p_source_id: sourceId,
        p_public: isPublic,
      });
    },
  }),
);

/** Le bucket public des images de site (0049), écrit sous la session de l'éditeur (0051). */
export const EVENT_SITE_ASSETS_BUCKET = 'event-site-assets';

export interface EventSiteAssetStore {
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  remove(paths: readonly string[]): Promise<void>;
}

export function eventSiteAssetStore(context: RepositoryContext): EventSiteAssetStore {
  const bucket = () => context.client.storage.from(EVENT_SITE_ASSETS_BUCKET);

  return {
    async upload(path, bytes, contentType) {
      const { error } = await bucket().upload(path, bytes, { contentType, upsert: false });
      if (error !== null) {
        throw new DbError({
          code: 'unavailable',
          operation: 'event-site-assets.upload',
          message: error.message,
          cause: error,
        });
      }
    },

    async remove(paths) {
      if (paths.length === 0) return;
      const { error } = await bucket().remove([...paths]);
      if (error !== null) {
        throw new DbError({
          code: 'unavailable',
          operation: 'event-site-assets.remove',
          message: error.message,
          cause: error,
        });
      }
    },
  };
}
