'use client';

import { useState, useTransition } from 'react';

import {
  resetMilestoneAction,
  setMilestoneItemsAction,
  setRefillPointAction,
} from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-actions';
import type { FlaskLine, FlaskView, MilestoneLine, SectionLine } from '@/lib/nutrition-format';

/** Un produit choisi pour la stratégie, tel que la modification le propose. */
export interface EditableProduct {
  readonly id: string;
  readonly name: string;
  readonly meta: string;
}

/**
 * Les vues de la Nutrition sur le Plan — prototype `nutViews` : « Ma
 * stratégie » (les prises, dans l'ordre), « Mes flasques » (point par point)
 * et « Par section », le récapitulatif d'un ravito au suivant : ce qui se
 * consomme, ce qu'il faut emporter et ce qu'on fait de ses flasques. Les
 * libellés arrivent prêts du serveur : rien ne se calcule ici.
 */

type View = 'strategie' | 'section' | 'flasques';

export function NutritionViews({
  participantRaceId,
  milestones,
  sections,
  flasks,
  products,
  canEdit,
}: {
  readonly participantRaceId: string;
  readonly milestones: readonly MilestoneLine[];
  readonly sections: readonly SectionLine[];
  readonly flasks: FlaskView | null;
  readonly products: readonly EditableProduct[];
  readonly canEdit: boolean;
}) {
  const [view, setView] = useState<View>('strategie');
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const allOpen = sections.length > 0 && sections.every((line) => open.has(line.key));

  const toggleSection = (key: string, isOpen: boolean) =>
    setOpen((current) => {
      if (current.has(key) === isOpen) return current;
      return isOpen
        ? new Set([...current, key])
        : new Set([...current].filter((entry) => entry !== key));
    });

  return (
    <div className="nu-views">
      <div className="nu-tabs" role="tablist" aria-label="Vues de la nutrition">
        {(
          [
            ['strategie', 'Ma stratégie'],
            ...(flasks === null ? [] : [['flasques', 'Mes flasques'] as const]),
            ['section', 'Par section'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={view === value}
            className="nu-tab"
            onClick={() => setView(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'flasques' && flasks !== null ? (
        <FlaskPanel participantRaceId={participantRaceId} flasks={flasks} canEdit={canEdit} />
      ) : view === 'strategie' ? (
        <ol className="nu-milestones">
          {milestones.map((line) => (
            <li
              key={line.key}
              className={line.official ? 'nu-milestone nu-milestone-aid' : 'nu-milestone'}
            >
              <span className="nu-milestone-when">
                <span className="nu-milestone-clock">{line.clock}</span>
                <span className="nu-meta">{line.km}</span>
              </span>
              <span className="nu-milestone-what">
                <span className="nu-milestone-name">
                  {line.name}
                  {line.customized ? <span className="nu-custom">Modifiée par toi</span> : null}
                </span>
                <span className="nu-reason">{line.reason}</span>
                {line.items.length === 0 ? (
                  line.customized ? (
                    <span className="nu-items">Rien à cette prise</span>
                  ) : null
                ) : (
                  <span className="nu-items">{line.items.join(' + ')}</span>
                )}
              </span>
              <span className="nu-milestone-need">
                {line.need}
                {canEdit && line.editable && products.length > 0 && editing !== line.key ? (
                  <button
                    type="button"
                    className="pk-btn pk-button-ghost nu-edit"
                    onClick={() => setEditing(line.key)}
                  >
                    Modifier
                  </button>
                ) : null}
              </span>
              {editing === line.key ? (
                <MilestoneEditor
                  participantRaceId={participantRaceId}
                  line={line}
                  products={products}
                  onDone={() => setEditing(null)}
                />
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <div className="nu-recap">
          <div className="nu-recap-head">
            <p className="nu-meta">
              D’un ravito au suivant : tes besoins, tes flasques et tes prises.
            </p>
            {sections.length > 1 ? (
              <button
                type="button"
                className="pk-btn pk-button-ghost nu-recap-all"
                onClick={() =>
                  setOpen(allOpen ? new Set() : new Set(sections.map((line) => line.key)))
                }
              >
                {allOpen ? 'Tout replier' : 'Tout déplier'}
              </button>
            ) : null}
          </div>
          <ol className="nu-sections">
            {sections.map((line) => (
              <li key={line.key} className="nu-section">
                <details
                  open={open.has(line.key)}
                  onToggle={(event) => toggleSection(line.key, event.currentTarget.open)}
                >
                  <summary className="nu-section-summary">
                    <span className="nu-section-title">
                      <span className="nu-section-name">
                        {line.name}
                        {line.status === 'low' || line.status === 'high' ? (
                          <span
                            className={
                              line.status === 'low' ? 'nu-status nu-status-low' : 'nu-status'
                            }
                          >
                            {line.status === 'low' ? 'À compléter' : 'Au-dessus de la cible'}
                          </span>
                        ) : null}
                      </span>
                      <span className="nu-meta">{line.meta}</span>
                      <span className="nu-section-needs">
                        <span className="pk-label">Besoins</span> {line.needs}
                      </span>
                    </span>
                    <span className="nu-section-toggle">
                      {open.has(line.key) ? 'Masquer le détail' : 'Voir le détail'}
                    </span>
                  </summary>
                  <div className="nu-section-body">
                    {line.coverage === null ? null : (
                      <div>
                        <span className="pk-label">Couverture</span>
                        <p className="nu-section-line">{line.coverage}</p>
                      </div>
                    )}
                    {/* Les flasques disent déjà quoi emporter, au plus juste : sans
                        boisson d'effort, tout part en eau ; un ravito sauté ne se remplit pas. */}
                    {line.flasks === null ? (
                      <div>
                        <span className="pk-label">À emporter</span>
                        <p className="nu-section-line">{line.carry}</p>
                      </div>
                    ) : (
                      <div className="nu-section-wide">
                        <span className="pk-label">{line.flasks.title}</span>
                        {line.flasks.note === null ? (
                          <FlaskLines lines={line.flasks.lines} />
                        ) : (
                          <p className="nu-section-line">{line.flasks.note}</p>
                        )}
                        {line.flasks.here === null ? null : (
                          <p className="nu-flask-here">{line.flasks.here}</p>
                        )}
                        {line.flasks.alerts.map((alert) => (
                          <p key={alert} className="nu-changed">
                            {alert}
                          </p>
                        ))}
                      </div>
                    )}
                    {line.prises.length === 0 ? null : (
                      <div className="nu-section-wide">
                        <span className="pk-label">Prises</span>
                        <ul className="nu-section-prises">
                          {line.prises.map((prise) => (
                            <li key={prise}>{prise}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/** Une ligne par contenant : ce qu'on y met, ou qu'on n'y touche pas. */
function FlaskLines({ lines }: { readonly lines: readonly FlaskLine[] }) {
  return (
    <ul className="nu-flask-lines">
      {lines.map((line) => (
        <li key={line.container} className={`nu-flask-line nu-flask-${line.tone}`}>
          <span className="pk-label">{line.container}</span>
          <span>{line.text}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Modifier les produits d'une prise — §58 : le coureur choisit parmi les
 * produits de sa stratégie, avec leur nombre. Ce qu'il fixe est gardé ; les
 * autres prises s'ajustent autour.
 */
function MilestoneEditor({
  participantRaceId,
  line,
  products,
  onDone,
}: {
  readonly participantRaceId: string;
  readonly line: MilestoneLine;
  readonly products: readonly EditableProduct[];
  readonly onDone: () => void;
}) {
  const [quantities, setQuantities] = useState<Readonly<Record<string, number>>>(() =>
    Object.fromEntries(line.current.map((item) => [item.productId, item.quantity])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const change = (productId: string, delta: number) =>
    setQuantities((current) => ({
      ...current,
      [productId]: Math.min(5, Math.max(0, (current[productId] ?? 0) + delta)),
    }));

  const save = () =>
    startTransition(async () => {
      const items = products
        .map((product) => ({ userProductId: product.id, quantity: quantities[product.id] ?? 0 }))
        .filter((item) => item.quantity > 0);
      const outcome = await setMilestoneItemsAction(participantRaceId, line.key, items);
      if (outcome.error !== undefined) {
        setError(outcome.error);
        return;
      }
      onDone();
    });

  const reset = () =>
    startTransition(async () => {
      const outcome = await resetMilestoneAction(participantRaceId, line.key);
      if (outcome.error !== undefined) {
        setError(outcome.error);
        return;
      }
      onDone();
    });

  return (
    <div className="nu-editor" role="group" aria-label={`Produits, ${line.name} ${line.clock}`}>
      <ul className="nu-editor-list">
        {products.map((product) => {
          const quantity = quantities[product.id] ?? 0;
          return (
            <li key={product.id} className="nu-editor-row">
              <span className="nu-pick-text">
                <span className="nu-pick-name">{product.name}</span>
                <span className="nu-meta">{product.meta}</span>
              </span>
              <span className="nu-stepper">
                <button
                  type="button"
                  className="nu-step-btn"
                  aria-label={`Un ${product.name} de moins`}
                  disabled={quantity === 0 || pending}
                  onClick={() => change(product.id, -1)}
                >
                  −
                </button>
                <output className="nu-step-value" aria-live="polite">
                  {quantity}
                </output>
                <button
                  type="button"
                  className="nu-step-btn"
                  aria-label={`Un ${product.name} de plus`}
                  disabled={quantity === 5 || pending}
                  onClick={() => change(product.id, 1)}
                >
                  +
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {error === null ? null : (
        <p className="pk-field-error" role="alert">
          {error}
        </p>
      )}
      <div className="nu-editor-actions">
        <button
          type="button"
          className="pk-btn pk-button-primary"
          disabled={pending}
          onClick={save}
        >
          {pending ? 'Enregistrement…' : 'Garder ces produits'}
        </button>
        {line.customized ? (
          <button
            type="button"
            className="pk-btn pk-button-secondary"
            disabled={pending}
            onClick={reset}
          >
            Revenir à la proposition PLUKA
          </button>
        ) : null}
        <button
          type="button"
          className="pk-btn pk-button-ghost"
          disabled={pending}
          onClick={onDone}
        >
          Annuler
        </button>
      </div>
      <p className="nu-dialog-note">
        Tes autres prises s’ajustent autour de ce choix. PLUKA ne le changera plus.
      </p>
    </div>
  );
}

/**
 * Mes flasques — §33, §34 : point par point, quoi mettre dans chaque flasque.
 * La boisson se prépare en flasque pleine ; une flasque qui suffit jusqu'au
 * point suivant ne se touche pas.
 */
function FlaskPanel({
  participantRaceId,
  flasks,
  canEdit,
}: {
  readonly participantRaceId: string;
  readonly flasks: FlaskView;
  readonly canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = (pointId: string, refill: boolean) =>
    startTransition(async () => {
      const outcome = await setRefillPointAction(participantRaceId, pointId, refill);
      setError(outcome.error ?? null);
    });

  return (
    <div className="nu-flasks" aria-busy={pending}>
      <div className="nu-flasks-head">
        <p className="nu-flasks-carry">{flasks.carrying}</p>
        {flasks.doses === null ? null : <p className="nu-meta">{flasks.doses}</p>}
        {flasks.warnings.map((warning) => (
          <p key={warning} className="nu-changed" role="status">
            {warning}
          </p>
        ))}
      </div>
      {error === null ? null : (
        <p className="pk-field-error" role="alert">
          {error}
        </p>
      )}
      <ol className="nu-flask-stops">
        {flasks.stops.map((stop) => (
          <li key={stop.key} className="nu-flask-stop">
            <span className="nu-milestone-when">
              <span className="nu-milestone-clock">{stop.clock}</span>
              <span className="nu-meta">{stop.km}</span>
            </span>
            <div className="nu-flask-body">
              <span className="nu-milestone-name">{stop.name}</span>
              <span className="nu-reason">{stop.need}</span>
              <FlaskLines lines={stop.lines} />
              {stop.here === null ? null : <p className="nu-flask-here">{stop.here}</p>}
              {stop.alerts.map((alert) => (
                <p key={alert} className="nu-changed" role="status">
                  {alert}
                </p>
              ))}
              {canEdit && stop.refill ? (
                <button
                  type="button"
                  className="pk-btn pk-button-ghost nu-flask-toggle"
                  disabled={pending}
                  onClick={() => toggle(stop.pointId, false)}
                >
                  Je ne remplis pas ici
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {flasks.skipped.length === 0 ? null : (
        <div className="nu-flask-skipped">
          <span className="pk-label">Tu ne remplis pas à</span>
          <ul className="nu-flask-lines">
            {flasks.skipped.map((point) => (
              <li key={point.pointId} className="nu-flask-line">
                <span>{point.name}</span>
                {canEdit ? (
                  <button
                    type="button"
                    className="pk-btn pk-button-ghost nu-flask-toggle"
                    disabled={pending}
                    onClick={() => toggle(point.pointId, true)}
                  >
                    Je remplis ici
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
