'use server';

import {
  deleteNutritionProduct,
  importNutritionCatalogue,
  saveNutritionProduct,
  type ImportReport,
} from '@pluka/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { ActionState } from '@/app/actions';
import { actionFailure, nutritionCatalogueContext } from '@/lib/admin';
import { checked, nutritionProductFromForm, text } from '@/lib/form';
import { requireSession } from '@/lib/session';

/**
 * Catalogue Nutrition — migration 0039.
 *
 * Même contrat que `console-actions.ts` : une intention, un acteur, un use
 * case. La garde et l'audit sont en base ; le domaine valide la fiche et lit
 * le CSV.
 */

const TABS = ['a-verifier', 'catalogue', 'archives', 'tous'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tabOf(form: FormData): string {
  const from = text(form, 'from');
  return `/produits/${from !== undefined && (TABS as readonly string[]).includes(from) ? from : 'tous'}`;
}

function revalidateBank(): void {
  for (const tab of TABS) revalidatePath(`/produits/${tab}`);
  revalidatePath('/vue-d-ensemble');
}

async function context(returnTo: string) {
  return nutritionCatalogueContext(await requireSession(returnTo));
}

/**
 * Les erreurs de champ du domaine portent le chemin `product.carbsG` : le
 * formulaire, lui, nomme ses champs `carbsG`.
 */
function withFieldNames(state: ActionState): ActionState {
  if (state.fieldErrors === undefined) return state;
  const fieldErrors = Object.fromEntries(
    Object.entries(state.fieldErrors).map(([field, message]) => [
      field.replace(/^product\./, ''),
      message,
    ]),
  );
  return { ...state, fieldErrors };
}

/** Créer ou modifier une fiche ; le succès revient à la fiche. */
export async function saveNutritionProductAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const raw = text(form, 'productId');
  const productId = raw !== undefined && UUID.test(raw) ? raw : null;

  let savedId: string;

  try {
    ({ productId: savedId } = await saveNutritionProduct(
      await context(productId === null ? '/produits/nouveau' : `/produits/${productId}`),
      { productId, product: nutritionProductFromForm(form) },
    ));
  } catch (error) {
    return withFieldNames(actionFailure(error));
  }

  revalidateBank();
  revalidatePath(`/produits/${savedId}`);
  redirect(`/produits/${savedId}?fait=${productId === null ? 'fiche-creee' : 'fiche-modifiee'}`);
}

export async function deleteNutritionProductAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const tab = tabOf(form);

  try {
    await deleteNutritionProduct(await context(tab), {
      productId: text(form, 'productId') ?? '',
      confirmed: checked(form, 'confirmed'),
    });
  } catch (error) {
    return actionFailure(error);
  }

  revalidateBank();
  redirect(`${tab}?fait=fiche-supprimee`);
}

export interface ImportState extends ActionState {
  readonly report?: ImportReport;
}

/** Importer le CSV. Le compte rendu revient au formulaire : il est trop riche pour une URL. */
export async function importNutritionCatalogueAction(
  _previous: ImportState,
  form: FormData,
): Promise<ImportState> {
  const file = form.get('file');

  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choisissez un fichier CSV.', fieldErrors: { file: 'fichier attendu' } };
  }

  try {
    const report = await importNutritionCatalogue(await context('/produits/import'), {
      csv: await file.text(),
    });
    revalidateBank();
    return { report };
  } catch (error) {
    return actionFailure(error);
  }
}
