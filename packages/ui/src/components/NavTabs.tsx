import type { HTMLAttributes } from 'react';

import { classNames } from '../internal/class-names.js';

/**
 * Onglets secondaires — 06_DESIGN_SYSTEM.md §110 (`Tabs`).
 *
 * `05_ROUTES_FLOWS.md` §1.2 fait de chaque onglet une route : ces onglets sont
 * donc des liens, pas des boutons qui changent un état local. Le composant rend
 * une liste de liens et marque l'actif par `aria-current`, comme `NavItem`.
 *
 * Il sert les strips de troisième niveau — Préparation (matériel, sacs, tâches),
 * Bibliothèque, Produits nutrition — et non la navigation principale, qui
 * appartient à `NavList`.
 *
 * §15 : pas de capitales forcées ici. Ce ne sont pas des micro-labels.
 */
export interface NavTab {
  readonly href: string;
  readonly label: string;
  readonly current?: boolean;
}

export interface NavTabsProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  /** Nom du groupe d'onglets, pour l'arbre d'accessibilité. */
  readonly label: string;
  readonly tabs: readonly NavTab[];
}

export function NavTabs({ label, tabs, className, ...rest }: NavTabsProps) {
  return (
    <nav aria-label={label} className={classNames('pk-tabs', className)} {...rest}>
      {tabs.map((tab) => (
        <a
          key={tab.href}
          href={tab.href}
          aria-current={tab.current === true ? 'page' : false}
          className={classNames('pk-tab', tab.current === true && 'pk-tab-current')}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}
