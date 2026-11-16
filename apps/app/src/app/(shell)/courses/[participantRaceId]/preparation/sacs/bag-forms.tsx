'use client';

import type { BagPoint } from '@pluka/domain';
import { useActionState, useEffect, useId, useRef, useState } from 'react';

import {
  addBagItemAction,
  createBagAction,
  renameBagAction,
  type BagActionState,
} from '@/app/(shell)/courses/[participantRaceId]/preparation/sacs/actions';

const INITIAL: BagActionState = {};

function km(value: number): string {
  return `km ${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)}`;
}

function ErrorLine({ id, state }: { readonly id: string; readonly state: BagActionState }) {
  return state.error === undefined ? null : (
    <p id={id} className="pk-field-error bg-form-error" role="alert">
      {state.error}
    </p>
  );
}

/** « Ajouter un élément au sac… » — prototype, avec sa quantité. */
export function AddBagItemForm({
  participantRaceId,
  bagId,
  bagName,
}: {
  readonly participantRaceId: string;
  readonly bagId: string;
  readonly bagName: string;
}) {
  const [state, add, pending] = useActionState(addBagItemAction, INITIAL);
  const form = useRef<HTMLFormElement>(null);
  const id = useId();

  // Un élément ajouté vide le champ ; un refus le laisse tel quel, à corriger.
  useEffect(() => {
    if (!pending && state.error === undefined) form.current?.reset();
  }, [pending, state]);

  return (
    <form ref={form} action={add} className="bg-add">
      <input type="hidden" name="participantRaceId" value={participantRaceId} />
      <input type="hidden" name="bagId" value={bagId} />
      <label htmlFor={`${id}-label`} className="pk-visually-hidden">
        Ajouter un élément à {bagName}
      </label>
      <input
        id={`${id}-label`}
        name="label"
        className="eq-add-input"
        placeholder="Ajouter un élément au sac…"
        maxLength={120}
        required
        autoComplete="off"
        aria-describedby={state.error === undefined ? undefined : `${id}-error`}
      />
      <label htmlFor={`${id}-qty`} className="pk-visually-hidden">
        Quantité
      </label>
      <input
        id={`${id}-qty`}
        name="quantity"
        type="number"
        min={1}
        max={99}
        defaultValue={1}
        inputMode="numeric"
        className="eq-add-input bg-qty"
      />
      <button type="submit" className="pk-btn pk-button-secondary bg-add-button" disabled={pending}>
        + Ajouter
      </button>
      <ErrorLine id={`${id}-error`} state={state} />
    </form>
  );
}

/** Renommer un sac, dans le volet « Modifier ». */
export function RenameBagForm({
  participantRaceId,
  bagId,
  name,
}: {
  readonly participantRaceId: string;
  readonly bagId: string;
  readonly name: string;
}) {
  const [state, rename, pending] = useActionState(renameBagAction, INITIAL);
  const id = useId();

  return (
    <form action={rename} className="bg-add">
      <input type="hidden" name="participantRaceId" value={participantRaceId} />
      <input type="hidden" name="bagId" value={bagId} />
      <label htmlFor={`${id}-name`} className="pk-visually-hidden">
        Nom du sac
      </label>
      <input
        id={`${id}-name`}
        name="name"
        className="eq-add-input"
        defaultValue={name}
        maxLength={80}
        required
        autoComplete="off"
      />
      <button type="submit" className="pk-btn pk-button-secondary bg-add-button" disabled={pending}>
        Renommer
      </button>
      <ErrorLine id={`${id}-error`} state={state} />
    </form>
  );
}

const TYPE_OPTIONS = [
  { value: 'start', label: 'Sac de départ' },
  { value: 'drop_bag', label: 'Drop bag' },
  { value: 'assistance', label: 'Sac d’assistance' },
  { value: 'finish', label: 'Sac d’arrivée' },
  { value: 'other', label: 'Autre sac' },
] as const;

/**
 * Un sac ajouté à la main, quand les suggestions ne suffisent pas.
 *
 * Un drop bag ne propose que les points où l'organisation l'accepte, un sac
 * d'assistance que les points d'assistance (décision produit du 2026-11-16) :
 * sans point possible, le rôle n'est pas proposé.
 */
export function NewBagForm({
  participantRaceId,
  dropBagPoints,
  assistancePoints,
}: {
  readonly participantRaceId: string;
  readonly dropBagPoints: readonly BagPoint[];
  readonly assistancePoints: readonly BagPoint[];
}) {
  const [state, create, pending] = useActionState(createBagAction, INITIAL);
  const [bagType, setBagType] = useState<string>('other');
  const id = useId();

  const options = TYPE_OPTIONS.filter(
    (option) =>
      (option.value !== 'drop_bag' || dropBagPoints.length > 0) &&
      (option.value !== 'assistance' || assistancePoints.length > 0),
  );
  const points =
    bagType === 'drop_bag' ? dropBagPoints : bagType === 'assistance' ? assistancePoints : [];

  return (
    <form action={create} className="bg-new">
      <input type="hidden" name="participantRaceId" value={participantRaceId} />
      <div className="pk-field">
        <label className="pk-field-label" htmlFor={`${id}-type`}>
          Sac
        </label>
        <select
          id={`${id}-type`}
          name="bagType"
          className="pk-input"
          value={bagType}
          onChange={(event) => setBagType(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {points.length === 0 ? null : (
        <div className="pk-field">
          <label className="pk-field-label" htmlFor={`${id}-point`}>
            Point
          </label>
          <select id={`${id}-point`} name="pointId" className="pk-input">
            {points.map((point) => (
              <option key={point.id} value={point.id}>
                {point.name} · {km(point.distanceKm)}
              </option>
            ))}
          </select>
        </div>
      )}
      {bagType === 'other' ? (
        <div className="pk-field">
          <label className="pk-field-label" htmlFor={`${id}-name`}>
            Nom
          </label>
          <input
            id={`${id}-name`}
            name="name"
            className="pk-input"
            placeholder="Sac voiture, sac de nuit…"
            maxLength={80}
            autoComplete="off"
          />
        </div>
      ) : null}
      <button type="submit" className="pk-btn pk-button-secondary bg-add-button" disabled={pending}>
        + Ajouter ce sac
      </button>
      <ErrorLine id={`${id}-error`} state={state} />
    </form>
  );
}
