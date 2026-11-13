import { z } from 'zod';

import type { EntitlementRepositories, LibraryRepositories } from '@pluka/db';

import type { Actor } from '../authorization/organization-role.js';
import type { Capability } from '../entitlements/capabilities.js';
import { can } from '../entitlements/resolver.js';
import { authorizeCapability, resolveEntitlements } from '../entitlements/use-cases.js';
import { parseCommand } from '../errors.js';

/**
 * « Mon matériel » — 00_PRODUCT_SPEC §20 ; 04_ENTITLEMENTS §48, §58, §59 ;
 * migration 0092 ; décision produit du 2026-11-13.
 *
 * L'inventaire de ce que le coureur possède, pour l'ajouter à la Préparation
 * d'une course sans le retaper. Le lire est gratuit (`library.read`) : un
 * PLUKA+ expiré garde son matériel. L'écrire est PLUKA+ (`library.edit`).
 */

export interface LibraryContext {
  readonly repositories: LibraryRepositories & EntitlementRepositories;
  readonly actor: Actor;
  readonly now: () => Date;
  readonly disabledCapabilities?: ReadonlySet<Capability>;
}

export interface MyEquipment {
  readonly items: readonly { readonly id: string; readonly label: string }[];
  /** Peut ajouter et retirer des pièces (PLUKA+). */
  readonly canEdit: boolean;
}

/**
 * Une liste propre : sans vides, espaces réduits, sans doublons à la casse
 * près, dans l'ordre de saisie.
 */
export function cleanLabels(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const raw of list) {
    const label = raw.trim().replace(/\s+/gu, ' ');
    const key = labelKey(label);
    if (label === '' || seen.has(key)) continue;
    seen.add(key);
    clean.push(label);
  }
  return clean;
}

/** La clé de comparaison d'un intitulé, alignée sur l'index unique de 0092. */
export function labelKey(label: string): string {
  return label.trim().toLocaleLowerCase('fr');
}

const addCommand = z
  .object({
    labels: z
      .array(z.string())
      .transform((list) => cleanLabels(list))
      .pipe(z.array(z.string().max(120)).min(1).max(100)),
  })
  .strict();

const removeCommand = z.object({ itemId: z.uuid() }).strict();

function serviceContext(context: LibraryContext) {
  return {
    repositories: context.repositories,
    actor: context.actor,
    now: context.now,
    ...(context.disabledCapabilities === undefined
      ? {}
      : { disabledCapabilities: context.disabledCapabilities }),
  };
}

export async function listMyEquipment(context: LibraryContext): Promise<MyEquipment> {
  const [items, entitlements] = await Promise.all([
    context.repositories.library.listEquipment(context.actor.userId),
    resolveEntitlements(serviceContext(context), {}),
  ]);
  return { items, canEdit: can(entitlements, 'library.edit').allowed };
}

/** Ajoute une ou plusieurs pièces (une par ligne). Une pièce déjà présente est ignorée. */
export async function addToMyEquipment(context: LibraryContext, input: unknown): Promise<void> {
  const command = parseCommand(addCommand, input, 'addToMyEquipment');
  await authorizeCapability(serviceContext(context), { capability: 'library.edit' });
  await context.repositories.library.addEquipment(context.actor.userId, command.labels);
}

export async function removeFromMyEquipment(
  context: LibraryContext,
  input: unknown,
): Promise<void> {
  const command = parseCommand(removeCommand, input, 'removeFromMyEquipment');
  await authorizeCapability(serviceContext(context), { capability: 'library.edit' });
  // La RLS borne la suppression à ses propres pièces : celle d'un autre ne bouge pas.
  await context.repositories.library.removeEquipment(command.itemId);
}
