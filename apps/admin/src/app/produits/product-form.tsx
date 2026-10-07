'use client';

import { Input } from '@pluka/ui';
import Link from 'next/link';
import { useActionState } from 'react';

import type { ActionState } from '@/app/actions';
import { saveNutritionProductAction } from '@/app/nutrition-actions';

import { CATEGORY_OPTIONS, STATUS_OPTIONS, TAG_OPTIONS, TEXTURE_OPTIONS } from './product-options';

const INITIAL: ActionState = {};

/**
 * Fiche produit — création et édition (migration 0039), sur le modèle du
 * formulaire nutra.run : identité, image, achat, nutrition par portion,
 * description, caractéristiques, tags, statut.
 *
 * Aucune règle ici : `saveNutritionProduct` valide, la base garde. Les refus
 * reviennent contre le champ qui les a causés.
 *
 * Les quatre valeurs que lit le moteur — glucides, sodium, caféine,
 * hydratation — sont marquées ; le reste est descriptif. Une valeur laissée
 * vide reste vide : jamais 0 inventé.
 */
export interface ProductFormValues {
  readonly productId: string | null;
  readonly category: string;
  readonly brand: string | null;
  readonly name: string;
  readonly variant: string | null;
  readonly servingQuantity: number | null;
  readonly caloriesKcal: number | null;
  readonly carbsG: number | null;
  readonly sodiumMg: number | null;
  readonly caffeineMg: number | null;
  readonly hydrationMl: number | null;
  readonly potassiumMg: number | null;
  readonly magnesiumMg: number | null;
  readonly proteinG: number | null;
  readonly fatG: number | null;
  readonly fiberG: number | null;
  readonly texture: string | null;
  readonly glucoseFructoseRatio: string | null;
  readonly isVegan: boolean | null;
  readonly isOrganic: boolean | null;
  readonly isGlutenFree: boolean | null;
  readonly tags: readonly string[];
  readonly imageUrl: string | null;
  readonly purchaseUrl: string | null;
  readonly purchaseIsAffiliate: boolean;
  readonly status: string;
}

export const EMPTY_PRODUCT: ProductFormValues = {
  productId: null,
  category: 'gel',
  brand: null,
  name: '',
  variant: null,
  servingQuantity: null,
  caloriesKcal: null,
  carbsG: null,
  sodiumMg: null,
  caffeineMg: null,
  hydrationMl: null,
  potassiumMg: null,
  magnesiumMg: null,
  proteinG: null,
  fatG: null,
  fiberG: null,
  texture: null,
  glucoseFructoseRatio: null,
  isVegan: null,
  isOrganic: null,
  isGlutenFree: null,
  tags: [],
  imageUrl: null,
  purchaseUrl: null,
  purchaseIsAffiliate: false,
  status: 'validated',
};

const NUTRIENTS = [
  { name: 'caloriesKcal', label: 'kcal', engine: false },
  { name: 'carbsG', label: 'Glucides (g)', engine: true },
  { name: 'sodiumMg', label: 'Sodium (mg)', engine: true },
  { name: 'caffeineMg', label: 'Caféine (mg)', engine: true },
  { name: 'hydrationMl', label: 'Hydratation (ml)', engine: true },
  { name: 'potassiumMg', label: 'Potassium (mg)', engine: false },
  { name: 'magnesiumMg', label: 'Magnésium (mg)', engine: false },
  { name: 'proteinG', label: 'Protéines (g)', engine: false },
  { name: 'fatG', label: 'Lipides (g)', engine: false },
  { name: 'fiberG', label: 'Fibres (g)', engine: false },
] as const;

const CHARACTERISTICS = [
  { name: 'isVegan', label: 'Vegan' },
  { name: 'isOrganic', label: 'Bio' },
  { name: 'isGlutenFree', label: 'Sans gluten' },
] as const;

function display(value: number | null): string {
  return value === null ? '' : String(value);
}

function triState(value: boolean | null): string {
  return value === null ? '' : String(value);
}

export function ProductForm({ product }: { readonly product: ProductFormValues }) {
  const [state, action, pending] = useActionState(saveNutritionProductAction, INITIAL);
  const errors = state.fieldErrors ?? {};
  const required = new Set(['carbsG', 'sodiumMg', 'caffeineMg']);

  return (
    <form action={action} className="ad-product-form">
      {product.productId === null ? null : (
        <input type="hidden" name="productId" value={product.productId} />
      )}

      <section className="ad-org-panel" aria-labelledby="product-identity">
        <h2 id="product-identity" className="ad-org-panel-title">
          Identité
        </h2>
        <div className="ad-form-grid">
          <div className="pk-field">
            <label className="pk-field-label" htmlFor="product-category">
              Type
            </label>
            <select
              id="product-category"
              name="category"
              className="pk-input"
              defaultValue={product.category}
            >
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <Input
            id="product-brand"
            name="brand"
            label="Marque"
            autoComplete="off"
            defaultValue={product.brand ?? ''}
            error={errors['brand']}
          />
          <Input
            id="product-name"
            name="name"
            label="Nom"
            required
            autoComplete="off"
            defaultValue={product.name}
            error={errors['name']}
          />
          <Input
            id="product-variant"
            name="variant"
            label="Saveur"
            autoComplete="off"
            defaultValue={product.variant ?? ''}
            error={errors['variant']}
          />
          <Input
            id="product-weight"
            name="servingQuantity"
            label="Poids de la portion (g)"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={display(product.servingQuantity)}
            error={errors['servingQuantity']}
          />
        </div>
      </section>

      <section className="ad-org-panel" aria-labelledby="product-media">
        <h2 id="product-media" className="ad-org-panel-title">
          Image et achat
        </h2>
        <div className="ad-form-grid ad-form-grid-wide">
          <Input
            id="product-image"
            name="imageUrl"
            type="url"
            label="Image (URL)"
            placeholder="https://"
            autoComplete="off"
            defaultValue={product.imageUrl ?? ''}
            error={errors['imageUrl']}
          />
          <Input
            id="product-purchase"
            name="purchaseUrl"
            type="url"
            label="Lien d’achat"
            placeholder="https://"
            autoComplete="off"
            hint="Affiché « Acheter » sur la fiche. Jamais lu par le moteur Nutrition."
            defaultValue={product.purchaseUrl ?? ''}
            error={errors['purchaseUrl']}
          />
        </div>
        <label className="ad-confirm" htmlFor="product-affiliate">
          <input
            id="product-affiliate"
            type="checkbox"
            name="purchaseIsAffiliate"
            defaultChecked={product.purchaseIsAffiliate}
          />
          <span>Lien affilié — la mention « Lien affilié » s’affiche à côté (§98)</span>
        </label>
      </section>

      <section className="ad-org-panel" aria-labelledby="product-nutrition">
        <h2 id="product-nutrition" className="ad-org-panel-title">
          Nutrition <span className="ad-row-meta">— valeurs par portion</span>
        </h2>
        <p className="ad-org-panel-lede">
          Marquées d’un point : les valeurs que lit le moteur Nutrition. Une valeur inconnue reste
          vide.
        </p>
        <div className="ad-form-grid ad-form-grid-nutrients">
          {NUTRIENTS.map((nutrient) => (
            <Input
              key={nutrient.name}
              id={`product-${nutrient.name}`}
              name={nutrient.name}
              label={nutrient.engine ? `${nutrient.label} ·` : nutrient.label}
              inputMode="decimal"
              autoComplete="off"
              required={required.has(nutrient.name)}
              defaultValue={display(product[nutrient.name])}
              error={errors[nutrient.name]}
            />
          ))}
        </div>
      </section>

      <section className="ad-org-panel" aria-labelledby="product-description">
        <h2 id="product-description" className="ad-org-panel-title">
          Description
        </h2>
        <div className="ad-form-grid">
          <div className="pk-field">
            <label className="pk-field-label" htmlFor="product-texture">
              Texture
            </label>
            <select
              id="product-texture"
              name="texture"
              className="pk-input"
              defaultValue={product.texture ?? ''}
            >
              <option value="">Non renseignée</option>
              {TEXTURE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <Input
            id="product-ratio"
            name="glucoseFructoseRatio"
            label="Ratio glucose / fructose"
            placeholder="2:1"
            autoComplete="off"
            defaultValue={product.glucoseFructoseRatio ?? ''}
            error={errors['glucoseFructoseRatio']}
          />
          {CHARACTERISTICS.map((characteristic) => (
            <div key={characteristic.name} className="pk-field">
              <label className="pk-field-label" htmlFor={`product-${characteristic.name}`}>
                {characteristic.label}
              </label>
              <select
                id={`product-${characteristic.name}`}
                name={characteristic.name}
                className="pk-input"
                defaultValue={triState(product[characteristic.name])}
              >
                <option value="">Non renseigné</option>
                <option value="true">Oui</option>
                <option value="false">Non</option>
              </select>
            </div>
          ))}
        </div>

        <fieldset className="ad-tag-choices">
          <legend className="pk-field-label">Tags</legend>
          {TAG_OPTIONS.map((tag) => (
            <label key={tag} className="ad-tag-choice">
              <input
                type="checkbox"
                name="tags"
                value={tag}
                defaultChecked={product.tags.includes(tag)}
              />
              <span>{tag}</span>
            </label>
          ))}
        </fieldset>
      </section>

      <section className="ad-org-panel" aria-labelledby="product-status">
        <h2 id="product-status" className="ad-org-panel-title">
          Statut
        </h2>
        <div className="pk-field ad-form-narrow">
          <label className="pk-field-label ad-visually-hidden" htmlFor="product-status-select">
            Statut de la fiche
          </label>
          <select
            id="product-status-select"
            name="status"
            className="pk-input"
            defaultValue={product.status}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <div className="ad-form-actions">
        <Link href="/produits/tous" className="pk-btn pk-button-secondary">
          Annuler
        </Link>
        <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
          Enregistrer
        </button>
      </div>

      {state.error === undefined ? null : (
        <p className="pk-field-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
