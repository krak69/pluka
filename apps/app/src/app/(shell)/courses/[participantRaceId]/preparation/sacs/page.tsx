import { DomainError, getBags, type BagPoint, type BagView } from '@pluka/domain';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  acceptSuggestionAction,
  addBagPicksAction,
  deleteBagAction,
  dismissSuggestionAction,
  removeBagItemAction,
  restoreSuggestionsAction,
  setBagItemAction,
} from '@/app/(shell)/courses/[participantRaceId]/preparation/sacs/actions';
import {
  AddBagItemForm,
  NewBagForm,
  RenameBagForm,
} from '@/app/(shell)/courses/[participantRaceId]/preparation/sacs/bag-forms';
import { Icon } from '@/components/icon';
import { bagsContext } from '@/lib/preparation';
import { requireSession } from '@/lib/session';

/**
 * Préparation · Sacs — 00_PRODUCT_SPEC §14.4 ; prototype, `prepTab: 'sacs'`.
 *
 * L'onglet s'ouvre vide, avec les sacs que la course appelle en suggestions
 * (décisions produit du 2026-11-16). Les consignes officielles sur les sacs
 * restent lisibles en Free (AGENTS §22) ; créer et remplir des sacs demande
 * le Race Pass, et l'écran le dit au lieu de masquer la section (04 §45).
 *
 * Les cases sont de vrais boutons de formulaire : elles marchent sans
 * JavaScript, et annoncent leur état (`aria-pressed`).
 */
export const metadata = { title: 'Sacs' };

function km(value: number): string {
  return `km ${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)}`;
}

function pointLine(point: BagPoint | null): string | null {
  return point === null ? null : `${point.name} · ${km(point.distanceKm)}`;
}

function Check({ on }: { readonly on: boolean }) {
  return (
    <span className={on ? 'eq-box eq-box-on' : 'eq-box'} aria-hidden="true">
      {on ? <Icon name="Check" size={14} /> : null}
    </span>
  );
}

const ISSUES = {
  removed:
    'L’organisation a retiré ce point du parcours. Choisis un autre point ou supprime ce sac.',
  drop_bag_withdrawn:
    'L’organisation n’accepte plus de drop bag à ce point. Vérifie les consignes officielles.',
} as const;

function Bag({
  bag,
  participantRaceId,
  canEdit,
}: {
  readonly bag: BagView;
  readonly participantRaceId: string;
  readonly canEdit: boolean;
}) {
  const titleId = `bag-${bag.id}`;
  const where = pointLine(bag.point);
  const percent =
    bag.items.length === 0 ? 0 : Math.round((bag.checkedCount / bag.items.length) * 100);

  return (
    <section className="bg-bag" aria-labelledby={titleId}>
      <header className="bg-bag-head">
        <h2 id={titleId} className="bg-bag-name">
          {bag.name}
        </h2>
        <span className={bag.ready ? 'eq-tag eq-tag-mandatory' : 'eq-tag'}>
          {bag.ready ? 'Prêt' : 'À compléter'}
        </span>
        <span className="bg-bag-count">
          {bag.checkedCount} / {bag.items.length}
        </span>
      </header>
      {where === null ? null : <p className="bg-bag-point">{where}</p>}
      {bag.pointIssue === null ? null : (
        <p className="bg-issue" role="status">
          {ISSUES[bag.pointIssue]}
        </p>
      )}
      <div
        className="eq-bar bg-bar"
        role="progressbar"
        aria-label={`${bag.name} : éléments dans le sac`}
        aria-valuemin={0}
        aria-valuemax={bag.items.length}
        aria-valuenow={bag.checkedCount}
      >
        <span style={{ width: `${String(percent)}%` }} />
      </div>

      {bag.items.length === 0 ? (
        <p className="bg-empty">Ce sac est vide. Ajoute ce que tu y mets.</p>
      ) : (
        <ul className="bg-items">
          {bag.items.map((item) => (
            <li key={item.id} className="bg-item">
              {canEdit ? (
                <form action={setBagItemAction} className="eq-toggle">
                  <input type="hidden" name="participantRaceId" value={participantRaceId} />
                  <input type="hidden" name="bagId" value={bag.id} />
                  <input type="hidden" name="itemId" value={item.id} />
                  <input type="hidden" name="checked" value={item.checked ? 'false' : 'true'} />
                  <button type="submit" className="eq-check bg-check" aria-pressed={item.checked}>
                    <Check on={item.checked} />
                    <span className={item.checked ? 'eq-label eq-label-done' : 'eq-label'}>
                      {item.label}
                    </span>
                  </button>
                </form>
              ) : (
                <span className="eq-check bg-check">
                  <Check on={item.checked} />
                  <span className="eq-label">{item.label}</span>
                </span>
              )}
              {item.quantity > 1 ? <span className="bg-qty-label">× {item.quantity}</span> : null}
              {canEdit ? (
                <form action={removeBagItemAction} className="eq-remove">
                  <input type="hidden" name="participantRaceId" value={participantRaceId} />
                  <input type="hidden" name="bagId" value={bag.id} />
                  <input type="hidden" name="itemId" value={item.id} />
                  <button type="submit" aria-label={`Retirer ${item.label} de ${bag.name}`}>
                    <Icon name="X" size={16} />
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <>
          <AddBagItemForm participantRaceId={participantRaceId} bagId={bag.id} bagName={bag.name} />

          {/* La checklist et « Mon matériel » : copiés d'un clic, sans lien (0095). */}
          {bag.picks.length === 0 ? null : (
            <div className="bg-picks">
              <p className="eq-chip-group-title">Depuis ma checklist et mon matériel</p>
              <ul className="eq-chips">
                {bag.picks.map((label) => (
                  <li key={label}>
                    <form action={addBagPicksAction}>
                      <input type="hidden" name="participantRaceId" value={participantRaceId} />
                      <input type="hidden" name="bagId" value={bag.id} />
                      <input type="hidden" name="label" value={label} />
                      <button type="submit" aria-label={`Mettre ${label} dans ${bag.name}`}>
                        + {label}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <details className="bg-edit">
            <summary>Modifier le sac</summary>
            <div className="bg-edit-body">
              <RenameBagForm participantRaceId={participantRaceId} bagId={bag.id} name={bag.name} />
              <form action={deleteBagAction}>
                <input type="hidden" name="participantRaceId" value={participantRaceId} />
                <input type="hidden" name="bagId" value={bag.id} />
                <button type="submit" className="pk-btn pk-button-ghost bg-delete">
                  Supprimer ce sac et son contenu
                </button>
              </form>
            </div>
          </details>
        </>
      ) : null}
    </section>
  );
}

export default async function BagsPage({
  params,
}: {
  readonly params: Promise<{ readonly participantRaceId: string }>;
}) {
  const { participantRaceId } = await params;
  const session = await requireSession(`/courses/${participantRaceId}/preparation/sacs`);

  const overview = await getBags(bagsContext(session), { participantRaceId }).catch(
    (error: unknown) => {
      if (error instanceof DomainError && error.code === 'not_found') notFound();
      throw error;
    },
  );

  const { ready, canEdit } = overview;
  const percent = ready.total === 0 ? 0 : Math.round((ready.ready / ready.total) * 100);

  return (
    <div className="eq-page">
      {ready.total === 0 ? null : (
        <section className="eq-summary" aria-labelledby="bg-gauge">
          <h1 id="bg-gauge" className="eq-gauge">
            {ready.ready} / {ready.total} prêt{ready.ready > 1 ? 's' : ''}
          </h1>
          <div
            className="eq-bar"
            role="progressbar"
            aria-label="Sacs prêts"
            aria-valuemin={0}
            aria-valuemax={ready.total}
            aria-valuenow={ready.ready}
          >
            <span style={{ width: `${String(percent)}%` }} />
          </div>
        </section>
      )}

      {overview.officialNotes.length === 0 ? null : (
        <section aria-labelledby="bg-official-title">
          <h2 id="bg-official-title" className="eq-heading">
            Organisation · consignes officielles
          </h2>
          <ul className="eq-list">
            {overview.officialNotes.map((note) => (
              <li key={note.factId} className="eq-row">
                <span className="bg-note">{note.text}</span>
                <Link href={`/courses/${participantRaceId}/course#rf-bag`} className="eq-source">
                  Voir la source
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canEdit ? (
        overview.suggestions.length === 0 && overview.dismissedCount === 0 ? null : (
          <section aria-labelledby="bg-suggestions-title">
            <h2 id="bg-suggestions-title" className="eq-heading">
              Suggestions PLUKA · d’après le parcours
            </h2>
            {overview.suggestions.length === 0 ? null : (
              <ul className="eq-list">
                {overview.suggestions.map((suggestion) => (
                  <li key={suggestion.key} className="bg-suggestion">
                    <div className="bg-suggestion-text">
                      <span className="bg-suggestion-name">{suggestion.name}</span>
                      {suggestion.point === null ? null : (
                        <span className="bg-bag-point">{km(suggestion.point.distanceKm)}</span>
                      )}
                    </div>
                    <form action={acceptSuggestionAction}>
                      <input type="hidden" name="participantRaceId" value={participantRaceId} />
                      <input type="hidden" name="bagType" value={suggestion.bagType} />
                      <input type="hidden" name="pointId" value={suggestion.point?.id ?? ''} />
                      <button
                        type="submit"
                        className="pk-btn pk-button-secondary bg-add-button"
                        aria-label={`Ajouter ${suggestion.name}`}
                      >
                        + Ajouter
                      </button>
                    </form>
                    <form action={dismissSuggestionAction}>
                      <input type="hidden" name="participantRaceId" value={participantRaceId} />
                      <input type="hidden" name="key" value={suggestion.key} />
                      <button
                        type="submit"
                        className="pk-btn pk-button-ghost bg-add-button"
                        aria-label={`Pas besoin : ${suggestion.name}`}
                      >
                        Pas besoin
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            {overview.dismissedCount === 0 ? null : (
              <form action={restoreSuggestionsAction} className="bg-restore">
                <input type="hidden" name="participantRaceId" value={participantRaceId} />
                <button type="submit" className="eq-add-all">
                  Réafficher les suggestions écartées ({overview.dismissedCount})
                </button>
              </form>
            )}
          </section>
        )
      ) : (
        <div className="eq-locked">
          <p>
            Prépare ton sac de départ, tes drop bags, ton sac d’assistance et ton sac d’arrivée, et
            coche ce que tu y mets. Les sacs font partie de la préparation complète.
          </p>
          <Link href={`/offre?course=${participantRaceId}`} className="pk-btn pk-button-secondary">
            Voir le Race Pass
          </Link>
        </div>
      )}

      {overview.bags.length === 0 ? (
        canEdit ? (
          <p className="eq-empty">
            Aucun sac pour l’instant. Ajoute ceux que PLUKA te suggère, ou crée le tien ci-dessous.
          </p>
        ) : null
      ) : (
        <div className="bg-bags">
          {overview.bags.map((bag) => (
            <Bag key={bag.id} bag={bag} participantRaceId={participantRaceId} canEdit={canEdit} />
          ))}
        </div>
      )}

      {canEdit ? (
        <section aria-labelledby="bg-new-title">
          <h2 id="bg-new-title" className="eq-heading">
            Ajouter un sac
          </h2>
          <NewBagForm
            participantRaceId={participantRaceId}
            dropBagPoints={overview.dropBagPoints}
            assistancePoints={overview.assistancePoints}
          />
        </section>
      ) : null}
    </div>
  );
}
