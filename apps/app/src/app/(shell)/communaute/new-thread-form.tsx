'use client';

import {
  COMMUNITY_BODY_MAX,
  COMMUNITY_CATEGORIES,
  COMMUNITY_TITLE_MAX,
  type CommunityCategory,
  type CommunityPoint,
} from '@pluka/domain';
import Link from 'next/link';
import { useActionState } from 'react';

import {
  createCommunityThreadAction,
  type CommunityFormState,
} from '@/app/(shell)/communaute/actions';
import { CommunityEditor } from '@/components/community-editor';
import { COMMUNITY_CATEGORY_LABELS } from '@/lib/community-format';
import { formatDistance } from '@/lib/plan-format';

const INITIAL: CommunityFormState = {};

function FieldError({
  id,
  message,
}: {
  readonly id: string;
  readonly message?: string | undefined;
}) {
  if (message === undefined) return null;
  return (
    <p id={id} className="pk-field-error" role="alert">
      {message}
    </p>
  );
}

function PointOption({ point }: { readonly point: CommunityPoint }) {
  return (
    <option value={point.waypointId}>
      {point.name} — km {formatDistance(point.distanceKm)}
    </option>
  );
}

/**
 * Le formulaire d'un nouveau sujet. Une réussite ne revient pas ici : l'action
 * ouvre le sujet publié.
 *
 * Le point se choisit parmi ceux de toutes les courses de l'édition, rangés par
 * course : sans course choisie, la base retient celle du point ; une course qui
 * ne le contient pas est refusée, au champ du point.
 */
export function NewThreadForm({
  editionId,
  races,
  defaultCategory,
  defaultRaceId,
  defaultWaypointId = '',
  cancelHref,
}: {
  readonly editionId: string;
  readonly races: readonly {
    readonly raceId: string;
    readonly name: string;
    readonly points: readonly CommunityPoint[];
  }[];
  readonly defaultCategory: CommunityCategory;
  readonly defaultRaceId: string;
  readonly defaultWaypointId?: string;
  readonly cancelHref: string;
}) {
  const [state, publish, pending] = useActionState(createCommunityThreadAction, INITIAL);
  const errors = state.fieldErrors ?? {};
  const values = state.values ?? {};
  const category = values.category ?? defaultCategory;

  return (
    <form action={publish} className="cm-form">
      <input type="hidden" name="editionId" value={editionId} />

      <fieldset
        className="cm-fieldset"
        aria-describedby={errors.category === undefined ? undefined : 'cm-category-error'}
      >
        <legend className="pk-label">Catégorie</legend>
        <div className="cm-radio-chips">
          {COMMUNITY_CATEGORIES.map((value) => (
            <label key={value} className="cm-radio-chip">
              <input
                type="radio"
                name="category"
                value={value}
                defaultChecked={value === category}
              />
              <span>{COMMUNITY_CATEGORY_LABELS[value]}</span>
            </label>
          ))}
        </div>
        <FieldError id="cm-category-error" message={errors.category} />
      </fieldset>

      {races.length > 1 ? (
        <div className="cm-field">
          <label htmlFor="cm-race" className="pk-label">
            Course concernée
          </label>
          <select
            // Un menu ne relit pas `defaultValue` après le montage : une nouvelle clé
            // le recrée avec la saisie refusée, que la remise à zéro du formulaire garde.
            key={`race-${values.raceId ?? defaultRaceId}`}
            id="cm-race"
            name="raceId"
            className="cm-input"
            defaultValue={values.raceId ?? defaultRaceId}
            aria-describedby={errors.raceId === undefined ? undefined : 'cm-race-error'}
          >
            <option value="">Toute l’édition</option>
            {races.map((race) => (
              <option key={race.raceId} value={race.raceId}>
                {race.name}
              </option>
            ))}
          </select>
          <FieldError id="cm-race-error" message={errors.raceId} />
        </div>
      ) : null}

      {races.some((race) => race.points.length > 0) ? (
        <div className="cm-field">
          <label htmlFor="cm-point" className="pk-label">
            Point du parcours (facultatif)
          </label>
          <select
            key={`point-${values.waypointId ?? defaultWaypointId}`}
            id="cm-point"
            name="waypointId"
            className="cm-input"
            defaultValue={values.waypointId ?? defaultWaypointId}
            aria-invalid={errors.waypointId === undefined ? undefined : true}
            aria-describedby={errors.waypointId === undefined ? undefined : 'cm-point-error'}
          >
            <option value="">Aucun point en particulier</option>
            {races.length === 1
              ? races[0]?.points.map((point) => (
                  <PointOption key={point.waypointId} point={point} />
                ))
              : races
                  .filter((race) => race.points.length > 0)
                  .map((race) => (
                    <optgroup key={race.raceId} label={race.name}>
                      {race.points.map((point) => (
                        <PointOption key={point.waypointId} point={point} />
                      ))}
                    </optgroup>
                  ))}
          </select>
          <FieldError id="cm-point-error" message={errors.waypointId} />
        </div>
      ) : null}

      <div className="cm-field">
        <label htmlFor="cm-title" className="pk-label">
          Ta question
        </label>
        <input
          id="cm-title"
          name="title"
          className="cm-input"
          placeholder={'Ex\u00a0: Bâtons dès le départ\u00a0?'}
          defaultValue={values.title ?? ''}
          required
          minLength={3}
          maxLength={COMMUNITY_TITLE_MAX}
          aria-invalid={errors.title === undefined ? undefined : true}
          aria-describedby={errors.title === undefined ? undefined : 'cm-title-error'}
        />
        <FieldError id="cm-title-error" message={errors.title} />
      </div>

      <CommunityEditor
        name="body"
        label="Détails (facultatif)"
        placeholder="Contexte, ce que tu as déjà vérifié…"
        maxLength={COMMUNITY_BODY_MAX}
        error={errors.body}
        defaultValue={values.body}
      />

      {state.error === undefined ? null : (
        <p className="pk-field-error" role="alert">
          {state.error}
        </p>
      )}

      <div className="cm-form-actions">
        <Link href={cancelHref} className="pk-btn pk-button-secondary">
          Annuler
        </Link>
        <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
          {pending ? 'Publication…' : 'Publier'}
        </button>
      </div>
    </form>
  );
}
