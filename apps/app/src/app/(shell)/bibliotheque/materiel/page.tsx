import { GEAR_CATEGORIES, listMyEquipment, type GearCategory } from '@pluka/domain';
import Link from 'next/link';

import {
  removeFromMyEquipmentAction,
  updateMyEquipmentAction,
} from '@/app/(shell)/bibliotheque/materiel/actions';
import { AddToLibraryForm } from '@/app/(shell)/bibliotheque/materiel/add-to-library-form';
import { Icon } from '@/components/icon';
import { GEAR_CATEGORY_LABELS } from '@/lib/gear-categories';
import { libraryContext } from '@/lib/library';
import { requireSession } from '@/lib/session';

/**
 * Bibliothèque · Matériel — « Mon matériel ». 00_PRODUCT_SPEC §20 ;
 * 04_ENTITLEMENTS §48 ; migrations 0092, 0093 ; décisions produit du 2026-11-13.
 *
 * Tout ce que le coureur possède, rangé par catégorie et tagué, pour le
 * retrouver vite et l'ajouter d'un clic à la Préparation d'une course. Les
 * filtres sont des liens : ils marchent sans JavaScript et se partagent.
 *
 * Le lire est gratuit : un PLUKA+ expiré garde son matériel ; le classer et
 * l'enrichir est PLUKA+.
 */
export const metadata = { title: 'Matériel · Bibliothèque' };

function isCategory(value: string | undefined): value is GearCategory {
  return (GEAR_CATEGORIES as readonly string[]).includes(value ?? '');
}

function filterHref(category?: string, tag?: string): string {
  const params = new URLSearchParams();
  if (category !== undefined) params.set('categorie', category);
  if (tag !== undefined) params.set('tag', tag);
  const query = params.toString();
  return query === '' ? '/bibliotheque/materiel' : `/bibliotheque/materiel?${query}`;
}

export default async function EquipmentLibraryPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly categorie?: string; readonly tag?: string }>;
}) {
  const { categorie, tag } = await searchParams;
  const session = await requireSession('/bibliotheque/materiel');
  const category = isCategory(categorie) ? categorie : undefined;
  const mine = await listMyEquipment(libraryContext(session), {
    ...(category === undefined ? {} : { category }),
    ...(tag === undefined || tag.trim() === '' ? {} : { tag }),
  });
  const filtered = category !== undefined || (tag !== undefined && tag.trim() !== '');

  // Regroupe les pièces par catégorie, dans l'ordre de la liste fixe.
  const groups = GEAR_CATEGORIES.map((value) => ({
    category: value,
    items: mine.items.filter((item) => item.category === value),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="lb-page">
      <header className="lb-intro">
        <h1 className="lb-title">Mon matériel</h1>
        <p className="lb-sub">
          Tout ce que tu possèdes, rangé par catégorie, à reprendre d’un clic dans la préparation de
          tes courses — sans rien retaper.
        </p>
      </header>

      {mine.total === 0 ? null : (
        <nav className="lb-filters" aria-label="Filtrer mon matériel">
          <ul className="lb-filter-row">
            <li>
              <Link
                href={filterHref(undefined, tag)}
                className="lb-filter"
                aria-current={category === undefined ? 'true' : undefined}
              >
                Tout <span className="lb-count">{mine.total}</span>
              </Link>
            </li>
            {GEAR_CATEGORIES.filter((value) => (mine.categoryCounts[value] ?? 0) > 0).map(
              (value) => (
                <li key={value}>
                  <Link
                    href={filterHref(value, tag)}
                    className="lb-filter"
                    aria-current={category === value ? 'true' : undefined}
                  >
                    {GEAR_CATEGORY_LABELS[value]}{' '}
                    <span className="lb-count">{mine.categoryCounts[value]}</span>
                  </Link>
                </li>
              ),
            )}
          </ul>
          {mine.tags.length === 0 ? null : (
            <ul className="lb-filter-row lb-tag-row">
              {mine.tags.map((value) => (
                <li key={value}>
                  <Link
                    href={filterHref(category, tag === value ? undefined : value)}
                    className="lb-tag-filter"
                    aria-current={tag === value ? 'true' : undefined}
                  >
                    #{value}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </nav>
      )}

      {mine.total === 0 ? (
        <p className="lb-empty">
          {mine.canEdit
            ? 'Rien pour l’instant. Ajoute ton matériel ci-dessous, ou prépare une course : ce que tu y ajoutes arrive ici.'
            : 'Rien pour l’instant.'}
        </p>
      ) : groups.length === 0 ? (
        <p className="lb-empty">
          Aucune pièce ne correspond à ce filtre.{' '}
          <Link href="/bibliotheque/materiel" className="pk-link">
            Tout afficher
          </Link>
        </p>
      ) : (
        groups.map((group) => (
          <section
            key={group.category}
            className="lb-inventory"
            aria-labelledby={`lb-${group.category}`}
          >
            <h2 id={`lb-${group.category}`} className="eq-heading">
              {GEAR_CATEGORY_LABELS[group.category]} · {group.items.length}
            </h2>
            <ul className="eq-list">
              {group.items.map((item) => (
                <li key={item.id} className="lb-row">
                  <div className="lb-row-main">
                    <span className="lb-row-label">{item.label}</span>
                    {item.tags.length === 0 ? null : (
                      <span className="lb-row-tags">
                        {item.tags.map((value) => (
                          <span key={value} className="lb-tag">
                            #{value}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                  {mine.canEdit ? (
                    <>
                      <details className="lb-classify">
                        <summary>Classer</summary>
                        <form action={updateMyEquipmentAction} className="lb-classify-form">
                          <input type="hidden" name="itemId" value={item.id} />
                          <label className="lb-field">
                            <span className="pk-label">Catégorie</span>
                            <select
                              name="category"
                              defaultValue={item.category}
                              className="lb-input"
                            >
                              {GEAR_CATEGORIES.map((value) => (
                                <option key={value} value={value}>
                                  {GEAR_CATEGORY_LABELS[value]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="lb-field">
                            <span className="pk-label">Tags, séparés par des virgules</span>
                            <input
                              name="tags"
                              defaultValue={item.tags.join(', ')}
                              placeholder="hiver, nuit, ultra"
                              className="lb-input"
                              list="lb-known-tags"
                            />
                          </label>
                          <button type="submit" className="pk-btn pk-button-secondary">
                            Enregistrer
                          </button>
                        </form>
                      </details>
                      <form action={removeFromMyEquipmentAction} className="eq-remove">
                        <input type="hidden" name="itemId" value={item.id} />
                        <button type="submit" aria-label={`Retirer ${item.label} de mon matériel`}>
                          <Icon name="X" size={16} />
                        </button>
                      </form>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {/* Les tags déjà utilisés, proposés à la saisie. */}
      <datalist id="lb-known-tags">
        {mine.tags.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>

      {filtered ? null : mine.canEdit ? (
        <section className="lb-new" aria-label="Ajouter à mon matériel">
          <AddToLibraryForm />
          <p className="lb-hint">
            PLUKA range chaque pièce dans sa catégorie d’après son nom. Tu peux la corriger avec «
            Classer ».
          </p>
        </section>
      ) : (
        <section className="eq-locked" aria-label="Mon matériel avec PLUKA+">
          <p>
            Avec PLUKA+, PLUKA retient tout ton matériel d’une course à l’autre : tu le retrouves
            ici, rangé, et tu l’ajoutes d’un clic à ta prochaine préparation.
          </p>
          <Link href="/offre" className="pk-btn pk-button-secondary">
            Découvrir PLUKA+
          </Link>
        </section>
      )}
    </div>
  );
}
