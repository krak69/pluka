import type { AnchorHTMLAttributes, ReactNode } from 'react';

import { classNames } from '../internal/class-names.js';

/**
 * Lien vers une source — 06_DESIGN_SYSTEM.md §186, §150.
 *
 * « Doit pouvoir afficher : Voir la source, et ouvrir SourceDrawer. C'est un
 * composant de premier niveau du produit, pas une feature admin. »
 *
 * Le libellé par défaut est donc porté par le composant : une information
 * sourcée doit toujours proposer le même mot, quel que soit l'écran. §103
 * s'applique aussi ici — le lien est du texte, jamais une icône seule.
 *
 * Sans `href`, le composant rend un bouton : ouvrir un tiroir n'est pas une
 * navigation, et un `<a>` sans destination n'est pas atteignable au clavier.
 */
export interface SourceLinkProps extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'children' | 'href'
> {
  readonly href?: string;
  readonly children?: ReactNode;
}

export function SourceLink({ href, className, children, ...rest }: SourceLinkProps) {
  const label = children ?? 'Voir la source';

  if (href === undefined) {
    return (
      <button type="button" className={classNames('pk-source-link', className)}>
        {label}
      </button>
    );
  }

  return (
    <a href={href} className={classNames('pk-source-link', className)} {...rest}>
      {label}
    </a>
  );
}
