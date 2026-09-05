import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { classNames } from '../internal/class-names.js';

/**
 * Bouton d'icône — 06_DESIGN_SYSTEM.md §29, §39 à §41.
 *
 * `label` est obligatoire et n'est pas décoratif : une icône seule ne dit
 * rien à un lecteur d'écran (§105). Il devient `aria-label`, et l'icône passe
 * en `aria-hidden` pour ne pas être annoncée deux fois.
 *
 * La cible fait 44 × 44 px au minimum (§29), quelle que soit la taille du
 * tracé — une icône de 20 px ne réduit pas la zone cliquable.
 */
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  readonly label: string;
  readonly children: ReactNode;
}

export function IconButton({ label, className, type, children, ...rest }: IconButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      aria-label={label}
      className={classNames('pk-icon-button', className)}
      {...rest}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}
