import type { ReactNode } from 'react';

import { classNames } from '../internal/class-names.js';
import { Badge, type BadgeTone } from './Badge.js';

/**
 * État — 06_DESIGN_SYSTEM.md §185, §103.
 *
 * « Doit combiner texte + icône optionnelle + couleur sémantique. Ne jamais
 * retourner uniquement un rond vert. »
 *
 * D'où la forme du composant : `children` est requis, et la pastille de
 * couleur est marquée `aria-hidden` — elle double le texte pour l'œil, elle
 * ne le remplace pour personne.
 */
export type StatusTone = 'success' | 'warning' | 'error' | 'neutral';

const STATUS_BADGE_TONE: Readonly<Record<StatusTone, BadgeTone>> = {
  success: 'success',
  warning: 'warning',
  error: 'error',
  neutral: 'neutral',
};

const DOT_COLOR: Readonly<Record<StatusTone, string>> = {
  success: 'var(--pk-success-signal)',
  warning: 'var(--pk-warning-signal)',
  error: 'var(--pk-error-signal)',
  neutral: 'var(--pk-granite)',
};

export interface StatusBadgeProps {
  readonly tone: StatusTone;
  /** Icône facultative. Décorative : le sens reste dans le texte. */
  readonly icon?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

export function StatusBadge({ tone, icon, children, className }: StatusBadgeProps) {
  return (
    <Badge tone={STATUS_BADGE_TONE[tone]} className={classNames(className)}>
      {icon === undefined ? (
        <span aria-hidden="true" className="pk-badge-dot" style={{ background: DOT_COLOR[tone] }} />
      ) : (
        <span aria-hidden="true">{icon}</span>
      )}
      {children}
    </Badge>
  );
}
