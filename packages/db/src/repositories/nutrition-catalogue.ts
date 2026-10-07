import { DbError, mapPostgrestError, type PostgrestLikeError } from '../errors.js';
import { defineRepository, type RepositoryContext } from '../repository.js';
import type { Enum, PlukaClient } from '../types.js';

/*
 * Repository du catalogue Nutrition — migration 0039.
 *
 * La lecture, la création, l'édition, l'import et la suppression passent par
 * des fonctions de console qui portent leur garde (administration qui écrit)
 * et leur audit. Ce repository traduit : camelCase côté application, colonnes
 * côté base.
 */

export type NutritionCategory = Enum<'nutrition_product_category'>;
export type NutritionStatus = Enum<'nutrition_product_status'>;
export type NutritionTexture = Enum<'nutrition_texture'>;

/** Une fiche telle que le formulaire et l'import la décrivent. */
export interface NutritionProductInput {
  readonly category: NutritionCategory;
  readonly brand: string | null;
  readonly name: string;
  readonly variant: string | null;
  readonly servingQuantity: number | null;
  readonly servingUnit: string | null;
  readonly caloriesKcal: number | null;
  readonly carbsG: number;
  readonly sodiumMg: number;
  readonly caffeineMg: number;
  readonly hydrationMl: number | null;
  readonly potassiumMg: number | null;
  readonly magnesiumMg: number | null;
  readonly proteinG: number | null;
  readonly fatG: number | null;
  readonly fiberG: number | null;
  readonly texture: NutritionTexture | null;
  readonly glucoseFructoseRatio: string | null;
  readonly isVegan: boolean | null;
  readonly isOrganic: boolean | null;
  readonly isGlutenFree: boolean | null;
  readonly tags: readonly string[];
  readonly imageUrl: string | null;
  readonly purchaseUrl: string | null;
  readonly purchaseIsAffiliate: boolean;
  readonly sourceUrl: string | null;
  readonly status: NutritionStatus;
}

/** Une ligne de la liste du catalogue. */
export interface NutritionCatalogueRow {
  readonly productId: string;
  readonly brand: string | null;
  readonly name: string;
  readonly variant: string | null;
  readonly category: NutritionCategory;
  readonly status: NutritionStatus;
  readonly servingQuantity: number | null;
  readonly servingUnit: string | null;
  readonly carbsG: number;
  readonly sodiumMg: number;
  readonly caffeineMg: number;
  readonly hydrationMl: number;
  readonly caloriesKcal: number | null;
  readonly tags: readonly string[];
  readonly imageUrl: string | null;
  readonly purchaseUrl: string | null;
  readonly purchaseIsAffiliate: boolean;
  /** Un coureur l'a dans ses produits, ou un ravitaillement la cite : elle ne se supprime pas. */
  readonly inUse: boolean;
  readonly updatedAt: string;
}

/** La fiche complète, pour l'édition. */
export interface NutritionProductDetail extends NutritionProductInput {
  readonly productId: string;
  readonly verifiedAt: string | null;
  readonly updatedAt: string;
}

export interface NutritionCatalogueQuery {
  readonly status: NutritionStatus | null;
  readonly query: string | null;
  readonly limit: number;
}

export interface NutritionCatalogueRepository {
  list(query: NutritionCatalogueQuery): Promise<readonly NutritionCatalogueRow[]>;
  /** Nombre de fiches par statut — les compteurs des onglets. */
  counts(): Promise<Readonly<Record<NutritionStatus, number>>>;
  get(productId: string): Promise<NutritionProductDetail | null>;
  /** `productId` nul : création. Rend l'identifiant. `conflict` : marque + nom + saveur déjà pris. */
  save(productId: string | null, product: NutritionProductInput): Promise<string>;
  /** Tout ou rien. Rend ce que l'import a créé et mis à jour. */
  importMany(
    products: readonly NutritionProductInput[],
  ): Promise<{ readonly created: number; readonly updated: number }>;
  /** `invalid_state` : la fiche est utilisée, elle s'archive plutôt. */
  remove(productId: string): Promise<void>;
}

interface RpcCapableClient {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

async function invoke(
  client: PlukaClient,
  operation: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const result = await (client as unknown as RpcCapableClient).rpc(operation, args);
  if (result.error !== null && result.error !== undefined) {
    throw mapPostgrestError(result.error as PostgrestLikeError, operation);
  }
  return result.data;
}

function unexpected(operation: string, message: string): DbError {
  return new DbError({ code: 'unknown', operation, message });
}

function rows(data: unknown, operation: string): readonly Record<string, unknown>[] {
  if (!Array.isArray(data)) throw unexpected(operation, 'la fonction devait rendre des lignes');
  return data as readonly Record<string, unknown>[];
}

function text(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

function requiredText(row: Record<string, unknown>, key: string, operation: string): string {
  const value = text(row, key);
  if (value === null) throw unexpected(operation, `colonne ${key} absente ou non textuelle`);
  return value;
}

/** PostgREST rend un `numeric` en nombre ou en chaîne ; `null` reste `null`. */
function num(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value !== '') return Number(value);
  return null;
}

function bool(row: Record<string, unknown>, key: string): boolean | null {
  const value = row[key];
  return typeof value === 'boolean' ? value : null;
}

function tags(row: Record<string, unknown>): readonly string[] {
  const value = row['tags'];
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string') : [];
}

/** Les colonnes de 0039, telles que `private.save_nutrition_product` les lit. */
function toColumns(product: NutritionProductInput): Record<string, unknown> {
  return {
    category: product.category,
    brand: product.brand,
    name: product.name,
    variant: product.variant,
    serving_quantity: product.servingQuantity,
    serving_unit: product.servingUnit,
    calories_kcal: product.caloriesKcal,
    carbs_g: product.carbsG,
    sodium_mg: product.sodiumMg,
    caffeine_mg: product.caffeineMg,
    hydration_ml: product.hydrationMl,
    potassium_mg: product.potassiumMg,
    magnesium_mg: product.magnesiumMg,
    protein_g: product.proteinG,
    fat_g: product.fatG,
    fiber_g: product.fiberG,
    texture: product.texture,
    glucose_fructose_ratio: product.glucoseFructoseRatio,
    is_vegan: product.isVegan,
    is_organic: product.isOrganic,
    is_gluten_free: product.isGlutenFree,
    tags: product.tags,
    image_url: product.imageUrl,
    purchase_url: product.purchaseUrl,
    purchase_is_affiliate: product.purchaseIsAffiliate,
    source_url: product.sourceUrl,
    status: product.status,
  };
}

export const nutritionCatalogueRepository = defineRepository<NutritionCatalogueRepository>(
  (context) => ({
    async list(query) {
      const operation = 'admin_list_nutrition_products';
      const data = rows(
        await invoke(context.client, operation, {
          p_status: query.status,
          p_limit: query.limit,
          p_query: query.query,
        }),
        operation,
      );

      return data.map((row) => ({
        productId: requiredText(row, 'product_id', operation),
        brand: text(row, 'brand'),
        name: requiredText(row, 'name', operation),
        variant: text(row, 'variant'),
        category: requiredText(row, 'category', operation) as NutritionCategory,
        status: requiredText(row, 'status', operation) as NutritionStatus,
        servingQuantity: num(row, 'serving_quantity'),
        servingUnit: text(row, 'serving_unit'),
        carbsG: num(row, 'carbs_g') ?? 0,
        sodiumMg: num(row, 'sodium_mg') ?? 0,
        caffeineMg: num(row, 'caffeine_mg') ?? 0,
        hydrationMl: num(row, 'hydration_ml') ?? 0,
        caloriesKcal: num(row, 'calories_kcal'),
        tags: tags(row),
        imageUrl: text(row, 'image_url'),
        purchaseUrl: text(row, 'purchase_url'),
        purchaseIsAffiliate: row['purchase_is_affiliate'] === true,
        inUse: row['in_use'] === true,
        updatedAt: requiredText(row, 'updated_at', operation),
      }));
    },

    async counts() {
      const operation = 'admin_count_nutrition_products';
      const totals: Record<NutritionStatus, number> = { draft: 0, validated: 0, archived: 0 };
      for (const row of rows(await invoke(context.client, operation), operation)) {
        const status = text(row, 'status') as NutritionStatus | null;
        if (status !== null && status in totals) totals[status] = num(row, 'total') ?? 0;
      }
      return totals;
    },

    async get(productId) {
      const operation = 'admin_get_nutrition_product';
      const row = rows(
        await invoke(context.client, operation, { p_product_id: productId }),
        operation,
      )[0];
      if (row === undefined) return null;

      return {
        productId: requiredText(row, 'id', operation),
        category: requiredText(row, 'category', operation) as NutritionCategory,
        brand: text(row, 'brand'),
        name: requiredText(row, 'name', operation),
        variant: text(row, 'variant'),
        servingQuantity: num(row, 'serving_quantity'),
        servingUnit: text(row, 'serving_unit'),
        caloriesKcal: num(row, 'calories_kcal'),
        carbsG: num(row, 'carbs_g') ?? 0,
        sodiumMg: num(row, 'sodium_mg') ?? 0,
        caffeineMg: num(row, 'caffeine_mg') ?? 0,
        hydrationMl: num(row, 'hydration_ml'),
        potassiumMg: num(row, 'potassium_mg'),
        magnesiumMg: num(row, 'magnesium_mg'),
        proteinG: num(row, 'protein_g'),
        fatG: num(row, 'fat_g'),
        fiberG: num(row, 'fiber_g'),
        texture: text(row, 'texture') as NutritionTexture | null,
        glucoseFructoseRatio: text(row, 'glucose_fructose_ratio'),
        isVegan: bool(row, 'is_vegan'),
        isOrganic: bool(row, 'is_organic'),
        isGlutenFree: bool(row, 'is_gluten_free'),
        tags: tags(row),
        imageUrl: text(row, 'image_url'),
        purchaseUrl: text(row, 'purchase_url'),
        purchaseIsAffiliate: row['purchase_is_affiliate'] === true,
        sourceUrl: text(row, 'source_url'),
        status: requiredText(row, 'status', operation) as NutritionStatus,
        verifiedAt: text(row, 'verified_at'),
        updatedAt: requiredText(row, 'updated_at', operation),
      };
    },

    async save(productId, product) {
      const operation = 'admin_save_nutrition_product';
      const data = await invoke(context.client, operation, {
        p_product_id: productId,
        p_product: toColumns(product),
      });
      if (typeof data !== 'string')
        throw unexpected(operation, 'la fonction devait rendre un uuid');
      return data;
    },

    async importMany(products) {
      const operation = 'admin_import_nutrition_products';
      const row = rows(
        await invoke(context.client, operation, { p_products: products.map(toColumns) }),
        operation,
      )[0];
      return {
        created: row === undefined ? 0 : (num(row, 'created_count') ?? 0),
        updated: row === undefined ? 0 : (num(row, 'updated_count') ?? 0),
      };
    },

    async remove(productId) {
      await invoke(context.client, 'admin_delete_nutrition_product', { p_product_id: productId });
    },
  }),
);

export interface NutritionCatalogueRepositories {
  readonly nutritionCatalogue: NutritionCatalogueRepository;
}

export function createNutritionCatalogueRepositories(
  context: RepositoryContext,
): NutritionCatalogueRepositories {
  return { nutritionCatalogue: nutritionCatalogueRepository(context) };
}
