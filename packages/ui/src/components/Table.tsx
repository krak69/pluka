import type { ReactNode } from 'react';

import { classNames } from '../internal/class-names.js';

/**
 * Table de données denses — 06_DESIGN_SYSTEM.md §53.
 *
 * « Bordures fines ; peu de fonds alternés ; données chiffrées alignées ;
 * Martian Mono pour valeurs ; Hanken pour noms / prose ; header sticky si
 * utile ; pas d'ombre autour de la table. »
 *
 * Les colonnes déclarent leur nature plutôt que leur style : `numeric` aligne
 * à droite et passe en chiffres tabulaires, `text` reste en Hanken. C'est la
 * donnée qui décide de sa présentation, pas l'appelant — deux écrans ne
 * peuvent donc pas aligner les mêmes chiffres différemment.
 *
 * §3 : ni ombre, ni carte flottante par ligne. Une table est une table.
 */
export type TableColumnAlign = 'text' | 'numeric';

export interface TableColumn {
  readonly key: string;
  readonly label: string;
  readonly align?: TableColumnAlign;
  /** Unité affichée sous l'en-tête — §54, point 6 : « afficher les unités ». */
  readonly unit?: string;
}

export interface TableRow {
  readonly key: string;
  readonly cells: Readonly<Record<string, ReactNode>>;
  /** Ligne mise en avant — prochain point, marge critique. */
  readonly emphasis?: boolean;
}

export interface TableProps {
  readonly caption: string;
  readonly columns: readonly TableColumn[];
  readonly rows: readonly TableRow[];
  /** En-tête collant, pour un Plan long (§53). */
  readonly stickyHeader?: boolean;
  readonly className?: string;
}

export function Table({ caption, columns, rows, stickyHeader, className }: TableProps) {
  return (
    <div className="pk-table-scroll">
      <table className={classNames('pk-table', stickyHeader && 'pk-table-sticky', className)}>
        {/* §51 : jamais une seule source visuelle. La légende nomme la table
            pour qui ne voit pas la mise en page. */}
        <caption className="pk-label pk-table-caption">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={classNames('pk-label', column.align === 'numeric' && 'pk-table-numeric')}
              >
                {column.label}
                {column.unit === undefined ? null : (
                  <span className="pk-table-unit">{column.unit}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={classNames(row.emphasis && 'pk-table-row-emphasis')}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={classNames(column.align === 'numeric' && 'pk-table-numeric')}
                >
                  {row.cells[column.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
