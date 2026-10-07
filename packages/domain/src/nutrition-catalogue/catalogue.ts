import { z } from 'zod';

import {
  DbError,
  type NutritionCatalogueRepositories,
  type NutritionCatalogueRow,
  type NutritionProductDetail,
  type NutritionProductInput,
  type NutritionStatus,
} from '@pluka/db';

import type { Actor } from '../authorization/organization-role.js';
import {
  DomainError,
  forbiddenError,
  invalidStateError,
  notFoundError,
  parseCommand,
  validationError,
} from '../errors.js';

/**
 * Catalogue Nutrition — migration 0039, `02_DATA_MODEL.md` §15.1.
 *
 * La garde (administration qui écrit) et l'audit sont dans les fonctions SQL ;
 * ce module valide une fiche à la frontière — une seule définition pour le
 * formulaire et l'import — et lit le CSV du catalogue.
 *
 * Le moteur Nutrition ne lit que glucides, sodium, caféine et hydratation
 * (NUTRITION_ENGINE §765) ; le reste est descriptif. Aucune valeur absente
 * n'est remplacée par 0 (AGENTS §38), sauf l'hydratation, que la base pose à
 * 0 à la création depuis 0001.
 */

export interface NutritionCatalogueContext {
  readonly repositories: NutritionCatalogueRepositories;
  /** Non consulté : la base lit l'acteur dans le jeton. */
  readonly actor: Actor;
}

/** Les onze types : ceux de 0001 et les trois ajoutés par 0039. */
export const NUTRITION_CATEGORIES = [
  'gel',
  'drink',
  'bar',
  'chew',
  'puree',
  'solid',
  'salty',
  'capsule',
  'electrolyte',
  'generic_aid',
  'other',
] as const;

export const NUTRITION_TEXTURES = ['gel', 'liquid', 'semi_liquid', 'solid', 'chewy'] as const;

/** Les tags admis : des faits, aucune allégation (décision du 2026-10-07, 0039). */
export const NUTRITION_TAGS = [
  'Caféiné',
  'Riche en glucides',
  'Riche en sodium',
  'Salé',
  'Isotonique',
  'Hydrogel',
] as const;

export const NUTRITION_STATUSES = ['draft', 'validated', 'archived'] as const;

const optionalText = z
  .string()
  .trim()
  .max(200)
  .nullable()
  .transform((value) => (value === null || value === '' ? null : value));

const httpsUrl = z
  .string()
  .trim()
  .nullable()
  .transform((value) => (value === null || value === '' ? null : value))
  .pipe(z.url({ protocol: /^https$/, error: 'adresse attendue en https://' }).nullable());

const nonNegative = (label: string) =>
  z
    .number({ error: `${label} attendu` })
    .finite()
    .min(0, { error: `${label} négatif` });

const optionalNonNegative = (label: string) => nonNegative(label).nullable();

export const nutritionProductInputSchema = z
  .object({
    category: z.enum(NUTRITION_CATEGORIES, { error: 'type inconnu' }),
    brand: optionalText,
    name: z.string().trim().min(1, { error: 'nom attendu' }).max(200),
    variant: optionalText,
    servingQuantity: nonNegative('poids').positive({ error: 'poids attendu positif' }).nullable(),
    servingUnit: optionalText,
    caloriesKcal: optionalNonNegative('kcal').transform((value) =>
      value === null ? null : Math.round(value),
    ),
    carbsG: nonNegative('glucides'),
    sodiumMg: nonNegative('sodium').transform(Math.round),
    caffeineMg: nonNegative('caféine').transform(Math.round),
    hydrationMl: optionalNonNegative('hydratation').transform((value) =>
      value === null ? null : Math.round(value),
    ),
    potassiumMg: optionalNonNegative('potassium').transform((value) =>
      value === null ? null : Math.round(value),
    ),
    magnesiumMg: optionalNonNegative('magnésium').transform((value) =>
      value === null ? null : Math.round(value),
    ),
    proteinG: optionalNonNegative('protéines'),
    fatG: optionalNonNegative('lipides'),
    fiberG: optionalNonNegative('fibres'),
    texture: z.enum(NUTRITION_TEXTURES, { error: 'texture inconnue' }).nullable(),
    glucoseFructoseRatio: z
      .string()
      .trim()
      .nullable()
      .transform((value) => (value === null || value === '' ? null : value.replace(/,/g, '.')))
      .pipe(
        z
          .string()
          .regex(/^\d+(\.\d+)?:\d+(\.\d+)?$/, { error: 'ratio attendu sous la forme 2:1' })
          .nullable(),
      ),
    isVegan: z.boolean().nullable(),
    isOrganic: z.boolean().nullable(),
    isGlutenFree: z.boolean().nullable(),
    tags: z.array(z.enum(NUTRITION_TAGS, { error: 'tag non admis' })).max(NUTRITION_TAGS.length),
    imageUrl: httpsUrl,
    purchaseUrl: httpsUrl,
    purchaseIsAffiliate: z.boolean(),
    sourceUrl: httpsUrl,
    status: z.enum(NUTRITION_STATUSES, { error: 'statut inconnu' }),
  })
  .strict();

export const saveNutritionProductCommandSchema = z
  .object({ productId: z.string().uuid().nullable(), product: nutritionProductInputSchema })
  .strict();

export const deleteNutritionProductCommandSchema = z
  .object({
    productId: z.string().uuid(),
    confirmed: z.literal(true, { error: 'Cochez la case pour confirmer ce geste.' }),
  })
  .strict();

export const listNutritionCatalogueQuerySchema = z
  .object({
    status: z.enum(NUTRITION_STATUSES).nullable().default(null),
    query: z.string().trim().max(100).nullable().default(null),
  })
  .strict();

function translate(error: unknown, useCase: string, refusal: string): unknown {
  if (!(error instanceof DbError)) return error;

  const translated: Partial<Record<DbError['code'], DomainError>> = {
    permission_denied: forbiddenError(useCase),
    not_found: notFoundError(useCase, 'fiche'),
    invalid_state: invalidStateError(useCase, refusal),
  };
  return translated[error.code] ?? error;
}

const DUPLICATE = 'une fiche existe déjà pour cette marque, ce nom et cette saveur';

export async function listNutritionCatalogue(
  context: NutritionCatalogueContext,
  input: unknown = {},
): Promise<{
  readonly products: readonly NutritionCatalogueRow[];
  readonly counts: Readonly<Record<NutritionStatus, number>>;
}> {
  const useCase = 'listNutritionCatalogue';
  const query = parseCommand(listNutritionCatalogueQuerySchema, input, useCase);

  try {
    const [products, counts] = await Promise.all([
      context.repositories.nutritionCatalogue.list({
        status: query.status,
        query: query.query === '' ? null : query.query,
        limit: 500,
      }),
      context.repositories.nutritionCatalogue.counts(),
    ]);
    return { products, counts };
  } catch (error) {
    throw translate(error, useCase, 'lecture refusée');
  }
}

export async function getNutritionProduct(
  context: NutritionCatalogueContext,
  input: unknown,
): Promise<NutritionProductDetail> {
  const useCase = 'getNutritionProduct';
  const { productId } = parseCommand(
    z.object({ productId: z.string().uuid() }).strict(),
    input,
    useCase,
  );

  try {
    const product = await context.repositories.nutritionCatalogue.get(productId);
    if (product === null) throw notFoundError(useCase, 'fiche');
    return product;
  } catch (error) {
    throw translate(error, useCase, 'lecture refusée');
  }
}

/** Créer (`productId` nul) ou modifier une fiche. */
export async function saveNutritionProduct(
  context: NutritionCatalogueContext,
  input: unknown,
): Promise<{ readonly productId: string }> {
  const useCase = 'saveNutritionProduct';
  const command = parseCommand(saveNutritionProductCommandSchema, input, useCase);

  try {
    const productId = await context.repositories.nutritionCatalogue.save(
      command.productId,
      command.product,
    );
    return { productId };
  } catch (error) {
    if (error instanceof DbError && error.code === 'conflict') {
      throw validationError(useCase, 'doublon', { name: DUPLICATE });
    }
    throw translate(error, useCase, 'enregistrement refusé');
  }
}

/** Supprimer une fiche que personne n'utilise. Sinon, elle s'archive. */
export async function deleteNutritionProduct(
  context: NutritionCatalogueContext,
  input: unknown,
): Promise<void> {
  const useCase = 'deleteNutritionProduct';
  const command = parseCommand(deleteNutritionProductCommandSchema, input, useCase);

  try {
    await context.repositories.nutritionCatalogue.remove(command.productId);
  } catch (error) {
    throw translate(
      error,
      useCase,
      'cette fiche est utilisée par des coureurs ou un ravitaillement : archivez-la plutôt',
    );
  }
}

// ============================================================
// Import CSV
// ============================================================

export interface ImportRejection {
  /** Numéro de ligne dans le fichier, en-tête compris (la première fiche est la ligne 2). */
  readonly line: number;
  readonly name: string;
  readonly reasons: readonly string[];
}

export interface ImportWarning {
  readonly line: number;
  readonly message: string;
}

export interface ImportReport {
  readonly created: number;
  readonly updated: number;
  readonly rejected: readonly ImportRejection[];
  readonly warnings: readonly ImportWarning[];
}

/**
 * Lit un CSV à point-virgule ou à virgule — guillemets, guillemets doublés,
 * fins de ligne Windows et BOM compris. Pur : aucune I/O.
 */
export function parseCsv(content: string): readonly (readonly string[])[] {
  const text = content.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter =
    (firstLine.match(/;/g) ?? []).length >= (firstLine.match(/,/g) ?? []).length ? ';' : ',';

  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;

    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === delimiter) {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else field += char;
  }

  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  return records.filter((row) => row.some((cell) => cell.trim() !== ''));
}

/** Clé de comparaison : sans casse, sans accents, sans espaces superflus. */
function key(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/['’\s_-]+/g, ' ');
}

const CATEGORY_ALIASES: Readonly<Record<string, (typeof NUTRITION_CATEGORIES)[number]>> = {
  gel: 'gel',
  'boisson d effort': 'drink',
  boisson: 'drink',
  drink: 'drink',
  barre: 'bar',
  bar: 'bar',
  gummies: 'chew',
  gomme: 'chew',
  'pate de fruits': 'chew',
  chew: 'chew',
  puree: 'puree',
  solide: 'solid',
  solid: 'solid',
  sale: 'salty',
  salty: 'salty',
  capsule: 'capsule',
  electrolyte: 'electrolyte',
  electrolytes: 'electrolyte',
  ravitaillement: 'generic_aid',
  'generic aid': 'generic_aid',
  autre: 'other',
  other: 'other',
};

const TEXTURE_ALIASES: Readonly<Record<string, (typeof NUTRITION_TEXTURES)[number]>> = {
  gel: 'gel',
  liquide: 'liquid',
  liquid: 'liquid',
  'semi liquid': 'semi_liquid',
  'semi liquide': 'semi_liquid',
  solide: 'solid',
  solid: 'solid',
  gomme: 'chewy',
  chewy: 'chewy',
};

/** Les statuts de nutra.run, ramenés aux trois de PLUKA. « community » n'a pas d'équivalent : à vérifier. */
const STATUS_ALIASES: Readonly<Record<string, (typeof NUTRITION_STATUSES)[number]>> = {
  verified: 'validated',
  verifie: 'validated',
  validated: 'validated',
  valide: 'validated',
  pending: 'draft',
  'en attente': 'draft',
  draft: 'draft',
  community: 'draft',
  communaute: 'draft',
  deprecated: 'archived',
  deprecie: 'archived',
  archived: 'archived',
  archive: 'archived',
};

const TAG_ALIASES: ReadonlyMap<string, (typeof NUTRITION_TAGS)[number]> = new Map(
  NUTRITION_TAGS.map((tag) => [key(tag), tag]),
);

/** En-têtes reconnus, sans casse ni accents. */
const COLUMNS = {
  category: 'type',
  brand: 'marque',
  name: 'nom',
  variant: 'saveur',
  weight: 'poids (g)',
  image: 'image url',
  purchase: 'lien achat',
  kcal: 'kcal',
  carbs: 'glucides (g)',
  sodium: 'sodium (mg)',
  potassium: 'potassium (mg)',
  magnesium: 'magnesium (mg)',
  caffeine: 'cafeine (mg)',
  protein: 'proteines (g)',
  fat: 'lipides (g)',
  fiber: 'fibres (g)',
  texture: 'texture',
  ratio: 'ratio glucose/fructose',
  vegan: 'vegan',
  organic: 'bio',
  glutenFree: 'sans gluten',
  tags: 'tags',
  status: 'statut',
  affiliate: 'lien affilie',
} as const;

function number(value: string): number | null {
  const cleaned = value.trim().replace(',', '.');
  if (cleaned === '') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function yesNo(value: string): boolean | null {
  const normalized = key(value);
  if (normalized === '') return null;
  if (['oui', 'yes', 'true', '1', 'vrai'].includes(normalized)) return true;
  if (['non', 'no', 'false', '0', 'faux'].includes(normalized)) return false;
  return null;
}

interface ParsedRow {
  readonly line: number;
  readonly name: string;
  readonly product: NutritionProductInput | null;
  readonly reasons: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Traduit le CSV du catalogue en fiches validées, ligne par ligne. Pur : la
 * base n'est pas appelée. Une ligne invalide est rejetée avec ses raisons ;
 * un tag non admis est écarté avec un avertissement, la ligne reste.
 */
export function readNutritionCatalogueCsv(content: string): {
  readonly rows: readonly ParsedRow[];
  readonly missingColumns: readonly string[];
} {
  const [header, ...records] = parseCsv(content);
  if (header === undefined) return { rows: [], missingColumns: ['type', 'nom'] };

  const index = new Map(header.map((title, position) => [key(title), position]));
  const missingColumns = ['category', 'name', 'carbs', 'sodium', 'caffeine']
    .map((column) => COLUMNS[column as keyof typeof COLUMNS])
    .filter((title) => !index.has(key(title)));

  const cell = (record: readonly string[], column: keyof typeof COLUMNS): string => {
    const position = index.get(key(COLUMNS[column]));
    return position === undefined ? '' : (record[position] ?? '').trim();
  };

  const rows = records.map((record, offset): ParsedRow => {
    const line = offset + 2;
    const warnings: string[] = [];
    const name = cell(record, 'name');

    const categoryLabel = cell(record, 'category');
    const category = CATEGORY_ALIASES[key(categoryLabel)];
    const textureLabel = cell(record, 'texture');
    const texture = textureLabel === '' ? null : (TEXTURE_ALIASES[key(textureLabel)] ?? null);
    if (textureLabel !== '' && texture === null)
      warnings.push(`texture « ${textureLabel} » inconnue, laissée vide`);

    const statusLabel = cell(record, 'status');
    const status = statusLabel === '' ? 'draft' : (STATUS_ALIASES[key(statusLabel)] ?? null);
    if (key(statusLabel) === 'community' || key(statusLabel) === 'communaute') {
      warnings.push('statut « communauté » sans équivalent : la fiche entre à vérifier');
    }

    const tags: (typeof NUTRITION_TAGS)[number][] = [];
    for (const raw of cell(record, 'tags')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)) {
      const tag = TAG_ALIASES.get(key(raw));
      if (tag === undefined) warnings.push(`tag « ${raw} » écarté : seuls des faits sont admis`);
      else if (!tags.includes(tag)) tags.push(tag);
    }

    const weight = number(cell(record, 'weight'));
    const candidate = {
      category: category ?? categoryLabel,
      brand: cell(record, 'brand'),
      name,
      variant: cell(record, 'variant'),
      servingQuantity: weight,
      servingUnit: weight === null ? null : 'g',
      caloriesKcal: number(cell(record, 'kcal')),
      carbsG: number(cell(record, 'carbs')),
      sodiumMg: number(cell(record, 'sodium')),
      caffeineMg: number(cell(record, 'caffeine')),
      hydrationMl: null,
      potassiumMg: number(cell(record, 'potassium')),
      magnesiumMg: number(cell(record, 'magnesium')),
      proteinG: number(cell(record, 'protein')),
      fatG: number(cell(record, 'fat')),
      fiberG: number(cell(record, 'fiber')),
      texture,
      glucoseFructoseRatio: cell(record, 'ratio'),
      isVegan: yesNo(cell(record, 'vegan')),
      isOrganic: yesNo(cell(record, 'organic')),
      isGlutenFree: yesNo(cell(record, 'glutenFree')),
      tags,
      imageUrl: cell(record, 'image'),
      purchaseUrl: cell(record, 'purchase'),
      purchaseIsAffiliate: yesNo(cell(record, 'affiliate')) ?? false,
      sourceUrl: null,
      status: status ?? statusLabel,
    };

    const parsed = nutritionProductInputSchema.safeParse(candidate);
    if (parsed.success) return { line, name, product: parsed.data, reasons: [], warnings };

    const reasons = [
      ...new Set(
        parsed.error.issues.map((issue) => {
          const field = issue.path[0];
          if (field === 'carbsG' && candidate.carbsG === null) return 'glucides manquants';
          if (field === 'sodiumMg' && candidate.sodiumMg === null) return 'sodium manquant';
          if (field === 'caffeineMg' && candidate.caffeineMg === null) return 'caféine manquante';
          if (field === 'category') return `type « ${categoryLabel} » inconnu`;
          if (field === 'status') return `statut « ${statusLabel} » inconnu`;
          return `${String(field)} : ${issue.message}`;
        }),
      ),
    ];
    return { line, name, product: null, reasons, warnings };
  });

  return { rows, missingColumns };
}

export const importNutritionCatalogueCommandSchema = z
  .object({ csv: z.string().min(1, { error: 'fichier vide' }).max(5_000_000) })
  .strict();

/**
 * Importer le catalogue. Les lignes valides partent en une seule transaction
 * (0039) : rapprochées par marque + nom + saveur, créées ou mises à jour. Les
 * lignes rejetées sont rendues avec leur raison, sans rien bloquer.
 */
export async function importNutritionCatalogue(
  context: NutritionCatalogueContext,
  input: unknown,
): Promise<ImportReport> {
  const useCase = 'importNutritionCatalogue';
  const command = parseCommand(importNutritionCatalogueCommandSchema, input, useCase);
  const { rows, missingColumns } = readNutritionCatalogueCsv(command.csv);

  if (missingColumns.length > 0) {
    throw validationError(useCase, 'colonnes manquantes', {
      csv: `colonnes manquantes : ${missingColumns.join(', ')}`,
    });
  }

  const valid = rows.filter((row) => row.product !== null);
  const rejected = rows
    .filter((row) => row.product === null)
    .map((row) => ({ line: row.line, name: row.name, reasons: row.reasons }));
  const warnings = rows.flatMap((row) =>
    row.warnings.map((message) => ({ line: row.line, message })),
  );

  // Deux lignes du même fichier pour la même fiche : la seconde écraserait la
  // première sans que personne ne le voie. Elle est rejetée.
  const seen = new Set<string>();
  const unique = valid.filter((row) => {
    const product = row.product as NutritionProductInput;
    const naturalKey = [product.brand ?? '', product.name, product.variant ?? '']
      .map(key)
      .join('|');
    if (seen.has(naturalKey)) {
      rejected.push({
        line: row.line,
        name: row.name,
        reasons: ['doublon d’une ligne précédente du fichier'],
      });
      return false;
    }
    seen.add(naturalKey);
    return true;
  });

  if (unique.length === 0) return { created: 0, updated: 0, rejected, warnings };

  try {
    const { created, updated } = await context.repositories.nutritionCatalogue.importMany(
      unique.map((row) => row.product as NutritionProductInput),
    );
    return { created, updated, rejected: rejected.sort((a, b) => a.line - b.line), warnings };
  } catch (error) {
    throw translate(error, useCase, 'import refusé');
  }
}
