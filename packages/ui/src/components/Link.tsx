import type { AnchorHTMLAttributes, ReactNode } from 'react';

import { classNames } from '../internal/class-names.js';

/**
 * Lien — 06_DESIGN_SYSTEM.md §32, §103.
 *
 * Le soulignement est le défaut : un lien inline distingué par la seule
 * couleur est invisible pour qui ne la perçoit pas. `standalone` le retire
 * pour un lien qui occupe déjà un bloc — une ligne de liste, une carte — et
 * dont la nature est portée par la forme.
 *
 * Ce composant rend un `<a>`. La navigation applicative de Next.js appartient
 * à l'app : `packages/ui` ne dépend pas d'un routeur.
 */
export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly onDark?: boolean;
  readonly standalone?: boolean;
  readonly children: ReactNode;
}

export function Link({ onDark = false, standalone = false, className, ...rest }: LinkProps) {
  return (
    <a
      className={classNames(
        'pk-link',
        onDark && 'pk-link-on-dark',
        standalone && 'pk-link-standalone',
        className,
      )}
      {...rest}
    />
  );
}
