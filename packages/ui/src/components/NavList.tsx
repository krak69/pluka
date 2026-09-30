import type { HTMLAttributes, ReactNode } from 'react';

import { classNames } from '../internal/class-names.js';

/**
 * Groupe de navigation — 06_DESIGN_SYSTEM.md §66, §67, §69.
 *
 * Le coureur a deux groupes : sa navigation annuelle (§66) et la navigation de
 * la course qu'il prépare (§67). Les séparer est ce qui empêche la sidebar de
 * devenir la liste plate que §1841 refuse.
 *
 * `label` est rendu en micro-label et nomme le groupe. Il est porté par un
 * `aria-label` sur le `<nav>` plutôt que par un titre visuel seul : un groupe
 * de navigation sans nom accessible oblige à parcourir ses liens pour le
 * comprendre.
 */
export interface NavListProps extends HTMLAttributes<HTMLElement> {
  /** Nom du groupe — affiché et porté à l'arbre d'accessibilité. */
  readonly label: string;
  /** Masque le libellé visuellement sans le retirer de l'arbre. */
  readonly hideLabel?: boolean;
  readonly children: ReactNode;
}

export function NavList({ label, hideLabel = false, children, className, ...rest }: NavListProps) {
  return (
    <nav aria-label={label} className={classNames('pk-nav-group', className)} {...rest}>
      {hideLabel ? null : <span className="pk-label pk-nav-group-label">{label}</span>}
      <div className="pk-nav-group-items">{children}</div>
    </nav>
  );
}
