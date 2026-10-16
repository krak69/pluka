import type { EventSiteRepository } from '@pluka/db';
import { z } from 'zod';

import { notFoundError, parseCommand } from '../errors.js';
import { SITE_HEADING_FONTS } from './appearance.js';

/**
 * Le site public d'un événement, tel qu'un visiteur le lit — EVENT_SITE §3, §7.
 *
 * La base décide de ce qui est en ligne et construit la charge
 * (`event_site_public`, 0049) ; ce module la valide à l'entrée (AGENTS §60) et
 * la rend typée. Rien n'y est complété : un champ absent reste `null`, et la
 * page dit l'absence plutôt que d'inventer (AGENTS §38).
 */

export interface EventSiteContext {
  readonly repositories: { readonly eventSites: EventSiteRepository };
}

const nullableText = z.string().nullable();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

const publicSiteSchema = z.object({
  event: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    description: nullableText,
    city: nullableText,
    countryCode: nullableText,
  }),
  appearance: z.object({
    accentColor: z.string().regex(/^#[0-9a-f]{6}$/u).nullable(),
    headingFont: z.enum(SITE_HEADING_FONTS).nullable(),
    logoPath: nullableText,
    coverPath: nullableText,
  }),
  hasContact: z.boolean(),
  sections: z.array(z.object({ title: z.string(), body: z.string() })),
  edition: z
    .object({
      id: z.string().uuid(),
      year: z.number().int(),
      slug: z.string(),
      startDate: isoDate,
      endDate: isoDate.nullable(),
      status: z.string(),
      registrationUrl: nullableText,
    })
    .nullable(),
  races: z.array(
    z.object({
      id: z.string().uuid(),
      slug: z.string(),
      name: z.string(),
      distanceKm: z.number(),
      elevationGainM: z.number().int().nullable(),
      startDatetime: z.string(),
      timezone: z.string(),
      startLocationName: nullableText,
      registrationUrl: nullableText,
    }),
  ),
  notices: z.array(
    z.object({
      id: z.string().uuid(),
      raceId: z.string().uuid(),
      noticeType: z.string(),
      trustLevel: z.enum(['official', 'pluka_validated', 'community']),
      severity: z.enum(['info', 'important', 'critical']),
      title: z.string(),
      body: z.string(),
      publishedAt: z.string(),
    }),
  ),
  partners: z.array(
    z.object({
      name: z.string(),
      category: nullableText,
      logoUrl: nullableText,
      websiteUrl: nullableText,
    }),
  ),
  documents: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      sourceType: z.string(),
      declaredPublishedAt: nullableText,
      url: nullableText,
      hasFile: z.boolean(),
    }),
  ),
});

export type PublicEventSite = z.output<typeof publicSiteSchema>;
export type PublicSiteRace = PublicEventSite['races'][number];

const redirectSchema = z.object({ redirectTo: z.string() });

export type PublicEventSiteLookup =
  | { readonly kind: 'site'; readonly site: PublicEventSite }
  /** Un ancien slug : l'adresse redirige en permanence vers le nouveau (EVENT_SITE §7.1). */
  | { readonly kind: 'redirect'; readonly slug: string };

export const findPublicEventSiteQuerySchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9-]+$/u, 'slug invalide'),
});

/**
 * Le site en ligne à une adresse. Tout ce qui n'est pas en ligne — pas de
 * site, brouillon, suspendu, événement non publié, organisation inactive —
 * est `not_found`, sans dire pourquoi : une erreur d'autorisation révélerait
 * qu'il existe quelque chose à cette adresse.
 */
export async function findPublicEventSite(
  context: EventSiteContext,
  input: unknown,
): Promise<PublicEventSiteLookup> {
  const useCase = 'findPublicEventSite';
  const query = parseCommand(findPublicEventSiteQuerySchema, input, useCase);

  const payload = await context.repositories.eventSites.findPublicBySlug(query.slug);
  if (payload === null) throw notFoundError(useCase, 'site');

  const redirect = redirectSchema.safeParse(payload);
  if (redirect.success) return { kind: 'redirect', slug: redirect.data.redirectTo };

  const site = publicSiteSchema.safeParse(payload);
  if (!site.success) {
    // La charge vient de notre propre fonction : une forme inattendue est un
    // défaut de PLUKA, pas une entrée à refuser poliment.
    const paths = site.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`[${useCase}] charge du site illisible : ${paths}`, { cause: site.error });
  }

  return { kind: 'site', site: site.data };
}

/** Le lien d'inscription d'une épreuve : le sien s'il existe, sinon celui de l'édition (EVENT_SITE §5). */
export function registrationUrlOf(
  race: Pick<PublicSiteRace, 'registrationUrl'>,
  edition: PublicEventSite['edition'],
): string | null {
  return race.registrationUrl ?? edition?.registrationUrl ?? null;
}
