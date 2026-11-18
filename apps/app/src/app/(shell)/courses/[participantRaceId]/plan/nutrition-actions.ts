'use server';

import {
  addCatalogueProduct,
  createMyNutritionProduct,
  disableNutrition,
  DomainError,
  EntitlementError,
  saveNutritionSettings,
  searchNutritionCatalogue,
  setNutritionProductVolume,
} from '@pluka/domain';
import { revalidatePath } from 'next/cache';

import type { ActionState } from '@/app/actions';
import { nutritionContext } from '@/lib/nutrition';
import { requireSession } from '@/lib/session';

/**
 * Nutrition sur la page Plan — prototype `activateNut`, `nutStepConfig`.
 * Le client n'envoie que des nombres et des choix ; le droit (Race Pass), la
 * propriété et le Plan actif se décident dans le domaine et la base (0102, 0103).
 */

function number(form: FormData, name: string): number {
  const raw = String(form.get(name) ?? '')
    .trim()
    .replace(',', '.');
  return raw === '' ? Number.NaN : Number(raw);
}

function pathOf(participantRaceId: string): string {
  return `/courses/${participantRaceId}/plan`;
}

export async function saveNutritionAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const participantRaceId = String(form.get('participantRaceId') ?? '');
  const session = await requireSession(pathOf(participantRaceId));
  const caffeine = String(form.get('caffeineTotalMg') ?? '').trim();
  const mode = String(form.get('placementMode') ?? 'smart');

  try {
    await saveNutritionSettings(nutritionContext(session), {
      participantRaceId,
      carbsGPerHour: number(form, 'carbsGPerHour'),
      hydrationMlPerHour: Math.round(number(form, 'hydrationMlPerHour')),
      sodiumMgPerHour: Math.round(number(form, 'sodiumMgPerHour')),
      caffeineTotalMg: caffeine === '' ? null : Math.round(number(form, 'caffeineTotalMg')),
      waterSharePercent: number(form, 'waterSharePercent'),
      density: String(form.get('density') ?? 'auto'),
      aidBuffer: form.get('aidBuffer') === 'on',
      placementMode: mode,
      intervalMinutes: mode === 'interval' ? Math.round(number(form, 'intervalMinutes')) : null,
      // L'étape « produits » de la modale envoie toujours sa sélection, même vide.
      ...(form.has('productsStep')
        ? { productIds: form.getAll('productIds').map((value) => String(value)) }
        : {}),
    });
  } catch (error) {
    if (error instanceof EntitlementError) {
      return {
        error: 'Ta stratégie Nutrition fait partie de la préparation complète, avec le Race Pass.',
      };
    }
    if (error instanceof DomainError && error.code === 'validation') {
      return { error: 'Vérifie tes objectifs : des nombres positifs, sans unité.' };
    }
    if (error instanceof DomainError && error.code === 'invalid_state') {
      return { error: 'Construis d’abord ton Plan : la Nutrition se cale sur lui.' };
    }
    console.error('nutrition : réglage refusé', {
      code: error instanceof DomainError ? error.code : 'inconnu',
    });
    return { error: 'Tes objectifs n’ont pas pu être enregistrés. Réessaie dans un instant.' };
  }

  revalidatePath(pathOf(participantRaceId));
  return {};
}

export async function disableNutritionAction(form: FormData): Promise<void> {
  const participantRaceId = String(form.get('participantRaceId') ?? '');
  const session = await requireSession(pathOf(participantRaceId));
  await disableNutrition(nutritionContext(session), { participantRaceId }).catch(
    (error: unknown) => {
      console.error('nutrition : désactivation refusée', {
        code: error instanceof DomainError ? error.code : 'inconnu',
      });
    },
  );
  revalidatePath(pathOf(participantRaceId));
}

/**
 * Étape « Quels produits veux-tu utiliser ? » — prototype `nutStepProducts`.
 * Pas de stock : « Mes produits » est une liste, sans quantités.
 */

export interface PickableProduct {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly carbsG: number;
  readonly sodiumMg: number;
  readonly caffeineMg: number;
  readonly hydrationMl: number;
}

export async function searchCatalogueAction(
  participantRaceId: string,
  query: string,
): Promise<readonly (PickableProduct & { readonly catalogueId: string })[]> {
  const session = await requireSession(pathOf(participantRaceId));
  try {
    const rows = await searchNutritionCatalogue(nutritionContext(session), {
      participantRaceId,
      query,
    });
    return rows.map((row) => ({
      id: row.id,
      catalogueId: row.id,
      name: row.brand === null ? row.name : `${row.brand} ${row.name}`,
      category: row.category,
      carbsG: row.carbsG,
      sodiumMg: row.sodiumMg,
      caffeineMg: row.caffeineMg,
      hydrationMl: row.hydrationMl,
    }));
  } catch {
    return [];
  }
}

export async function addCatalogueProductAction(
  participantRaceId: string,
  catalogueProductId: string,
): Promise<{ readonly id?: string; readonly error?: string }> {
  const session = await requireSession(pathOf(participantRaceId));
  try {
    const id = await addCatalogueProduct(nutritionContext(session), {
      participantRaceId,
      catalogueProductId,
    });
    return { id };
  } catch (error) {
    return {
      error:
        error instanceof EntitlementError
          ? 'Ajouter des produits fait partie de la stratégie Nutrition, avec le Race Pass.'
          : 'Ce produit n’a pas pu être ajouté. Réessaie dans un instant.',
    };
  }
}

export async function createProductAction(
  participantRaceId: string,
  product: {
    readonly name: string;
    readonly brand: string;
    readonly category: string;
    readonly carbsG: number;
    readonly sodiumMg: number;
    readonly caffeineMg: number;
    readonly hydrationMl: number;
  },
): Promise<{ readonly id?: string; readonly error?: string }> {
  const session = await requireSession(pathOf(participantRaceId));
  try {
    const id = await createMyNutritionProduct(nutritionContext(session), {
      participantRaceId,
      ...product,
    });
    return { id };
  } catch (error) {
    if (error instanceof DomainError && error.code === 'validation') {
      return { error: 'Donne un nom et des valeurs positives par portion.' };
    }
    return {
      error:
        error instanceof EntitlementError
          ? 'Créer des produits fait partie de la stratégie Nutrition, avec le Race Pass.'
          : 'Ce produit n’a pas pu être créé. Réessaie dans un instant.',
    };
  }
}

export async function setProductVolumeAction(
  participantRaceId: string,
  userProductId: string,
  hydrationMl: number,
): Promise<{ readonly error?: string }> {
  const session = await requireSession(pathOf(participantRaceId));
  try {
    await setNutritionProductVolume(nutritionContext(session), {
      participantRaceId,
      userProductId,
      hydrationMl,
    });
    return {};
  } catch {
    return { error: 'Indique un volume entre 50 et 3000 ml.' };
  }
}
