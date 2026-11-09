'use client';

import { Button } from '@pluka/ui';
import { useActionState, useState } from 'react';

import type { ActionState } from '@/app/actions';

const INITIAL: ActionState = {};

/**
 * Un geste de la console d'administration — lot 4b.
 *
 * Trois règles, qui sont la raison d'être de ce composant :
 *
 * 1. **Le bouton est toujours là.** Un administrateur dont le droit a été
 *    retiré en cours de session voit le refus de la base, pas un écran où le
 *    geste a disparu sans explication.
 * 2. **Le refus s'affiche à côté du bouton** (`role="alert"`), dans le
 *    formulaire qui l'a provoqué — jamais en tête d'écran, où il ne dirait
 *    pas quel geste a échoué.
 * 3. **Un geste destructeur se confirme en deux temps** : le bouton, puis
 *    une phrase qui dit ce qui va se passer et « Confirmer », avec
 *    « Annuler » à côté. Pas de `window.confirm`, et plus de case à cocher
 *    (décision produit du 2026-11-09). Le domaine revérifie `confirmed` : une
 *    requête forgée sans lui est refusée.
 */
export function ConsoleAction({
  action,
  fields,
  label,
  variant = 'secondary',
  confirm,
}: {
  readonly action: (previous: ActionState, form: FormData) => Promise<ActionState>;
  /** Champs cachés transmis tels quels — l'identifiant visé, l'onglet d'origine. */
  readonly fields: Readonly<Record<string, string>>;
  readonly label: string;
  readonly variant?: 'primary' | 'secondary' | 'destructive';
  /** Ce que le geste va faire, dit avant « Confirmer ». Absent : le geste n'en demande pas. */
  readonly confirm?: string;
}) {
  const [state, submit, pending] = useActionState(action, INITIAL);
  const [confirming, setConfirming] = useState(false);
  const error = state.fieldErrors?.['confirmed'] ?? state.error;

  return (
    <form action={submit} className="ad-action">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {/* Le bouton d'envoi n'existe qu'après le premier clic : la confirmation est ce geste. */}
      {confirm === undefined ? null : <input type="hidden" name="confirmed" value="on" />}

      {confirm === undefined ? (
        <Button type="submit" variant={variant} disabled={pending} aria-busy={pending}>
          {label}
        </Button>
      ) : !confirming ? (
        <Button type="button" variant={variant} onClick={() => setConfirming(true)}>
          {label}
        </Button>
      ) : (
        <div className="ad-confirm-step" role="group" aria-label={label}>
          <p className="pk-body">{confirm}</p>
          <div className="ad-confirm-actions">
            <Button type="submit" variant={variant} disabled={pending} aria-busy={pending}>
              Confirmer
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              Annuler
            </Button>
          </div>
        </div>
      )}

      {error === undefined ? null : (
        <p className="pk-field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * Compte rendu d'un geste réussi, en tête d'écran.
 *
 * `role="status"` : il s'annonce sans voler le focus. La phrase vient de
 * `consoleNotice`, jamais de l'URL.
 */
export function ConsoleNotice({ notice }: { readonly notice: string | null }) {
  if (notice === null) return null;

  return (
    <p className="pk-body ad-done" role="status">
      {notice}
    </p>
  );
}
