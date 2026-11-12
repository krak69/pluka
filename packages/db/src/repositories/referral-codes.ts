import { mapPostgrestError, type PostgrestLikeError } from '../errors.js';
import { defineRepository } from '../repository.js';
import type { PlukaClient } from '../types.js';

/*
 * Canal A — le code d'une édition (0087).
 *
 * Trois lectures, trois publics : la page ouverte par le lien (anonyme), le
 * bloc de l'organisation qui le diffuse, l'interrupteur de PLUKA. Chacune des
 * fonctions SQL porte sa condition d'accès ; ce repository ne décide rien.
 */

export interface ReferralRaceRecord {
  readonly name: string;
  readonly slug: string;
  readonly distanceKm: number | null;
  readonly startDatetime: string | null;
  /** Fuseau IANA de l'épreuve, pour dire son jour de départ. */
  readonly timezone: string;
}

/** Ce que montre la page du lien : l'édition et ses épreuves publiées. */
export interface ResolvedReferralCodeRecord {
  readonly code: string;
  readonly eventName: string;
  readonly eventSlug: string;
  readonly editionSlug: string;
  readonly editionYear: number;
  readonly races: readonly ReferralRaceRecord[];
}

export interface EditionReferralCodeRecord {
  readonly code: string;
  readonly active: boolean;
}

export interface ReferralCodeRepository {
  /** Nul pour un code inconnu ou désactivé. */
  resolve(code: string): Promise<ResolvedReferralCodeRecord | null>;
  /** Nul pour une édition sans organisation. */
  forEdition(editionId: string): Promise<EditionReferralCodeRecord | null>;
  setActive(editionId: string, active: boolean): Promise<void>;
}

interface RpcCapableClient {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

async function call(client: PlukaClient, operation: string, args: Record<string, unknown>) {
  const result = await (client as unknown as RpcCapableClient).rpc(operation, args);
  if (result.error !== null && result.error !== undefined) {
    throw mapPostgrestError(result.error as PostgrestLikeError, operation);
  }
  return result.data;
}

function firstRow(data: unknown): Record<string, unknown> | undefined {
  return (Array.isArray(data) ? data[0] : undefined) as Record<string, unknown> | undefined;
}

export const referralCodeRepository = defineRepository<ReferralCodeRepository>((context) => ({
  async resolve(code) {
    const row = firstRow(await call(context.client, 'resolve_referral_code', { p_code: code }));
    if (row === undefined) return null;

    const races = Array.isArray(row['races']) ? (row['races'] as Record<string, unknown>[]) : [];

    return {
      code: String(row['code']),
      eventName: String(row['event_name']),
      eventSlug: String(row['event_slug']),
      editionSlug: String(row['edition_slug']),
      editionYear: Number(row['edition_year']),
      races: races.map((race) => ({
        name: String(race['name']),
        slug: String(race['slug']),
        distanceKm: typeof race['distanceKm'] === 'number' ? race['distanceKm'] : null,
        startDatetime: typeof race['startDatetime'] === 'string' ? race['startDatetime'] : null,
        timezone: String(race['timezone']),
      })),
    };
  },

  async forEdition(editionId) {
    const row = firstRow(
      await call(context.client, 'org_get_referral_code', { p_edition_id: editionId }),
    );
    return row === undefined ? null : { code: String(row['code']), active: row['active'] === true };
  },

  async setActive(editionId, active) {
    await call(context.client, 'admin_set_referral_code_active', {
      p_edition_id: editionId,
      p_active: active,
    });
  },
}));
