import {
  NUTRITION_CATEGORIES,
  NUTRITION_STATUSES,
  NUTRITION_TAGS,
  NUTRITION_TEXTURES,
  nutritionProductInputSchema,
} from '@pluka/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EMPTY_PRODUCT, ProductForm } from '@/app/produits/product-form';
import {
  CATEGORY_OPTIONS,
  STATUS_OPTIONS,
  TAG_OPTIONS,
  TEXTURE_OPTIONS,
} from '@/app/produits/product-options';
import { nutritionProductFromForm } from '@/lib/form';

/** Fiche produit — migration 0039 : le formulaire contre le schéma du domaine. */

const MARKUP = renderToStaticMarkup(<ProductForm product={EMPTY_PRODUCT} />);

function fieldNames(markup: string): readonly string[] {
  return [
    ...new Set(
      [...markup.matchAll(/<(?:input|select|textarea)\b[^>]*\bname="([^"]+)"/g)].map(
        (match) => match[1] as string,
      ),
    ),
  ].sort();
}

describe('options du formulaire', () => {
  it('sont exactement celles du domaine', () => {
    expect(CATEGORY_OPTIONS.map((option) => option.value)).toEqual([...NUTRITION_CATEGORIES]);
    expect(TEXTURE_OPTIONS.map((option) => option.value)).toEqual([...NUTRITION_TEXTURES]);
    expect([...TAG_OPTIONS]).toEqual([...NUTRITION_TAGS]);
    expect(STATUS_OPTIONS.map((option) => option.value)).toEqual([...NUTRITION_STATUSES]);
  });
});

describe('formulaire de fiche', () => {
  it('poste les champs du schéma — l’unité de portion est déduite, la création n’a pas d’identifiant', () => {
    const schemaFields = Object.keys(nutritionProductInputSchema.shape).filter(
      (field) => field !== 'servingUnit' && field !== 'sourceUrl',
    );

    expect(fieldNames(MARKUP)).toEqual([...schemaFields].sort());
  });

  it('une valeur laissée vide reste nulle, jamais 0', () => {
    const form = new FormData();
    form.set('category', 'gel');
    form.set('name', 'Gel');
    form.set('carbsG', '22,5');
    form.set('sodiumMg', '50');
    form.set('caffeineMg', '0');
    form.set('potassiumMg', '');
    form.set('isVegan', '');
    form.set('status', 'validated');

    const product = nutritionProductFromForm(form);

    expect(product).toMatchObject({
      carbsG: 22.5,
      potassiumMg: null,
      isVegan: null,
      servingUnit: null,
    });
    expect(nutritionProductInputSchema.safeParse(product).success).toBe(true);
  });
});
