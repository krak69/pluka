'use client';

import { Button } from '@pluka/ui';
import { useActionState, useId } from 'react';

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
 * 3. **Un geste destructeur se confirme à l'écran** par une case explicite,
 *    pas par `window.confirm` : la case est lisible, focalisable, et le
 *    domaine la revérifie — une requête forgée sans elle est refusée.
 *
 * Le refus de confirmation est posé sous la case, pas sous le bouton : c'est
 * elle qu'il faut corriger.
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
  /** Phrase de la case de confirmation. Absente : le geste n'en demande pas. */
  readonly confirm?: string;
}) {
  const [state, submit, pending] = useActionState(action, INITIAL);
  const id = useId();

  const confirmError = state.fieldErrors?.['confirmed'];
  // Un refus de confirmation est déjà dit sous la case : le répéter sous le
  // bouton, préfixé de « Les informations saisies sont invalides », brouille
  // ce qu'il faut faire.
  const error = confirmError === undefined ? state.error : undefined;

  return (
    <form action={submit} className="ad-action">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      {confirm === undefined ? null : (
        <>
          <label className="ad-confirm" htmlFor={`${id}-confirm`}>
            <input
              id={`${id}-confirm`}
              type="checkbox"
              name="confirmed"
              aria-invalid={confirmError === undefined ? undefined : true}
              aria-describedby={confirmError === undefined ? undefined : `${id}-confirm-error`}
            />
            <span>{confirm}</span>
          </label>

          {confirmError === undefined ? null : (
            <p id={`${id}-confirm-error`} className="pk-field-error" role="alert">
              {confirmError}
            </p>
          )}
        </>
      )}

      <Button type="submit" variant={variant} disabled={pending} aria-busy={pending}>
        {label}
      </Button>

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
