import type { HTMLAttributes, ReactNode } from 'react';

import { classNames } from '../internal/class-names.js';

/**
 * Badge — 06_DESIGN_SYSTEM.md §36, §37.
 *
 * Rayon faible, pas de capsule, et pas vingt badges par page (§37).
 *
 * `deadline` porte l'Aube — prochaine échéance, jamais une erreur (§7.2) —
 * et `active` le Lichen d'un état actif sur fond sombre (§36.4).
 *
 * `children` est requis : un badge sans texte n'existe pas dans ce Design
 * System, la couleur ne portant jamais seule le sens (§103).
 */
export type BadgeTone =
  'neutral' | 'deadline' | 'active' | 'glacier' | 'success' | 'warning' | 'error';

const TONE_CLASS: Readonly<Record<BadgeTone, string>> = {
  neutral: 'pk-badge-neutral',
  deadline: 'pk-badge-deadline',
  active: 'pk-badge-active',
  glacier: 'pk-badge-glacier',
  success: 'pk-badge-success',
  warning: 'pk-badge-warning',
  error: 'pk-badge-error',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: BadgeTone;
  readonly children: ReactNode;
}

export function Badge({ tone = 'neutral', className, ...rest }: BadgeProps) {
  return <span className={classNames('pk-badge', TONE_CLASS[tone], className)} {...rest} />;
}
