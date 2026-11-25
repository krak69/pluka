'use client';

import { useState, useTransition } from 'react';

import {
  applyNutritionAction,
  placeOrphanAction,
  resetMilestoneAction,
} from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-actions';
import type { OrphanLine, PlaceTarget, ReviewView } from '@/lib/nutrition-format';

/**
 * Le Plan a changé — NUTRITION_ENGINE §61 à §66, N25 à N28 ; décisions du
 * 2026-11-23. Le coureur voit ce qui change pour les prises qu'il a modifiées,
 * puis valide. Une prise qui n'a plus de place garde ses produits jusqu'à ce
 * qu'il les place ou les rende à PLUKA : rien ne disparaît sans lui.
 */

export function NutritionReview({
  participantRaceId,
  review,
}: {
  readonly participantRaceId: string;
  readonly review: ReviewView;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const apply = () =>
    startTransition(async () => {
      const outcome = await applyNutritionAction(participantRaceId);
      setError(outcome.error ?? null);
    });

  return (
    <section className="nu-review" aria-labelledby="nu-review-title">
      <h3 id="nu-review-title" className="nu-review-title">
        Ton Plan a changé : vérifie ta Nutrition
      </h3>
      <p className="nu-review-text">
        Tes objectifs, tes produits, tes flasques, ta réserve et tes sacs restent les mêmes. Tes
        prises sont recalculées sur le nouveau Plan, et tu peux les voir dessous. Valide pour
        pouvoir de nouveau modifier ta Nutrition.
      </p>

      {review.kept.length === 0 ? null : (
        <div className="nu-review-group">
          <h4 className="pk-label">Les prises que tu as modifiées</h4>
          <ul className="nu-review-list">
            {review.kept.map((line) => (
              <li key={line.key} className="nu-review-line">
                <span className="nu-review-where">
                  {line.where}
                  {line.shifted ? <span className="nu-review-tag">Heure changée</span> : null}
                </span>
                <span className="nu-meta">{line.items}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {review.orphaned.length === 0 ? null : (
        <div className="nu-review-group">
          <h4 className="pk-label">
            {review.orphaned.length === 1
              ? 'Une prise n’a plus de place'
              : `${String(review.orphaned.length)} prises n’ont plus de place`}
          </h4>
          <ul className="nu-review-list">
            {review.orphaned.map((line) => (
              <li key={line.key} className="nu-review-line">
                <span className="nu-review-where">
                  {line.where}
                  <span className="nu-review-tag nu-review-tag-orphan">À replacer</span>
                </span>
                <span className="nu-meta">{line.items}</span>
              </li>
            ))}
          </ul>
          <p className="nu-review-text">
            Ces produits sont gardés. Après validation, tu les places sur une autre prise, ou tu les
            rends à PLUKA.
          </p>
        </div>
      )}

      {error === null ? null : (
        <p className="pk-field-error" role="alert">
          {error}
        </p>
      )}
      {review.canApply ? (
        <button
          type="button"
          className="pk-btn pk-button-primary nu-send-button"
          disabled={pending}
          onClick={apply}
        >
          {pending ? 'Validation…' : 'Appliquer au nouveau Plan'}
        </button>
      ) : (
        <p className="nu-meta">Valider ta stratégie demande le Race Pass.</p>
      )}
    </section>
  );
}

/** Une prise à replacer : la poser sur une prise du Plan actif, ou la rendre à PLUKA. */
function OrphanRow({
  participantRaceId,
  line,
  targets,
  canEdit,
}: {
  readonly participantRaceId: string;
  readonly line: OrphanLine;
  readonly targets: readonly PlaceTarget[];
  readonly canEdit: boolean;
}) {
  const [target, setTarget] = useState(line.nearest ?? targets[0]?.key ?? '');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const selectId = `nu-orphan-${line.key.replace(/[^A-Za-z0-9-]/g, '-')}`;

  const place = () =>
    startTransition(async () => {
      const outcome = await placeOrphanAction(participantRaceId, line.key, target);
      setError(outcome.error ?? null);
    });

  const giveBack = () =>
    startTransition(async () => {
      const outcome = await resetMilestoneAction(participantRaceId, line.key);
      setError(outcome.error ?? null);
    });

  return (
    <li className="nu-orphan">
      <span className="nu-review-where">{line.where}</span>
      <span className="nu-meta">{line.items}</span>
      {line.onlyReturn === null ? null : <span className="nu-meta">{line.onlyReturn}</span>}
      {canEdit ? (
        <div className="nu-orphan-actions">
          {line.onlyReturn === null && targets.length > 0 ? (
            <>
              <label htmlFor={selectId} className="pk-label">
                Placer à la prise
              </label>
              <select
                id={selectId}
                className="pk-input nu-orphan-select"
                value={target}
                disabled={pending}
                onChange={(event) => setTarget(event.target.value)}
              >
                {targets.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="pk-btn pk-button-secondary nu-send-button"
                disabled={pending || target === ''}
                onClick={place}
              >
                {pending ? 'Enregistrement…' : 'Placer ici'}
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="pk-btn pk-button-ghost nu-send-button"
            disabled={pending}
            onClick={giveBack}
          >
            Rendre à PLUKA
          </button>
        </div>
      ) : null}
      {error === null ? null : (
        <p className="pk-field-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

export function OrphanPanel({
  participantRaceId,
  lines,
  targets,
  canEdit,
}: {
  readonly participantRaceId: string;
  readonly lines: readonly OrphanLine[];
  readonly targets: readonly PlaceTarget[];
  readonly canEdit: boolean;
}) {
  if (lines.length === 0) return null;
  return (
    <section className="nu-review nu-orphans" aria-labelledby="nu-orphans-title">
      <h3 id="nu-orphans-title" className="nu-review-title">
        {lines.length === 1 ? 'Une prise à replacer' : `${String(lines.length)} prises à replacer`}
      </h3>
      <p className="nu-review-text">
        Avec ton nouveau Plan, ces prises n’ont plus de place. Leurs produits sont gardés :
        place-les sur une prise, ou rends-les à PLUKA, qui répartira de nouveau tes produits.
      </p>
      <ul className="nu-review-list">
        {lines.map((line) => (
          <OrphanRow
            key={line.key}
            participantRaceId={participantRaceId}
            line={line}
            targets={targets}
            canEdit={canEdit}
          />
        ))}
      </ul>
    </section>
  );
}
