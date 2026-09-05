import type { InputHTMLAttributes } from 'react';

import { classNames } from '../internal/class-names.js';

/**
 * Champ texte — 06_DESIGN_SYSTEM.md §33 à §35, §106.
 *
 * Champ à filet, pas capsule. Le `label` est obligatoire et lié par `id` :
 * un placeholder n'est pas un label — il disparaît dès la saisie.
 *
 * §35 : « ne pas utiliser une bordure rouge seule ». L'erreur est donc un
 * texte, rattaché au champ par `aria-describedby` et signalé par
 * `aria-invalid` ; la couleur du filet ne fait que la doubler.
 *
 * `hint` et `error` partagent la même mécanique de description. Quand les
 * deux sont présents, les deux identifiants sont listés — l'utilisateur
 * entend l'aide *et* l'erreur, pas seulement la dernière.
 */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
}

export function Input({ id, label, hint, error, className, ...rest }: InputProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId]
    .filter((value): value is string => value !== null)
    .join(' ');

  return (
    <div className="pk-field">
      <label className="pk-field-label" htmlFor={id}>
        {label}
      </label>

      <input
        id={id}
        className={classNames('pk-input', error !== undefined && 'pk-input-invalid', className)}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        {...rest}
      />

      {hint === undefined ? null : (
        <p id={hintId} className="pk-field-hint">
          {hint}
        </p>
      )}

      {error === undefined ? null : (
        <p id={errorId} className="pk-field-error">
          {error}
        </p>
      )}
    </div>
  );
}
