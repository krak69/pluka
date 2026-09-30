import type { HTMLAttributes, ReactNode } from 'react';

import { classNames } from '../internal/class-names.js';

/**
 * État vide — 06_DESIGN_SYSTEM.md §83.
 *
 * « Un empty state explique : 1. ce qui manque ; 2. pourquoi cela compte ;
 * 3. quelle est la prochaine action. » Les trois emplacements sont donc des
 * props distinctes, et les deux premières sont requises : un état vide qui ne
 * dit pas ce qui manque n'explique rien.
 *
 * §107 : « aucune donnée inventée pour remplir un vide ». C'est la raison
 * d'être de ce composant. Un écran dont le service n'existe pas encore
 * l'affiche plutôt que de rendre des valeurs de démonstration, et le dit —
 * `detail` porte cette précision, en clair, sans « bientôt ».
 *
 * `action` reste optionnelle : une fonctionnalité non branchée n'offre aucune
 * action au lecteur, et en inventer une serait mentir sur ce qui est
 * disponible.
 *
 * §83 : « Pas d'illustration décorative obligatoire. » Il n'y en a aucune.
 */
export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Micro-label de contexte : le domaine concerné. */
  readonly label?: string;
  /** Ce qui manque. */
  readonly title: string;
  /** Pourquoi cela compte, pour la personne qui lit. */
  readonly children: ReactNode;
  /** Ce qui reste à brancher, en termes vérifiables. */
  readonly detail?: ReactNode;
  /** Prochaine action, quand il en existe une. */
  readonly action?: ReactNode;
}

export function EmptyState({
  label,
  title,
  children,
  detail,
  action,
  className,
  ...rest
}: EmptyStateProps) {
  return (
    <div className={classNames('pk-empty', className)} {...rest}>
      {label === undefined ? null : <span className="pk-label">{label}</span>}

      <h2 className="pk-empty-title">{title}</h2>

      <div className="pk-empty-body">{children}</div>

      {detail === undefined ? null : <div className="pk-empty-detail">{detail}</div>}

      {action === undefined ? null : <div className="pk-empty-action">{action}</div>}
    </div>
  );
}
