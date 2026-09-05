import type { HTMLAttributes, ReactNode } from 'react';

import { classNames } from '../internal/class-names.js';

/**
 * Micro-label — 06_DESIGN_SYSTEM.md §14, §15.
 *
 * Martian Mono, capitales, interlettrage large. C'est le seul endroit du
 * Design System où les capitales sont admises : « la hiérarchie se fait par
 * la taille et l'espace, jamais par les capitales forcées » (§15).
 *
 * Les capitales viennent du CSS (`text-transform`), pas du texte saisi : un
 * lecteur d'écran reçoit ainsi « Prochaine étape » et non « P.R.O.C.H.A.I.N.E ».
 */
export interface MicroLabelProps extends HTMLAttributes<HTMLSpanElement> {
  readonly children: ReactNode;
}

export function MicroLabel({ className, ...rest }: MicroLabelProps) {
  return <span className={classNames('pk-label', className)} {...rest} />;
}
