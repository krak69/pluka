'use client';

import {
  COMMUNITY_BODY_MAX,
  COMMUNITY_CATEGORIES,
  COMMUNITY_TITLE_MAX,
  type CommunityCategory,
} from '@pluka/domain';
import Link from 'next/link';
import { useActionState } from 'react';

import {
  createCommunityThreadAction,
  type CommunityFormState,
} from '@/app/(shell)/communaute/actions';
import { CommunityEditor } from '@/components/community-editor';
import { COMMUNITY_CATEGORY_LABELS } from '@/lib/community-format';

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

/**
 * Le formulaire d'un nouveau sujet. Une réussite ne revient pas ici : l'action
 * ouvre le sujet publié.
 */
export function NewThreadForm({
  editionId,
  races,
  defaultCategory,
  defaultRaceId,
  cancelHref,
}: {
  readonly editionId: string;
  readonly races: readonly { readonly raceId: string; readonly name: string }[];
  readonly defaultCategory: CommunityCategory;
  readonly defaultRaceId: string;
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

      <div className="cm-field">
        <label htmlFor="cm-title" className="pk-label">
          Ta question
        </label>
        <input
          id="cm-title"
          name="title"
          className="cm-input"
          placeholder="Ex : Bâtons dès le départ ?"
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
