import type { HTMLAttributes, ReactNode } from 'react';

import { classNames } from '../internal/class-names.js';

/**
 * Bande de terrain — 06_DESIGN_SYSTEM.md §22, §183.
 *
 * « Un bloc pleine largeur qui établit une scène » : fond fort, topo
 * éventuel, micro-label, titre, donnée, une action dominante. Elle n'est
 * jamais enfermée dans une card flottante (§22), et ce composant n'en impose
 * aucune à l'intérieur (§183).
 *
 * LE RELIEF
 *
 * `topo` pose le relief canonique du kit de marque (`reference/brand/topo/`)
 * en fond de scène, par `--topo-dark` / `-light` / `-glacier`
 * (`tokens/topo.css`). §144 interdit d'en générer un autre.
 *
 * LES ACTIONS
 *
 * `primaryAction` est le CTA Lichen de la zone — un seul (AGENTS §43).
 * `secondaryAction` reste discret. `footer` reçoit la ligne de métadonnées
 * sous le filet, à gauche des actions.
 */
export interface TerrainBandProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  readonly tone: 'dark' | 'light' | 'glacier';
  readonly topo?: boolean;
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  /** `h1` pour la bande d'en-tête d'une page, `h2` pour une bande de section. */
  readonly level?: 1 | 2;
  readonly body?: ReactNode;
  readonly footer?: ReactNode;
  readonly primaryAction?: ReactNode;
  readonly secondaryAction?: ReactNode;
}

export function TerrainBand({
  tone,
  topo = false,
  eyebrow,
  title,
  level = 1,
  body,
  footer,
  primaryAction,
  secondaryAction,
  className,
  ...rest
}: TerrainBandProps) {
  const Heading = level === 1 ? 'h1' : 'h2';
  const hasFoot =
    footer !== undefined || primaryAction !== undefined || secondaryAction !== undefined;

  return (
    <section
      className={classNames(
        'pk-terrain',
        `pk-terrain-${tone}`,
        topo ? 'pk-terrain-topo' : undefined,
        className,
      )}
      {...rest}
    >
      <div className="pk-terrain-scene">
        {eyebrow === undefined ? null : <p className="pk-label pk-terrain-eyebrow">{eyebrow}</p>}
        <Heading className="pk-terrain-title">{title}</Heading>
        {body === undefined ? null : <div className="pk-terrain-body">{body}</div>}
      </div>

      {hasFoot ? (
        <div className="pk-terrain-foot">
          <div className="pk-terrain-meta">{footer}</div>
          {secondaryAction === undefined && primaryAction === undefined ? null : (
            <div className="pk-terrain-actions">
              {secondaryAction}
              {primaryAction}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
