import type { HTMLAttributes, ReactNode } from 'react';

import { classNames } from '../internal/class-names.js';

/**
 * Briques d'un écran d'accueil de course — l'`orgOverview` du prototype,
 * repris par la fiche événement de la console PLUKA et par l'Accueil de
 * l'espace organisateur.
 *
 * Des primitives de mise en page, sans règle métier (06_DESIGN_SYSTEM §111) :
 * ce qui est « à faire », « fait » ou « inconnu » se décide dans le domaine
 * (`eventReadiness`) et arrive ici déjà tranché. Chaque brique dit son état
 * en mots ; la couleur et l'icône ne font que le souligner (§44).
 *
 * - `ActionList` — « À faire » : une ligne par point, liseré Aube (§38) ;
 * - `StatTiles` — des chiffres clés, libellé, valeur, méta ;
 * - `Checklist` — une liste d'états, avec son compte « 5 sur 7 » ;
 * - `ActivityFeed` — ce qui s'est passé, le plus récent d'abord.
 */

// ------------------------------------------------------------
// ActionList
// ------------------------------------------------------------

export interface ActionListItem {
  readonly key: string;
  readonly title: ReactNode;
  readonly detail?: ReactNode;
  readonly action?: ReactNode;
}

export interface ActionListProps extends HTMLAttributes<HTMLUListElement> {
  readonly items: readonly ActionListItem[];
  /** Le micro-label de chaque ligne. */
  readonly label?: string;
}

export function ActionList({ items, label = 'À faire', className, ...rest }: ActionListProps) {
  if (items.length === 0) return null;

  return (
    <ul
      className={classNames('pk-actions', className)}
      aria-label={`${label}, ${items.length}`}
      {...rest}
    >
      {items.map((item) => (
        <li key={item.key} className="pk-actions-item">
          <div className="pk-actions-text">
            <span className="pk-label pk-actions-label">{label}</span>
            <span className="pk-actions-title">{item.title}</span>
            {item.detail === undefined ? null : (
              <span className="pk-actions-detail">{item.detail}</span>
            )}
          </div>
          {item.action === undefined ? null : (
            <div className="pk-actions-action">{item.action}</div>
          )}
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------
// StatTiles
// ------------------------------------------------------------

export interface StatTile {
  readonly key: string;
  readonly label: string;
  readonly value: ReactNode;
  readonly meta?: ReactNode;
  /** La méta signale un point à reprendre : le texte le dit, Aube le marque. */
  readonly due?: boolean;
}

export interface StatTilesProps extends HTMLAttributes<HTMLUListElement> {
  readonly tiles: readonly StatTile[];
}

export function StatTiles({ tiles, className, ...rest }: StatTilesProps) {
  return (
    <ul className={classNames('pk-tiles', className)} aria-label="En bref" {...rest}>
      {tiles.map((tile) => (
        <li key={tile.key} className="pk-tile">
          <span className="pk-tile-label">{tile.label}</span>
          <span className="pk-tile-value">{tile.value}</span>
          {tile.meta === undefined ? null : (
            <span className={tile.due === true ? 'pk-tile-meta pk-tile-meta-due' : 'pk-tile-meta'}>
              {tile.meta}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------
// Checklist
// ------------------------------------------------------------

export type ChecklistState = 'done' | 'todo' | 'unknown';

export interface ChecklistItem {
  readonly key: string;
  readonly label: ReactNode;
  readonly state: ChecklistState;
  readonly detail?: ReactNode;
}

/** Le mot qui porte l'état — lu par les lecteurs d'écran, jamais la seule icône. */
const STATE_WORDS: Readonly<Record<ChecklistState, string>> = {
  done: 'fait',
  todo: 'à faire',
  unknown: 'inconnu',
};

function StateMark({ state }: { readonly state: ChecklistState }) {
  // Coche, point d'exclamation, point d'interrogation : trois formes, pas
  // seulement trois couleurs.
  const path =
    state === 'done'
      ? 'M5 8.5l2 2 4-4.5'
      : state === 'todo'
        ? 'M8 4.5v4.2M8 11.2v.3'
        : 'M6.3 6.3a1.8 1.8 0 113 1.4c-.7.5-1.3.9-1.3 1.8M8 11.4v.2';

  return (
    <svg className="pk-check-mark" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface ChecklistProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  readonly title: ReactNode;
  readonly items: readonly ChecklistItem[];
  /** Le geste qui suit — un seul CTA (AGENTS §43). */
  readonly action?: ReactNode;
}

export function Checklist({ title, items, action, className, ...rest }: ChecklistProps) {
  const done = items.filter((item) => item.state === 'done').length;

  return (
    <section className={classNames('pk-checklist', className)} {...rest}>
      <header className="pk-checklist-head">
        <h2 className="pk-checklist-title">{title}</h2>
        <span className="pk-checklist-count">
          {done} sur {items.length}
        </span>
      </header>
      <ul className="pk-checklist-items">
        {items.map((item) => (
          <li key={item.key} className={`pk-checklist-item pk-checklist-${item.state}`}>
            <StateMark state={item.state} />
            <span className="pk-checklist-label">
              {item.label}
              <span className="pk-visually-hidden"> — {STATE_WORDS[item.state]}</span>
            </span>
            {item.detail === undefined ? null : (
              <span className="pk-checklist-detail">{item.detail}</span>
            )}
          </li>
        ))}
      </ul>
      {action === undefined ? null : <div className="pk-checklist-action">{action}</div>}
    </section>
  );
}

// ------------------------------------------------------------
// ActivityFeed
// ------------------------------------------------------------

export interface ActivityItem {
  readonly key: string;
  readonly text: ReactNode;
  readonly meta?: ReactNode;
}

export interface ActivityFeedProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  readonly title: ReactNode;
  readonly items: readonly ActivityItem[];
  /** Phrase d'absence : un flux vide se dit, il ne disparaît pas. */
  readonly empty: ReactNode;
}

export function ActivityFeed({ title, items, empty, className, ...rest }: ActivityFeedProps) {
  return (
    <section className={classNames('pk-activity', className)} {...rest}>
      <h2 className="pk-activity-title">{title}</h2>
      {items.length === 0 ? (
        <p className="pk-activity-empty">{empty}</p>
      ) : (
        <ol className="pk-activity-items">
          {items.map((item) => (
            <li key={item.key} className="pk-activity-item">
              <span className="pk-activity-text">{item.text}</span>
              {item.meta === undefined ? null : (
                <span className="pk-activity-meta">{item.meta}</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
