'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';

import {
  setReserveAction,
  setSupplyPointAction,
} from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-actions';
import { AidInfo } from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-aid';
import { NutritionSendStatus } from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-send';
import { usePlanBoard } from '@/app/(shell)/courses/[participantRaceId]/plan/plan-board';
import { Icon } from '@/components/icon';
import type {
  AidLine,
  PreparationLines,
  PreparationPointLine,
  SupplyValue,
} from '@/lib/nutrition-format';

const RESERVES = [0, 10, 20] as const;

/**
 * À préparer pour cette course — §49 à §56 ; prototype `nutPrep`, un tiroir
 * calé à droite du Plan (une feuille sur mobile).
 *
 * Combien de chaque produit, la réserve en plus, et où chacun t'attend : sur
 * toi au départ, dans un drop bag, chez ton Assistance. La répartition se
 * déduit du Plan ; le coureur choisit seulement d'où viennent les produits
 * d'un point quand il a le choix.
 */
export function PreparationDrawer({
  participantRaceId,
  preparation,
  aid,
  canEdit,
}: {
  readonly participantRaceId: string;
  readonly preparation: PreparationLines;
  readonly aid: readonly AidLine[];
  readonly canEdit: boolean;
}) {
  const board = usePlanBoard();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const aidOf = new Map(aid.map((line) => [line.pointId, line]));

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (board.preparationOpen && !element.open) {
      element.showModal();
      // Le focus va au titre : le tiroir s'annonce par son nom.
      document.getElementById(titleId)?.focus();
    }
    if (!board.preparationOpen && element.open) element.close();
  }, [board.preparationOpen, titleId]);

  return (
    <dialog
      ref={dialog}
      className="nu-drawer"
      aria-labelledby={titleId}
      onClose={() => board.setPreparationOpen(false)}
      onClick={(event) => {
        // Un clic hors du tiroir — sur le voile — le referme, comme au prototype.
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      <div className="nu-drawer-inner">
        <header className="nu-drawer-head">
          <div className="nu-drawer-heading">
            <h2 id={titleId} className="nu-drawer-title" tabIndex={-1}>
              À préparer pour cette course
            </h2>
            <p className="nu-meta">{preparation.summary}</p>
          </div>
          <button
            type="button"
            className="pk-btn pk-button-ghost nu-drawer-close"
            aria-label="Fermer"
            onClick={() => dialog.current?.close()}
          >
            <Icon name="X" size={18} />
          </button>
        </header>
        <div className="nu-drawer-scroll">
          <PreparationContent
            participantRaceId={participantRaceId}
            preparation={preparation}
            aidOf={aidOf}
            canEdit={canEdit}
          />
        </div>
      </div>
    </dialog>
  );
}

/** Ce qui t'attend à un point : ton drop bag, ton Assistance, ou ce que tu portes. */
function PlaceTag({ point }: { readonly point: PreparationPointLine }) {
  if (point.orphan) return null;
  if (point.destination === 'bag') {
    return (
      <span className="pl-tag">
        <Icon name="Backpack" size={13} />
        {point.bagName ?? 'Ton drop bag'}
      </span>
    );
  }
  if (point.destination === 'assistance') {
    return (
      <span className="pl-tag pl-tag-assist">
        <Icon name="User" size={13} />
        {point.assistants.join(' et ')}
      </span>
    );
  }
  return <span className="pl-tag">Porté depuis le départ</span>;
}

export function PreparationContent({
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
  // Un point sans produit n'a rien à préparer : il ne s'affiche que s'il a perdu sa place ou une liste.
  const places = preparation.points.filter(
    (point) => point.items.length > 0 || point.orphan || point.sends.length > 0,
  );

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
      <section className="nu-prep-block nu-prep-card" aria-labelledby="nu-prep-reserve">
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
                  <span className="nu-prep-product-text">
                    <span className="nu-prep-name">{product.name}</span>
                    <span className="nu-meta">{product.detail}</span>
                    <span className="nu-prep-where">{product.where}</span>
                  </span>
                  <span className="nu-prep-total">{product.total}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="nu-prep-block" aria-labelledby="nu-prep-points">
            <h3 id="nu-prep-points" className="nu-prep-title">
              Où les trouver
            </h3>
            <p className="nu-meta">Répartition dérivée de ton plan, point par point.</p>
            <ol className="nu-spots">
              <li className="nu-spot">
                <span className="nu-spot-head">
                  <span className="nu-spot-name">{preparation.startName} · sur toi</span>
                  <span className="nu-spot-when">{preparation.startClock} · km 0</span>
                </span>
                {preparation.start.length === 0 ? (
                  <span className="nu-reason">Rien à emporter</span>
                ) : (
                  <ul className="nu-spot-items">
                    {preparation.start.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </li>
              {places.map((point) => (
                <li key={point.pointId} className="nu-spot">
                  <span className="nu-spot-head">
                    <span className="nu-spot-name">{point.name}</span>
                    <span className="nu-spot-when">
                      {point.clock} · {point.km}
                    </span>
                  </span>
                  <PlaceTag point={point} />
                  <AidInfo line={aidOf.get(point.pointId)} />
                  {point.items.length === 0 ? (
                    <span className="nu-reason">Aucun produit à prendre à partir d’ici</span>
                  ) : (
                    <ul className="nu-spot-items">
                      {point.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  )}
                  {point.orphan ? (
                    <p className="nu-changed" role="status">
                      {point.source}
                    </p>
                  ) : null}
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
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
