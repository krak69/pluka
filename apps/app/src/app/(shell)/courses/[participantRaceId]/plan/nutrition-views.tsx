'use client';

import { useEffect, useState, useTransition } from 'react';

import {
  resetMilestoneAction,
  setMilestoneItemsAction,
  setRefillPointAction,
  setReserveAction,
  setSupplyPointAction,
} from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-actions';
import { NutritionSendStatus } from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-send';
import {
  AidControls,
  AidDrinkChoice,
  AidInfo,
} from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-aid';
import type {
  AidLine,
  FlaskLine,
  FlaskView,
  MilestoneLine,
  PreparationLines,
  SectionLine,
  SupplyValue,
} from '@/lib/nutrition-format';

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

type View = 'strategie' | 'section' | 'flasques' | 'preparer';

export function NutritionViews({
  participantRaceId,
  milestones,
  sections,
  flasks,
  preparation,
  aid,
  products,
  canEdit,
}: {
  readonly participantRaceId: string;
  readonly milestones: readonly MilestoneLine[];
  readonly sections: readonly SectionLine[];
  readonly flasks: FlaskView | null;
  readonly preparation: PreparationLines | null;
  /** Ce que propose chaque ravitaillement (0110). */
  readonly aid: readonly AidLine[];
  readonly products: readonly EditableProduct[];
  readonly canEdit: boolean;
}) {
  const [view, setView] = useState<View>('strategie');
  const aidOf = new Map(aid.map((line) => [line.pointId, line]));
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const allOpen = sections.length > 0 && sections.every((line) => open.has(line.key));

  // Une prise choisie sur le profil : `seq` fait défiler à nouveau un second clic sur le même point.
  const [target, setTarget] = useState<{ readonly anchor: string; readonly seq: number } | null>(
    null,
  );
  const anchors = milestones.map((line) => line.anchor).join(' ');

  useEffect(() => {
    const known = new Set(anchors.split(' '));
    const reveal = (anchor: string) => {
      setView('strategie');
      setTarget((current) => ({ anchor, seq: (current?.seq ?? 0) + 1 }));
    };
    // Les points du profil visent les lignes de « Ma stratégie », qui n'existent
    // que sous cet onglet : on l'ouvre, puis on fait défiler jusqu'à la prise.
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest('a.pl-intake')?.getAttribute('href')?.slice(1);
      if (anchor === undefined || !known.has(anchor)) return;
      event.preventDefault();
      reveal(anchor);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [anchors]);

  useEffect(() => {
    if (target === null) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document
      .getElementById(target.anchor)
      ?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }, [target]);

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
            ...(preparation === null ? [] : [['preparer', 'À préparer'] as const]),
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

      {view === 'preparer' && preparation !== null ? (
        <PreparationPanel
          participantRaceId={participantRaceId}
          preparation={preparation}
          aidOf={aidOf}
          canEdit={canEdit}
        />
      ) : view === 'flasques' && flasks !== null ? (
        <FlaskPanel
          participantRaceId={participantRaceId}
          flasks={flasks}
          aidOf={aidOf}
          canEdit={canEdit}
        />
      ) : view === 'strategie' ? (
        <ol className="nu-milestones">
          {milestones.map((line) => (
            <li
              key={line.key}
              id={line.anchor}
              className={[
                'nu-milestone',
                ...(line.official ? ['nu-milestone-aid'] : []),
                ...(target?.anchor === line.anchor ? ['nu-milestone-target'] : []),
              ].join(' ')}
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
                {line.pointId === null ? null : <AidInfo line={aidOf.get(line.pointId)} />}
                {line.pointId === null || flasks === null ? null : (
                  <AidDrinkChoice
                    participantRaceId={participantRaceId}
                    line={aidOf.get(line.pointId)}
                    hasDrink={flasks.hasDrink}
                    canEdit={canEdit}
                    onShowFlasks={() => setView('flasques')}
                  />
                )}
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
  aidOf,
  canEdit,
}: {
  readonly participantRaceId: string;
  readonly flasks: FlaskView;
  readonly aidOf: ReadonlyMap<string, AidLine>;
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
              {stop.refill ? <AidInfo line={aidOf.get(stop.pointId)} /> : null}
              <FlaskLines lines={stop.lines} />
              {stop.here === null ? null : <p className="nu-flask-here">{stop.here}</p>}
              {stop.alerts.map((alert) => (
                <p key={alert} className="nu-changed" role="status">
                  {alert}
                </p>
              ))}
              {stop.refill ? (
                <AidControls
                  participantRaceId={participantRaceId}
                  line={aidOf.get(stop.pointId)}
                  hasDrink={flasks.hasDrink}
                  canEdit={canEdit}
                />
              ) : null}
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

const RESERVES = [0, 10, 20] as const;

/**
 * À préparer pour cette course — §49 à §56 : combien de chaque produit, la
 * réserve en plus, et où les trouver point par point. Ce qui sert après un
 * ravitaillement vient de ce point : ton drop bag, ton Assistance, ou porté
 * depuis le départ.
 */
function PreparationPanel({
  participantRaceId,
  preparation,
  aidOf,
  canEdit,
}: {
  readonly participantRaceId: string;
  readonly preparation: PreparationLines;
  readonly aidOf: ReadonlyMap<string, AidLine>;
  readonly canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const preset = (RESERVES as readonly number[]).includes(preparation.reservePercent);
  const [other, setOther] = useState(!preset);
  const [otherValue, setOtherValue] = useState(preset ? '' : String(preparation.reservePercent));

  const reserve = (percent: number) =>
    startTransition(async () => {
      const outcome = await setReserveAction(participantRaceId, percent);
      setError(outcome.error ?? null);
    });

  const supply = (pointId: string, value: SupplyValue) =>
    startTransition(async () => {
      const outcome = await setSupplyPointAction(
        participantRaceId,
        pointId,
        value === 'auto' ? null : value,
      );
      setError(outcome.error ?? null);
    });

  return (
    <div className="nu-prep" aria-busy={pending}>
      <section className="nu-prep-block" aria-labelledby="nu-prep-reserve">
        <h3 id="nu-prep-reserve" className="nu-prep-title">
          Réserve de sécurité
        </h3>
        <p className="nu-meta">
          Elle s’ajoute à ce que tu prépares, jamais à ce que tu consommes. Elle part avec toi.
        </p>
        {canEdit ? (
          <div className="nu-chips" role="group" aria-label="Réserve de sécurité">
            {RESERVES.map((percent) => (
              <button
                key={percent}
                type="button"
                className="nu-chip"
                aria-pressed={!other && preparation.reservePercent === percent}
                disabled={pending}
                onClick={() => {
                  setOther(false);
                  reserve(percent);
                }}
              >
                {percent === 0 ? 'Aucune' : `+${String(percent)} %`}
              </button>
            ))}
            <button
              type="button"
              className="nu-chip"
              aria-pressed={other}
              disabled={pending}
              onClick={() => setOther(true)}
            >
              Autre
            </button>
          </div>
        ) : (
          <p className="nu-section-line">
            {preparation.reservePercent === 0
              ? 'Aucune réserve'
              : `+${String(preparation.reservePercent)} %`}
          </p>
        )}
        {canEdit && other ? (
          <form
            className="nu-prep-other"
            onSubmit={(event) => {
              event.preventDefault();
              const value = Number(otherValue.replace(',', '.'));
              if (otherValue.trim() !== '' && Number.isFinite(value)) reserve(value);
            }}
          >
            <label className="pk-field">
              <span className="pk-field-label">Réserve, en %</span>
              <input
                className="pk-input"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step={1}
                required
                value={otherValue}
                onChange={(event) => setOtherValue(event.target.value)}
              />
            </label>
            <button type="submit" className="pk-btn pk-button-secondary" disabled={pending}>
              Appliquer
            </button>
          </form>
        ) : null}
      </section>

      {error === null ? null : (
        <p className="pk-field-error" role="alert">
          {error}
        </p>
      )}

      {preparation.products.length === 0 ? (
        <p className="nu-section-line">
          Aucun produit sur tes prises : choisis tes produits dans Mes paramètres, PLUKA comptera ce
          qu’il faut préparer.
        </p>
      ) : (
        <>
          <section className="nu-prep-block" aria-labelledby="nu-prep-products">
            <h3 id="nu-prep-products" className="nu-prep-title">
              Ce que tu prépares
            </h3>
            {preparation.orphans > 0 ? (
              <p className="nu-changed" role="status">
                {preparation.orphans === 1
                  ? 'Un point a perdu son drop bag ou son rendez-vous : ses produits sont sans place.'
                  : `${String(preparation.orphans)} points ont perdu leur drop bag ou leur rendez-vous : leurs produits sont sans place.`}
              </p>
            ) : null}
            <ul className="nu-prep-products">
              {preparation.products.map((product) => (
                <li key={product.key} className="nu-prep-product">
                  <span className="nu-prep-name">{product.name}</span>
                  <span className="nu-prep-total">{product.total}</span>
                  <span className="nu-meta">{product.detail}</span>
                  <span className="nu-prep-where">{product.where}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="nu-prep-block" aria-labelledby="nu-prep-points">
            <h3 id="nu-prep-points" className="nu-prep-title">
              Où les trouver
            </h3>
            <ol className="nu-flask-stops">
              <li className="nu-flask-stop">
                <span className="nu-milestone-when">
                  <span className="nu-milestone-clock">{preparation.startClock}</span>
                  <span className="nu-meta">km 0</span>
                </span>
                <div className="nu-flask-body">
                  <span className="nu-milestone-name">{preparation.startName} · sur toi</span>
                  {preparation.start.length === 0 ? (
                    <span className="nu-reason">Rien à emporter</span>
                  ) : (
                    <ul className="nu-prep-items">
                      {preparation.start.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
              {preparation.points.map((point) => (
                <li key={point.pointId} className="nu-flask-stop">
                  <span className="nu-milestone-when">
                    <span className="nu-milestone-clock">{point.clock}</span>
                    <span className="nu-meta">{point.km}</span>
                  </span>
                  <div className="nu-flask-body">
                    <span className="nu-milestone-name">{point.name}</span>
                    <AidInfo line={aidOf.get(point.pointId)} />
                    {point.items.length === 0 ? (
                      <span className="nu-reason">Aucun produit à prendre à partir d’ici</span>
                    ) : (
                      <ul className="nu-prep-items">
                        {point.items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    )}
                    {point.orphan ? (
                      <p className="nu-changed" role="status">
                        {point.source}
                      </p>
                    ) : canEdit && point.options !== null ? null : (
                      <span className="nu-prep-source">{point.source}</span>
                    )}
                    {canEdit && point.options !== null ? (
                      <label className="pk-field nu-prep-choice">
                        <span className="pk-field-label">D’où viennent ces produits</span>
                        <select
                          className="pk-input"
                          value={point.selected}
                          disabled={pending}
                          onChange={(event) =>
                            supply(point.pointId, event.target.value as SupplyValue)
                          }
                        >
                          {point.options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {point.hint === null || !canEdit ? null : (
                      <span className="nu-meta">{point.hint}</span>
                    )}
                    {point.sends.map((line) => (
                      <NutritionSendStatus
                        key={line.rendezvousId}
                        participantRaceId={participantRaceId}
                        line={line}
                        canSend={canEdit}
                      />
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
