'use client';

import { useId, useState, useTransition } from 'react';

import {
  addCatalogueProductAction,
  createProductAction,
  searchCatalogueAction,
  setProductVolumeAction,
  type PickableProduct,
} from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-actions';

/**
 * « Quels produits veux-tu utiliser ? » — prototype `nutStepProducts`.
 *
 * PLUKA construit la stratégie avec les seuls produits choisis ici (§27) et
 * n'en ajoute aucun de lui-même. Pas de stock : « Mes produits » est une
 * liste, sans quantités (décision du 2026-11-17).
 */

const GROUPS: readonly { readonly title: string; readonly categories: readonly string[] }[] = [
  { title: 'Boissons', categories: ['drink'] },
  { title: 'Gels, purées et pâtes', categories: ['gel', 'puree', 'chew'] },
  { title: 'Barres et solides', categories: ['bar', 'solid', 'salty', 'other', 'generic_aid'] },
  { title: 'Sodium', categories: ['capsule', 'electrolyte'] },
];

const CATEGORY_LABELS: readonly (readonly [string, string])[] = [
  ['gel', 'Gel'],
  ['drink', 'Boisson'],
  ['bar', 'Barre'],
  ['chew', 'Pâte de fruits'],
  ['puree', 'Purée'],
  ['solid', 'Solide'],
  ['salty', 'Salé'],
  ['capsule', 'Capsule de sel'],
  ['electrolyte', 'Électrolytes'],
  ['other', 'Autre'],
];

function meta(product: PickableProduct): string {
  const parts = [`${String(Math.round(product.carbsG))} g glucides`];
  if (product.sodiumMg > 0) parts.push(`${String(product.sodiumMg)} mg sodium`);
  if (product.caffeineMg > 0) parts.push(`${String(product.caffeineMg)} mg caféine`);
  if (product.hydrationMl > 0) parts.push(`pour ${String(product.hydrationMl)} ml`);
  return parts.join(' · ');
}

export function ProductsStep({
  participantRaceId,
  products: initialProducts,
  selectedIds,
}: {
  readonly participantRaceId: string;
  readonly products: readonly PickableProduct[];
  readonly selectedIds: readonly string[];
}) {
  const [products, setProducts] = useState<readonly PickableProduct[]>(initialProducts);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(selectedIds));
  const [panel, setPanel] = useState<'none' | 'search' | 'create'>('none');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly (PickableProduct & { catalogueId: string })[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();

  const toggle = (productId: string) =>
    setSelected((current) =>
      current.has(productId)
        ? new Set([...current].filter((entry) => entry !== productId))
        : new Set([...current, productId]),
    );

  const adopt = (product: PickableProduct) => {
    setProducts((current) =>
      current.some((entry) => entry.id === product.id) ? current : [...current, product],
    );
    setSelected((current) => new Set(current).add(product.id));
  };

  const search = () =>
    startTransition(async () => {
      setResults(await searchCatalogueAction(participantRaceId, query));
    });

  const add = (result: PickableProduct & { catalogueId: string }) =>
    startTransition(async () => {
      const outcome = await addCatalogueProductAction(participantRaceId, result.catalogueId);
      if (outcome.id === undefined) {
        setError(outcome.error ?? 'Ce produit n’a pas pu être ajouté.');
        return;
      }
      setError(null);
      adopt({ ...result, id: outcome.id });
    });

  const [draft, setDraft] = useState({
    name: '',
    brand: '',
    category: 'gel',
    carbsG: '',
    sodiumMg: '',
    caffeineMg: '',
    hydrationMl: '',
  });
  const create = () =>
    startTransition(async () => {
      const product = {
        name: draft.name,
        brand: draft.brand,
        category: draft.category,
        carbsG: Number(draft.carbsG.replace(',', '.') || 0),
        sodiumMg: Math.round(Number(draft.sodiumMg || 0)),
        caffeineMg: Math.round(Number(draft.caffeineMg || 0)),
        hydrationMl: Math.round(Number(draft.hydrationMl || 0)),
      };
      const outcome = await createProductAction(participantRaceId, product);
      if (outcome.id === undefined) {
        setError(outcome.error ?? 'Ce produit n’a pas pu être créé.');
        return;
      }
      setError(null);
      adopt({
        id: outcome.id,
        name: product.brand === '' ? product.name : `${product.brand} ${product.name}`,
        category: product.category,
        carbsG: product.carbsG,
        sodiumMg: product.sodiumMg,
        caffeineMg: product.caffeineMg,
        hydrationMl: product.hydrationMl,
      });
      setPanel('none');
      setDraft({
        name: '',
        brand: '',
        category: 'gel',
        carbsG: '',
        sodiumMg: '',
        caffeineMg: '',
        hydrationMl: '',
      });
    });

  return (
    <div className="nu-products">
      <input type="hidden" name="productsStep" value="1" />
      {[...selected].map((productId) => (
        <input key={productId} type="hidden" name="productIds" value={productId} />
      ))}

      <p className="nu-dialog-eyebrow">Étape 2 sur 2</p>
      <h2 className="nu-dialog-title">Quels produits veux-tu utiliser ?</h2>
      <p className="nu-dialog-body">
        PLUKA construit ta stratégie à partir des produits que tu as réellement envie d’utiliser.
      </p>

      {GROUPS.map((group) => {
        const items = products.filter((product) => group.categories.includes(product.category));
        return (
          <fieldset key={group.title} className="nu-fieldset">
            <legend className="pk-field-label">{group.title}</legend>
            {items.length === 0 ? (
              <p className="pk-field-hint">Aucun pour l’instant.</p>
            ) : (
              <ul className="nu-picks">
                {items.map((product) => (
                  <li key={product.id}>
                    <button
                      type="button"
                      className="nu-pick"
                      aria-pressed={selected.has(product.id)}
                      onClick={() => toggle(product.id)}
                    >
                      <span className="nu-pick-box" aria-hidden="true">
                        {selected.has(product.id) ? '✓' : ''}
                      </span>
                      <span className="nu-pick-text">
                        <span className="nu-pick-name">{product.name}</span>
                        <span className="nu-meta">{meta(product)}</span>
                      </span>
                    </button>
                    {product.category === 'drink' &&
                    product.hydrationMl === 0 &&
                    selected.has(product.id) ? (
                      <VolumeField
                        product={product}
                        onSave={(milliliters) =>
                          startTransition(async () => {
                            const outcome = await setProductVolumeAction(
                              participantRaceId,
                              product.id,
                              milliliters,
                            );
                            if (outcome.error !== undefined) {
                              setError(outcome.error);
                              return;
                            }
                            setError(null);
                            setProducts((current) =>
                              current.map((entry) =>
                                entry.id === product.id
                                  ? { ...entry, hydrationMl: milliliters }
                                  : entry,
                              ),
                            );
                          })
                        }
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        );
      })}

      <div className="nu-chips">
        <button
          type="button"
          className="pk-btn pk-button-secondary"
          aria-expanded={panel === 'search'}
          onClick={() => setPanel(panel === 'search' ? 'none' : 'search')}
        >
          Ajouter un produit
        </button>
        <button
          type="button"
          className="pk-btn pk-button-secondary"
          aria-expanded={panel === 'create'}
          onClick={() => setPanel(panel === 'create' ? 'none' : 'create')}
        >
          Créer un produit personnel
        </button>
      </div>

      {panel === 'search' ? (
        <div className="nu-panel">
          <label className="pk-field-label" htmlFor={`${id}-query`}>
            Chercher dans le catalogue PLUKA
          </label>
          <div className="as-inline-form">
            <input
              id={`${id}-query`}
              className="pk-input"
              value={query}
              placeholder="Maurten, Näak, gel…"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  search();
                }
              }}
            />
            <button
              type="button"
              className="pk-btn pk-button-secondary"
              onClick={search}
              disabled={pending}
            >
              Chercher
            </button>
          </div>
          {results.length === 0 ? null : (
            <ul className="nu-results">
              {results.map((result) => (
                <li key={result.catalogueId} className="nu-result">
                  <span className="nu-pick-text">
                    <span className="nu-pick-name">{result.name}</span>
                    <span className="nu-meta">{meta(result)}</span>
                  </span>
                  <button
                    type="button"
                    className="pk-btn pk-button-ghost"
                    disabled={pending}
                    onClick={() => add(result)}
                  >
                    Ajouter
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {panel === 'create' ? (
        <div
          className="nu-panel"
          onKeyDown={(event) => {
            // Seulement depuis un champ : Entrée sur le bouton le clique déjà.
            if (
              event.key === 'Enter' &&
              event.target instanceof HTMLInputElement &&
              !pending &&
              draft.name.trim() !== ''
            )
              create();
          }}
        >
          <div className="nu-fields">
            <label className="pk-field">
              <span className="pk-field-label">Nom</span>
              <input
                className="pk-input"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label className="pk-field">
              <span className="pk-field-label">Marque (facultatif)</span>
              <input
                className="pk-input"
                value={draft.brand}
                onChange={(event) => setDraft({ ...draft, brand: event.target.value })}
              />
            </label>
            <label className="pk-field">
              <span className="pk-field-label">Type</span>
              <select
                className="pk-input"
                value={draft.category}
                onChange={(event) => setDraft({ ...draft, category: event.target.value })}
              >
                {CATEGORY_LABELS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="pk-field">
              <span className="pk-field-label">Glucides par portion (g)</span>
              <input
                className="pk-input"
                inputMode="decimal"
                value={draft.carbsG}
                onChange={(event) => setDraft({ ...draft, carbsG: event.target.value })}
              />
            </label>
            <label className="pk-field">
              <span className="pk-field-label">Sodium (mg)</span>
              <input
                className="pk-input"
                inputMode="numeric"
                value={draft.sodiumMg}
                onChange={(event) => setDraft({ ...draft, sodiumMg: event.target.value })}
              />
            </label>
            <label className="pk-field">
              <span className="pk-field-label">Caféine (mg)</span>
              <input
                className="pk-input"
                inputMode="numeric"
                value={draft.caffeineMg}
                onChange={(event) => setDraft({ ...draft, caffeineMg: event.target.value })}
              />
            </label>
            <label className="pk-field">
              <span className="pk-field-label">Volume (ml, boissons)</span>
              <input
                className="pk-input"
                inputMode="numeric"
                value={draft.hydrationMl}
                onChange={(event) => setDraft({ ...draft, hydrationMl: event.target.value })}
              />
            </label>
          </div>
          <button
            type="button"
            className="pk-btn pk-button-secondary"
            onClick={create}
            disabled={pending || draft.name.trim() === ''}
          >
            Créer et choisir ce produit
          </button>
        </div>
      ) : null}

      {error === null ? null : (
        <p className="pk-field-error" role="alert">
          {error}
        </p>
      )}
      <p className="nu-dialog-note">
        {selected.size === 0
          ? 'Aucun produit choisi'
          : selected.size === 1
            ? '1 produit choisi'
            : `${String(selected.size)} produits choisis`}{' '}
        · PLUKA n’ajoutera aucun autre produit de lui-même. S’il manque des apports, il te le
        signalera.
      </p>
    </div>
  );
}

/**
 * Une boisson en poudre ne dit pas son volume : sans lui, sa concentration est
 * inconnue et elle ne compte pas (NUTRITION_ENGINE §29). Le coureur le donne
 * une fois, il est gardé dans « Mes produits ».
 */
function VolumeField({
  product,
  onSave,
}: {
  readonly product: PickableProduct;
  readonly onSave: (milliliters: number) => void;
}) {
  const [value, setValue] = useState('500');
  const id = useId();
  return (
    <div className="nu-volume">
      <label className="pk-field-label" htmlFor={`${id}-volume`}>
        Une portion de {product.name}, diluée dans combien de ml ?
      </label>
      <div className="as-inline-form">
        <input
          id={`${id}-volume`}
          className="pk-input"
          inputMode="numeric"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSave(Math.round(Number(value)));
          }}
        />
        <button
          type="button"
          className="pk-btn pk-button-secondary"
          onClick={() => onSave(Math.round(Number(value)))}
        >
          Enregistrer
        </button>
      </div>
    </div>
  );
}
