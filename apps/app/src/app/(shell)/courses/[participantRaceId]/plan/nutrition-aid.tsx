'use client';

import { AID_KIND_LABELS, ANNOUNCED_AID_KINDS } from '@pluka/domain';
import { useState, useTransition } from 'react';

import {
  setAidDrinkAction,
  setAidNoteAction,
} from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-actions';
import type { AidLine } from '@/lib/nutrition-format';

/**
 * Ce que propose un ravitaillement, dans la Nutrition — §31, §32 (0110).
 * Annoncé par l'organisation, sinon « non communiqué » ; la note du coureur
 * reste la sienne. La boisson d'effort du ravito peut remplacer la sienne à ce
 * point : ni dose à préparer, ni dose à emporter.
 */

export function AidInfo({ line }: { readonly line: AidLine | undefined }) {
  if (line === undefined) return null;
  return (
    <span className="nu-aid">
      <span className={line.announced ? 'nu-aid-content' : 'nu-aid-content nu-aid-unknown'}>
        {line.content}
      </span>
      {line.note === null ? null : <span className="nu-aid-note">{line.note}</span>}
    </span>
  );
}

/**
 * « Je prends la boisson du ravito ici » — dans Mes flasques, et sur la ligne
 * du ravito dans Ma stratégie, où le coureur le cherchera d'abord. Depuis Ma
 * stratégie, un lien mène à Mes flasques pour en voir l'effet.
 */
export function AidDrinkChoice({
  participantRaceId,
  line,
  hasDrink,
  canEdit,
  onShowFlasks,
}: {
  readonly participantRaceId: string;
  readonly line: AidLine | undefined;
  readonly hasDrink: boolean;
  readonly canEdit: boolean;
  readonly onShowFlasks?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (line === undefined || line.drink === null || !hasDrink) return null;
  const chosen = line.drink.chosen;

  return (
    <div className="nu-aid-drink">
      <span className="nu-meta">
        {chosen
          ? 'Tu prends la boisson d’effort du ravito : pas de dose à préparer pour ce remplissage. Les apports sont comptés avec les valeurs de ta boisson.'
          : line.drink.fromNote
            ? 'D’après ta note, une boisson d’effort est servie ici : tu peux la prendre plutôt que de préparer la tienne.'
            : 'Une boisson d’effort est servie ici : tu peux la prendre plutôt que de préparer la tienne.'}
      </span>
      <span className="nu-aid-drink-actions">
        {canEdit ? (
          <button
            type="button"
            className="pk-btn pk-button-ghost nu-flask-toggle"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const outcome = await setAidDrinkAction(participantRaceId, line.pointId, !chosen);
                setError(outcome.error ?? null);
              })
            }
          >
            {chosen ? 'Je prépare ma boisson ici' : 'Je prends la boisson du ravito ici'}
          </button>
        ) : null}
        {onShowFlasks === undefined ? null : (
          <button
            type="button"
            className="pk-btn pk-button-ghost nu-flask-toggle"
            onClick={onShowFlasks}
          >
            Voir mes flasques
          </button>
        )}
      </span>
      {error === null ? null : (
        <p className="pk-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function AidControls({
  participantRaceId,
  line,
  hasDrink,
  canEdit,
}: {
  readonly participantRaceId: string;
  readonly line: AidLine | undefined;
  readonly hasDrink: boolean;
  readonly canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [kinds, setKinds] = useState<readonly string[]>(line?.noteKinds ?? []);
  const [text, setText] = useState(line?.noteText ?? '');
  if (line === undefined || !canEdit) return null;
  // Rien à régler ici : pas de boisson à prendre, et un contenu annoncé.
  if ((line.drink === null || !hasDrink) && line.announced) return null;

  const run = (task: () => Promise<{ readonly error?: string }>, after?: () => void) =>
    startTransition(async () => {
      const outcome = await task();
      setError(outcome.error ?? null);
      if (outcome.error === undefined) after?.();
    });

  return (
    <div className="nu-aid-controls">
      <AidDrinkChoice
        participantRaceId={participantRaceId}
        line={line}
        hasDrink={hasDrink}
        canEdit={canEdit}
      />

      {line.announced ? null : editing ? (
        <form
          className="nu-aid-form"
          onSubmit={(event) => {
            event.preventDefault();
            run(
              () => setAidNoteAction(participantRaceId, line.pointId, kinds, text),
              () => setEditing(false),
            );
          }}
        >
          <fieldset className="nu-fieldset">
            <legend className="pk-field-label">Ce que tu y trouveras, d’après toi</legend>
            <div className="nu-chips">
              {ANNOUNCED_AID_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className="nu-chip"
                  aria-pressed={kinds.includes(kind)}
                  onClick={() =>
                    setKinds((current) =>
                      current.includes(kind)
                        ? current.filter((entry) => entry !== kind)
                        : [...current, kind],
                    )
                  }
                >
                  {AID_KIND_LABELS[kind]}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="pk-field">
            <span className="pk-field-label">Précision (facultatif)</span>
            <input
              className="pk-input"
              maxLength={200}
              value={text}
              placeholder="D’après l’édition 2025…"
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <div className="nu-aid-actions">
            <button type="submit" className="pk-btn pk-button-secondary" disabled={pending}>
              {pending ? 'Enregistrement…' : 'Garder ma note'}
            </button>
            <button
              type="button"
              className="pk-btn pk-button-ghost"
              disabled={pending}
              onClick={() => setEditing(false)}
            >
              Annuler
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="pk-btn pk-button-ghost nu-flask-toggle"
          onClick={() => setEditing(true)}
        >
          {line.note === null ? 'Noter ce que j’y trouverai' : 'Modifier ma note'}
        </button>
      )}

      {error === null ? null : (
        <p className="pk-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
