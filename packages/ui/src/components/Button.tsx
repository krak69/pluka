import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { classNames } from '../internal/class-names.js';

/**
 * Bouton — 06_DESIGN_SYSTEM.md §24 à §31.
 *
 * `primary` porte le Lichen. §25 impose « un seul CTA Lichen dominant par
 * écran » : cette règle est de composition, le composant ne peut pas la faire
 * respecter — il ne voit qu'un bouton à la fois.
 *
 * `destructive` n'est jamais un CTA primaire de page (§28), et `ghostDark`
 * est le secondaire des bandes Ardoise (§27).
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghostDark' | 'destructive';

const VARIANT_CLASS: Readonly<Record<ButtonVariant, string>> = {
  primary: 'pk-button-primary',
  secondary: 'pk-button-secondary',
  ghostDark: 'pk-button-ghost-dark',
  destructive: 'pk-button-destructive',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly children: ReactNode;
}

export function Button({ variant = 'secondary', className, type, ...rest }: ButtonProps) {
  return (
    <button
      // Un `<button>` sans `type` vaut `submit` : placé dans un formulaire, un
      // bouton d'action secondaire le soumettrait sans que personne l'ait
      // demandé.
      type={type ?? 'button'}
      className={classNames('pk-btn', VARIANT_CLASS[variant], className)}
      {...rest}
    />
  );
}
