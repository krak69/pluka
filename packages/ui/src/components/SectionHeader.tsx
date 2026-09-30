import type { HTMLAttributes, ReactNode } from 'react';

import { classNames } from '../internal/class-names.js';

/**
 * En-tête de section ou de page — 06_DESIGN_SYSTEM.md §110 (`SectionHeader`),
 * §69 (« page header contextualisé »).
 *
 * `eyebrow` est un micro-label — le seul endroit où les capitales sont admises
 * (§15). `title` porte la hiérarchie par la taille et l'espace, pas par la
 * casse.
 *
 * `aside` reçoit ce qui appartient au titre sans en faire partie : un compte à
 * rebours, un badge de confiance, une action de page.
 */
export interface SectionHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  readonly eyebrow?: string;
  readonly title: string;
  /** Contenu aligné à droite du titre. */
  readonly aside?: ReactNode;
  /** `h1` pour un titre de page, `h2` pour une section interne. */
  readonly level?: 1 | 2;
}

export function SectionHeader({
  eyebrow,
  title,
  aside,
  level = 1,
  className,
  ...rest
}: SectionHeaderProps) {
  const Heading = level === 1 ? 'h1' : 'h2';

  return (
    <header className={classNames('pk-section-header', className)} {...rest}>
      <div className="pk-section-header-text">
        {eyebrow === undefined ? null : <span className="pk-label">{eyebrow}</span>}
        <Heading className={level === 1 ? 'pk-h1' : 'pk-h2'}>{title}</Heading>
      </div>

      {aside === undefined ? null : <div className="pk-section-header-aside">{aside}</div>}
    </header>
  );
}
