import type { AnchorHTMLAttributes, ReactNode } from 'react';

import { classNames } from '../internal/class-names.js';

/**
 * Entrée de navigation — 06_DESIGN_SYSTEM.md §66 à §70.
 *
 * §1869 : « Pas d'icônes seules pour les destinations principales. »
 * `children` porte donc le libellé et est requis ; `icon` est facultatif et
 * purement décoratif — il n'est jamais la seule information.
 *
 * §29 et §70 : la cible atteint 44 px de haut. §1841 : « pas de sidebar
 * immense remplie d'icônes » — l'entrée reste une ligne de texte avec un
 * repère, pas une tuile.
 *
 * Le composant rend un `<a>` et ignore délibérément le routeur : `05_ROUTES_FLOWS.md`
 * fait de chaque onglet une route, et l'application décide si elle passe par
 * `next/link` en fournissant son propre `as`. Ici, `href` suffit.
 *
 * `current` marque la destination active. Elle est rendue deux fois — par
 * `aria-current`, pour la synthèse vocale, et par la classe, pour l'œil :
 * §103 interdit que la couleur porte seule le sens. L'attribut est posé à
 * `false` plutôt qu'omis : ARIA l'admet, et `exactOptionalPropertyTypes`
 * refuserait un `undefined` explicite.
 */
export interface NavItemProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> {
  readonly href: string;
  /** Libellé de la destination. Jamais vide. */
  readonly children: ReactNode;
  /** Repère visuel, facultatif et décoratif. */
  readonly icon?: ReactNode;
  /** Compteur discret — tâches restantes, messages non lus. */
  readonly badge?: number;
  readonly current?: boolean;
  /** Rendu sur bande sombre : libellé clair, icône Lichen quand l'entrée est active (§41). */
  readonly onDark?: boolean;
}

export function NavItem({
  href,
  children,
  icon,
  badge,
  current = false,
  onDark = false,
  className,
  ...rest
}: NavItemProps) {
  return (
    <a
      href={href}
      aria-current={current ? 'page' : false}
      className={classNames(
        'pk-nav-item',
        current && 'pk-nav-item-current',
        onDark && 'pk-nav-item-on-dark',
        className,
      )}
      {...rest}
    >
      {icon === undefined ? null : (
        <span aria-hidden="true" className="pk-nav-item-icon">
          {icon}
        </span>
      )}

      <span className="pk-nav-item-label">{children}</span>

      {badge === undefined || badge <= 0 ? null : (
        <span className="pk-nav-item-badge">{badge}</span>
      )}
    </a>
  );
}
