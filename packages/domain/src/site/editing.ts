import {
  DbError,
  type EventSiteAssetStore,
  type EventSiteDocumentRecord,
  type EventSiteEditingRepository,
  type EventSiteEditionRecord,
  type EventSiteEventRecord,
  type EventSiteRaceRecord,
  type EventSiteRecord,
  type EventSiteSectionRecord,
  type OrganizationTeamRepository,
} from '@pluka/db';
import { z } from 'zod';

import { hasOrganizationRole, type OrganizationRole } from '../authorization/organization-role.js';
import {
  forbiddenError,
  invalidStateError,
  notFoundError,
  parseCommand,
  validationError,
} from '../errors.js';
import { SITE_HEADING_FONTS, accentContrastIssue } from './appearance.js';
import { isSiteSubdomain } from './subdomain.js';

/**
 * L'éditeur du site d'un événement — EVENT_SITE §4, §5, §8 ; migrations 0049, 0050.
 *
 * L'organisation édite son site depuis `/org/[id]/parametres/site`. Les rôles
 * sont ceux du spec : owner, admin et editor éditent ; owner et admin
 * publient ; un viewer voit sans rien changer. La base revérifie chaque geste
 * (0049) — la RLS protège la donnée, le use case protège l'opération.
 *
 * L'accent est refusé ici s'il n'est pas lisible : la base ne contrôle que sa
 * forme, le contraste est une règle de domaine (AA, 06_DESIGN_SYSTEM §96).
 */

export interface EventSiteImageProcessor {
  /**
   * Redimensionne, recadre et réencode une image déposée. Lève
   * `EventSiteImageRejected` si le fichier n'est pas une image lisible.
   */
  process(
    kind: EventSiteImageKind,
    bytes: Uint8Array,
  ): Promise<{ readonly bytes: Uint8Array; readonly contentType: string; readonly extension: string }>;
}

export class EventSiteImageRejected extends Error {
  constructor(message = 'image illisible') {
    super(message);
    this.name = 'EventSiteImageRejected';
  }
}

export type EventSiteImageKind = 'logo' | 'cover';

export interface EventSiteEditingContext {
  readonly repositories: {
    readonly eventSiteEditing: EventSiteEditingRepository;
    readonly organizationTeam: Pick<OrganizationTeamRepository, 'listOwnMemberships'>;
  };
  readonly actor: { readonly userId: string };
}

/** Le dépôt des images : sous la session de l'éditeur (0051), après la garde du rôle. */
export interface EventSiteImageContext extends EventSiteEditingContext {
  readonly assets: EventSiteAssetStore;
  readonly images: EventSiteImageProcessor;
}

export interface EventSitePermissions {
  readonly role: OrganizationRole;
  readonly canEdit: boolean;
  readonly canPublish: boolean;
}

/** Ce qui empêche un site publié d'être en ligne, dit à l'organisation (EVENT_SITE §7.3). */
export type EventSiteBlocker = 'event_not_published' | 'slug_not_subdomain' | 'no_public_race';

export interface EventSiteEditor {
  readonly organizationName: string;
  readonly permissions: EventSitePermissions;
  readonly events: readonly EventSiteEventRecord[];
  /** Nul : l'organisation n'a encore aucun événement. */
  readonly event: EventSiteEventRecord | null;
  /** Nul : le site n'a jamais été enregistré. */
  readonly site: EventSiteRecord | null;
  readonly sections: readonly EventSiteSectionRecord[];
  /** L'édition dont le site porte l'inscription : la prochaine à venir, sinon la dernière. */
  readonly edition: EventSiteEditionRecord | null;
  readonly races: readonly EventSiteRaceRecord[];
  /** Les documents de l'édition, et ceux que l'organisation diffuse (EVENT_SITE §3.4). */
  readonly documents: readonly EventSiteDocumentRecord[];
  readonly blockers: readonly EventSiteBlocker[];
}

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

export const getEventSiteEditorQuerySchema = z.object({
  organizationId: uuid,
  eventSlug: z.string().trim().min(1).max(200).optional(),
  /** Aujourd'hui, en date civile : passé par l'appelant (AGENTS §35). */
  today: isoDate,
});

/**
 * L'édition dont le site porte l'inscription. Même règle que la charge
 * publique (0049) : la prochaine à venir ; à défaut, la dernière. Une édition
 * annulée ou archivée n'est pas candidate.
 */
export function currentSiteEdition(
  editions: readonly EventSiteEditionRecord[],
  today: string,
): EventSiteEditionRecord | null {
  const candidates = editions.filter(
    (edition) => edition.status !== 'cancelled' && edition.status !== 'archived',
  );
  const upcoming = candidates
    .filter((edition) => (edition.endDate ?? edition.startDate) >= today)
    .sort((left, right) => left.startDate.localeCompare(right.startDate));
  if (upcoming[0] !== undefined) return upcoming[0];

  return [...candidates].sort((left, right) => right.startDate.localeCompare(left.startDate))[0] ?? null;
}

async function permissionsOf(
  context: EventSiteEditingContext,
  organizationId: string,
  useCase: string,
): Promise<EventSitePermissions & { readonly organizationName: string }> {
  const memberships = await context.repositories.organizationTeam.listOwnMemberships(
    context.actor.userId,
  );
  const membership = memberships.find((candidate) => candidate.organizationId === organizationId);
  // Un non-membre ne sait pas que l'organisation existe (03_PRIVACY_RLS §120).
  if (membership === undefined) throw notFoundError(useCase, 'organisation');

  return {
    organizationName: membership.organizationName,
    role: membership.role,
    canEdit: hasOrganizationRole(membership.role, 'editor'),
    canPublish: hasOrganizationRole(membership.role, 'admin'),
  };
}

async function eventOf(
  context: EventSiteEditingContext,
  organizationId: string,
  eventId: string,
  useCase: string,
): Promise<EventSiteEventRecord> {
  const events = await context.repositories.eventSiteEditing.listOrganizationEvents(organizationId);
  const event = events.find((candidate) => candidate.id === eventId);
  if (event === undefined) throw notFoundError(useCase, 'événement');
  return event;
}

function translate(error: unknown, useCase: string): unknown {
  if (!(error instanceof DbError)) return error;
  if (error.code === 'permission_denied') return forbiddenError(useCase);
  if (error.code === 'invalid_state') return invalidStateError(useCase, 'aucune modification');
  if (error.code === 'not_found') return notFoundError(useCase, 'site');
  return error;
}

export async function getEventSiteEditor(
  context: EventSiteEditingContext,
  input: unknown,
): Promise<EventSiteEditor> {
  const useCase = 'getEventSiteEditor';
  const query = parseCommand(getEventSiteEditorQuerySchema, input, useCase);
  const { organizationName, ...permissions } = await permissionsOf(
    context,
    query.organizationId,
    useCase,
  );
  const repository = context.repositories.eventSiteEditing;

  const events = await repository.listOrganizationEvents(query.organizationId);
  const event =
    (query.eventSlug === undefined
      ? undefined
      : events.find((candidate) => candidate.slug === query.eventSlug)) ?? events[0] ?? null;

  if (event === null) {
    return {
      organizationName,
      permissions,
      events,
      event: null,
      site: null,
      sections: [],
      edition: null,
      races: [],
      documents: [],
      blockers: [],
    };
  }

  const [site, sections, editions] = await Promise.all([
    repository.findSite(event.id),
    repository.listSections(event.id),
    repository.listEditions(event.id),
  ]);
  const edition = currentSiteEdition(editions, query.today);
  const [races, documents] =
    edition === null
      ? [[], []]
      : await Promise.all([repository.listRaces(edition.id), repository.listDocuments(edition.id)]);

  const blockers: EventSiteBlocker[] = [];
  if (event.status !== 'published') blockers.push('event_not_published');
  if (!isSiteSubdomain(event.slug)) blockers.push('slug_not_subdomain');
  if (!races.some((race) => race.status === 'published' && race.publicVisibility === 'public')) {
    blockers.push('no_public_race');
  }

  return {
    organizationName,
    permissions,
    events,
    event,
    site,
    sections,
    edition,
    races,
    documents,
    blockers,
  };
}

const httpsUrl = z
  .string()
  .trim()
  .max(2048)
  .url('adresse invalide')
  .refine((value) => value.startsWith('https://'), 'l’adresse doit commencer par https://');

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? null : value), schema.nullable());

export const saveEventSiteCommandSchema = z.object({
  organizationId: uuid,
  eventId: uuid,
  accentColor: optional(
    z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^#[0-9a-f]{6}$/u, 'couleur attendue au format #rrggbb'),
  ),
  headingFont: optional(z.enum(SITE_HEADING_FONTS)),
  contactEmail: optional(z.string().trim().max(254).email('adresse e-mail invalide')),
  sections: z
    .array(
      z.object({
        title: z.string().trim().min(1, 'titre requis').max(80),
        body: z.string().trim().min(1, 'texte requis').max(4000),
      }),
    )
    .max(20, '20 blocs au plus'),
  registration: z
    .object({
      editionId: uuid,
      editionUrl: optional(httpsUrl),
      races: z.array(z.object({ raceId: uuid, url: optional(httpsUrl) })),
    })
    .nullable(),
});

export type SaveEventSiteCommand = z.input<typeof saveEventSiteCommandSchema>;

export async function saveEventSite(context: EventSiteEditingContext, input: unknown): Promise<void> {
  const useCase = 'saveEventSite';
  const command = parseCommand(saveEventSiteCommandSchema, input, useCase);

  const permissions = await permissionsOf(context, command.organizationId, useCase);
  if (!permissions.canEdit) throw forbiddenError(useCase);
  await eventOf(context, command.organizationId, command.eventId, useCase);

  if (command.accentColor !== null) {
    const issue = accentContrastIssue(command.accentColor);
    if (issue !== null) {
      const ratio = issue.ratio.toLocaleString('fr-FR');
      throw validationError(useCase, 'couleur d’accent trop peu contrastée', {
        accentColor:
          issue.kind === 'text_on_accent'
            ? `Le texte des boutons ne se lirait pas assez sur cette couleur (${ratio}:1, il faut 4,5:1).`
            : `Cette couleur ne se détache pas assez du fond (${ratio}:1, il faut 3:1).`,
      });
    }
  }

  if (command.registration !== null) {
    const repository = context.repositories.eventSiteEditing;
    const editions = await repository.listEditions(command.eventId);
    if (!editions.some((edition) => edition.id === command.registration?.editionId)) {
      throw notFoundError(useCase, 'édition');
    }
    const races = await repository.listRaces(command.registration.editionId);
    const known = new Set(races.map((race) => race.id));
    if (command.registration.races.some((race) => !known.has(race.raceId))) {
      throw notFoundError(useCase, 'épreuve');
    }
  }

  try {
    await context.repositories.eventSiteEditing.save({
      eventId: command.eventId,
      accentColor: command.accentColor,
      headingFont: command.headingFont,
      contactEmail: command.contactEmail,
      sections: command.sections,
      registration: command.registration,
    });
  } catch (error) {
    throw translate(error, useCase);
  }
}

export const setEventSiteStatusCommandSchema = z.object({
  organizationId: uuid,
  eventId: uuid,
  status: z.enum(['published', 'draft']),
});

/** Mettre en ligne ou retirer : owner ou admin. La suspension appartient à l'admin PLUKA. */
export async function setEventSiteStatus(
  context: EventSiteEditingContext,
  input: unknown,
): Promise<void> {
  const useCase = 'setEventSiteStatus';
  const command = parseCommand(setEventSiteStatusCommandSchema, input, useCase);

  const permissions = await permissionsOf(context, command.organizationId, useCase);
  if (!permissions.canPublish) throw forbiddenError(useCase);
  const event = await eventOf(context, command.organizationId, command.eventId, useCase);

  const site = await context.repositories.eventSiteEditing.findSite(event.id);
  if (site === null) {
    throw invalidStateError(useCase, 'enregistrez le site avant de le mettre en ligne');
  }
  if (site.status === 'suspended') {
    throw invalidStateError(useCase, 'site suspendu par PLUKA');
  }
  if (command.status === 'published' && !isSiteSubdomain(event.slug)) {
    throw validationError(useCase, 'l’adresse de l’événement ne peut pas servir de sous-domaine');
  }

  try {
    await context.repositories.eventSiteEditing.setStatus(event.id, command.status);
  } catch (error) {
    throw translate(error, useCase);
  }
}

/** Le poids maximal d'une image déposée, avant réencodage. */
export const EVENT_SITE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export const uploadEventSiteImageCommandSchema = z.object({
  organizationId: uuid,
  eventId: uuid,
  kind: z.enum(['logo', 'cover']),
  contentType: z.enum(ACCEPTED_IMAGE_TYPES, 'image PNG, JPEG ou WebP attendue'),
  bytes: z
    .instanceof(Uint8Array)
    .refine((bytes) => bytes.byteLength > 0, 'fichier vide')
    .refine((bytes) => bytes.byteLength <= EVENT_SITE_IMAGE_MAX_BYTES, 'image de 8 Mo au plus'),
});

function previousPath(site: EventSiteRecord | null, kind: EventSiteImageKind): string | null {
  if (site === null) return null;
  return kind === 'logo' ? site.logoPath : site.coverPath;
}

/**
 * Déposer le logo ou la couverture. L'image est réencodée avant d'être
 * stockée (métadonnées et contenu piégé retirés), sous un nom neuf : une
 * ancienne adresse mise en cache ne montre jamais la nouvelle image à moitié.
 * L'ancienne image est retirée une fois la nouvelle en place.
 */
export async function uploadEventSiteImage(
  context: EventSiteImageContext,
  input: unknown,
): Promise<void> {
  const useCase = 'uploadEventSiteImage';
  const command = parseCommand(uploadEventSiteImageCommandSchema, input, useCase);

  // Avant tout traitement et tout dépôt : le rôle, puis l'événement.
  const permissions = await permissionsOf(context, command.organizationId, useCase);
  if (!permissions.canEdit) throw forbiddenError(useCase);
  const event = await eventOf(context, command.organizationId, command.eventId, useCase);

  let image;
  try {
    image = await context.images.process(command.kind, command.bytes);
  } catch (error) {
    if (error instanceof EventSiteImageRejected) {
      throw validationError(useCase, error.message, { file: error.message });
    }
    throw error;
  }

  const site = await context.repositories.eventSiteEditing.findSite(event.id);
  const path = `${event.id}/${command.kind}-${globalThis.crypto.randomUUID()}.${image.extension}`;

  await context.assets.upload(path, image.bytes, image.contentType);
  try {
    await context.repositories.eventSiteEditing.setImage(event.id, command.kind, path);
  } catch (error) {
    await context.assets.remove([path]).catch(() => undefined);
    throw translate(error, useCase);
  }

  const old = previousPath(site, command.kind);
  if (old !== null) await context.assets.remove([old]).catch(() => undefined);
}

export const removeEventSiteImageCommandSchema = z.object({
  organizationId: uuid,
  eventId: uuid,
  kind: z.enum(['logo', 'cover']),
});

export async function removeEventSiteImage(
  context: EventSiteImageContext,
  input: unknown,
): Promise<void> {
  const useCase = 'removeEventSiteImage';
  const command = parseCommand(removeEventSiteImageCommandSchema, input, useCase);

  const permissions = await permissionsOf(context, command.organizationId, useCase);
  if (!permissions.canEdit) throw forbiddenError(useCase);
  const event = await eventOf(context, command.organizationId, command.eventId, useCase);

  const site = await context.repositories.eventSiteEditing.findSite(event.id);
  const old = previousPath(site, command.kind);
  if (old === null) return;

  try {
    await context.repositories.eventSiteEditing.setImage(event.id, command.kind, null);
  } catch (error) {
    throw translate(error, useCase);
  }
  await context.assets.remove([old]).catch(() => undefined);
}


export const setEventSiteDocumentPublicCommandSchema = z.object({
  organizationId: uuid,
  eventId: uuid,
  sourceId: uuid,
  public: z.boolean(),
});

/**
 * Diffuser un document sur le site, ou le retirer : owner ou admin, comme la
 * mise en ligne (EVENT_SITE §3.4, AGENTS §66). Le document doit appartenir à
 * l'édition du site.
 */
export async function setEventSiteDocumentPublic(
  context: EventSiteEditingContext,
  input: unknown,
): Promise<void> {
  const useCase = 'setEventSiteDocumentPublic';
  const command = parseCommand(setEventSiteDocumentPublicCommandSchema, input, useCase);

  const permissions = await permissionsOf(context, command.organizationId, useCase);
  if (!permissions.canPublish) throw forbiddenError(useCase);
  await eventOf(context, command.organizationId, command.eventId, useCase);

  const repository = context.repositories.eventSiteEditing;
  const editions = await repository.listEditions(command.eventId);
  const documents = (
    await Promise.all(editions.map((edition) => repository.listDocuments(edition.id)))
  ).flat();
  if (!documents.some((document) => document.id === command.sourceId)) {
    throw notFoundError(useCase, 'document');
  }

  try {
    await repository.setDocumentPublic(command.sourceId, command.public);
  } catch (error) {
    throw translate(error, useCase);
  }
}
