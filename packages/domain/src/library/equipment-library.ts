import { z } from 'zod';

import type { EntitlementRepositories, LibraryRepositories } from '@pluka/db';

import type { Actor } from '../authorization/organization-role.js';
import type { Capability } from '../entitlements/capabilities.js';
import { can } from '../entitlements/resolver.js';
import { authorizeCapability, resolveEntitlements } from '../entitlements/use-cases.js';
import { notFoundError, parseCommand } from '../errors.js';
import {
  cleanTags,
  GEAR_CATEGORIES,
  guessGearCategory,
  type GearCategory,
} from './gear-categories.js';

/**
 * « Mon matériel » — 00_PRODUCT_SPEC §20 ; 04_ENTITLEMENTS §48, §58, §59 ;
 * migrations 0092, 0093 ; décisions produit du 2026-11-13.
 *
 * L'inventaire de ce que le coureur possède, pour l'ajouter à la Préparation
 * d'une course sans le retaper. Chaque pièce a une catégorie (liste fixe,
 * devinée à l'ajout, corrigeable) et des tags libres ; la bibliothèque se
 * filtre par l'une et les autres.
 *
 * Le lire est gratuit (`library.read`) : un PLUKA+ expiré garde son matériel.
 * L'écrire est PLUKA+ (`library.edit`).
 */

export interface LibraryContext {
  readonly repositories: LibraryRepositories & EntitlementRepositories;
  readonly actor: Actor;
  readonly now: () => Date;
  readonly disabledCapabilities?: ReadonlySet<Capability>;
}

export interface MyEquipmentItem {
  readonly id: string;
  readonly label: string;
  readonly category: GearCategory;
  readonly tags: readonly string[];
}

export interface MyEquipment {
  /** Les pièces retenues par le filtre, dans l'ordre des catégories puis de l'intitulé. */
  readonly items: readonly MyEquipmentItem[];
  /** Le nombre de pièces par catégorie, sur tout l'inventaire (pour les filtres). */
  readonly categoryCounts: Readonly<Partial<Record<GearCategory, number>>>;
  /** Tous ses tags, triés, pour filtrer et pour les suggérer à la saisie. */
  readonly tags: readonly string[];
  readonly total: number;
  /** Peut ajouter, classer et retirer des pièces (PLUKA+). */
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

/** De nouvelles pièces, chacune avec sa catégorie devinée. */
export function newItems(labels: readonly string[]) {
  return cleanLabels(labels).map((label) => ({ label, category: guessGearCategory(label) }));
}

const category = z.enum(GEAR_CATEGORIES);

const listQuery = z
  .object({
    category: category.optional(),
    tag: z.string().trim().min(1).max(30).optional(),
  })
  .strict();

const addCommand = z
  .object({
    labels: z
      .array(z.string())
      .transform((list) => cleanLabels(list))
      .pipe(z.array(z.string().max(120)).min(1).max(100)),
  })
  .strict();

const updateCommand = z
  .object({
    itemId: z.uuid(),
    category,
    tags: z
      .array(z.string())
      .max(40)
      .transform((list) => cleanTags(list)),
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

const ORDER = new Map(GEAR_CATEGORIES.map((value, index) => [value, index]));

/** Son matériel, filtré par catégorie ou par tag. Gratuit. */
export async function listMyEquipment(
  context: LibraryContext,
  input: unknown = {},
): Promise<MyEquipment> {
  const filter = parseCommand(listQuery, input, 'listMyEquipment');
  const [records, entitlements] = await Promise.all([
    context.repositories.library.listEquipment(context.actor.userId),
    resolveEntitlements(serviceContext(context), {}),
  ]);

  const counts: Partial<Record<GearCategory, number>> = {};
  for (const record of records) counts[record.category] = (counts[record.category] ?? 0) + 1;

  const wantedTag = filter.tag?.toLocaleLowerCase('fr');
  const items = records
    .filter((record) => filter.category === undefined || record.category === filter.category)
    .filter((record) => wantedTag === undefined || record.tags.includes(wantedTag))
    .sort(
      (left, right) =>
        (ORDER.get(left.category) ?? 0) - (ORDER.get(right.category) ?? 0) ||
        left.label.localeCompare(right.label, 'fr'),
    );

  return {
    items,
    categoryCounts: counts,
    tags: [...new Set(records.flatMap((record) => record.tags))].sort((left, right) =>
      left.localeCompare(right, 'fr'),
    ),
    total: records.length,
    canEdit: can(entitlements, 'library.edit').allowed,
  };
}

/**
 * Ajoute une ou plusieurs pièces (une par ligne), chacune dans la catégorie
 * que ses mots-clés suggèrent. Une pièce déjà présente est ignorée.
 */
export async function addToMyEquipment(context: LibraryContext, input: unknown): Promise<void> {
  const command = parseCommand(addCommand, input, 'addToMyEquipment');
  await authorizeCapability(serviceContext(context), { capability: 'library.edit' });
  await context.repositories.library.addEquipment(context.actor.userId, newItems(command.labels));
}

/** Reclasse une pièce : sa catégorie et ses tags. */
export async function updateMyEquipmentItem(
  context: LibraryContext,
  input: unknown,
): Promise<void> {
  const useCase = 'updateMyEquipmentItem';
  const command = parseCommand(updateCommand, input, useCase);
  await authorizeCapability(serviceContext(context), { capability: 'library.edit' });

  // La RLS ne rend que ses propres pièces : celle d'un autre est introuvable.
  const mine = await context.repositories.library.listEquipment(context.actor.userId);
  if (!mine.some((item) => item.id === command.itemId)) throw notFoundError(useCase, 'pièce');

  await context.repositories.library.updateEquipment(
    command.itemId,
    command.category,
    command.tags,
  );
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
