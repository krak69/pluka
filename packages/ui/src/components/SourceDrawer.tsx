import type { ReactNode } from 'react';

import { classNames } from '../internal/class-names.js';
import { MicroLabel } from './MicroLabel.js';
import { TrustBadge, type TrustLevel } from './TrustBadge.js';

/**
 * Tiroir de source — 06_DESIGN_SYSTEM.md §86, §150.
 *
 * « Doit afficher selon disponibilité : type ; titre ; organisme ;
 * page / section ; extrait court ; date ; niveau de confiance. La source doit
 * être accessible depuis l'information critique sans polluer l'écran
 * principal. »
 *
 * D'où le `<details>` : la source est à un geste de l'information, jamais
 * étalée à côté d'elle. Le replié/déplié est natif — donc au clavier, aux
 * lecteurs d'écran et sans JavaScript, ce qui compte pour un écran rendu côté
 * serveur.
 *
 * « Selon disponibilité » est pris au mot : chaque champ absent disparaît au
 * lieu d'afficher un tiret. Une page inconnue n'est pas une page vide.
 */
export interface SourceDrawerProps {
  /** Type de source : page web, PDF, GPX, saisie organisateur… */
  readonly type?: string;
  readonly title?: string;
  readonly organization?: string;
  readonly pageLabel?: string;
  readonly sectionLabel?: string;
  /** Extrait court. §86 : un extrait, pas le document. */
  readonly excerpt?: string;
  readonly date?: string;
  readonly trustLevel?: TrustLevel;
  readonly href?: string;
  /** Libellé du déclencheur. §186 fixe « Voir la source » par défaut. */
  readonly label?: ReactNode;
  /** Détails supplémentaires propres au contexte — un locator, par exemple. */
  readonly children?: ReactNode;
  readonly className?: string;
  readonly open?: boolean;
}

function Row({ label, value }: { readonly label: string; readonly value: ReactNode }) {
  return (
    <div className="pk-source-row">
      <MicroLabel>{label}</MicroLabel>
      <span className="pk-source-row-value">{value}</span>
    </div>
  );
}

export function SourceDrawer({
  type,
  title,
  organization,
  pageLabel,
  sectionLabel,
  excerpt,
  date,
  trustLevel,
  href,
  label,
  children,
  className,
  open,
}: SourceDrawerProps) {
  return (
    <details className={classNames('pk-source-drawer', className)} open={open}>
      <summary className="pk-source-link">{label ?? 'Voir la source'}</summary>

      <div className="pk-source-body">
        {trustLevel === undefined ? null : (
          <div className="pk-source-row">
            <MicroLabel>Confiance</MicroLabel>
            <TrustBadge level={trustLevel} />
          </div>
        )}

        {type === undefined ? null : <Row label="Type" value={type} />}
        {title === undefined ? null : <Row label="Titre" value={title} />}
        {organization === undefined ? null : <Row label="Organisme" value={organization} />}
        {sectionLabel === undefined ? null : <Row label="Section" value={sectionLabel} />}
        {pageLabel === undefined ? null : <Row label="Page" value={pageLabel} />}
        {date === undefined ? null : <Row label="Date" value={date} />}

        {excerpt === undefined ? null : (
          <blockquote className="pk-source-excerpt">{excerpt}</blockquote>
        )}

        {children}

        {href === undefined ? null : (
          <a className="pk-source-link" href={href} rel="noreferrer noopener" target="_blank">
            Ouvrir le document
          </a>
        )}
      </div>
    </details>
  );
}
