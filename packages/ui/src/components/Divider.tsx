import type { HTMLAttributes } from 'react';

import { classNames } from '../internal/class-names.js';

/**
 * Filet — 06_DESIGN_SYSTEM.md §19, §38.
 *
 * « Les filets font partie de l'identité fonctionnelle de PLUKA. » Une liste
 * d'actions se sépare par un filet, pas par une card par ligne.
 *
 * Rendu en `<hr>` : la séparation est structurelle, un `<div>` décoratif ne
 * la porterait que visuellement.
 */
export interface DividerProps extends HTMLAttributes<HTMLHRElement> {
  readonly spaced?: boolean;
}

export function Divider({ spaced = false, className, ...rest }: DividerProps) {
  return (
    <hr className={classNames('pk-divider', spaced && 'pk-divider-spaced', className)} {...rest} />
  );
}
