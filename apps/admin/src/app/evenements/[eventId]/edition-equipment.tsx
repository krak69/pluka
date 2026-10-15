import type { EditionEquipmentRow, EquipmentProposal } from '@pluka/domain';

import { REQUIREMENT_OPTIONS } from '@/app/courses/[raceId]/equipment-requirements';
import {
  EquipmentGrid,
  type GridProposal,
  type GridRace,
  type GridRow,
} from '@/app/evenements/[eventId]/equipment-grid';

/**
 * Matériel de l'édition, sur l'écran événement — migrations 0047, 0048.
 *
 * L'en-tête compte les pièces par exigence la plus forte ; le tableau
 * (composant client) fait le reste : une ligne par pièce, une case par
 * épreuve, un brouillon enregistré d'un coup.
 */

function gridRowOf(row: EditionEquipmentRow): GridRow {
  return {
    factKey: row.factKey,
    label: row.label,
    condition: row.condition,
    detail: row.detail,
    cells: row.cells.map((cell) => (cell === null ? null : (cell.requirement ?? 'unknown'))),
    sources: row.sources,
  };
}

function gridProposalOf(proposal: EquipmentProposal): GridProposal {
  return {
    factKey: proposal.factKey,
    label: proposal.label,
    cells: proposal.cells.map((cell) =>
      cell === null
        ? null
        : {
            candidateId: cell.candidateId,
            requirement: cell.requirement,
            condition: cell.condition,
            conflict: cell.conflict,
          },
    ),
    duplicateIds: proposal.duplicateIds,
    excerpt: proposal.evidence.excerpt,
    source:
      proposal.evidence.sourceTitle === null
        ? null
        : `${proposal.evidence.sourceTitle}${
            proposal.evidence.pageNumber === null ? '' : `, p. ${proposal.evidence.pageNumber}`
          }`,
  };
}

export function EditionEquipmentPanel({
  eventId,
  editionId,
  editionYear,
  races,
  rows,
  proposals,
  previous,
}: {
  readonly eventId: string;
  readonly editionId: string;
  readonly editionYear: number;
  readonly races: readonly GridRace[];
  /** `null` si aucune épreuve n'a pu être lue : le panneau le dit. */
  readonly rows: readonly EditionEquipmentRow[] | null;
  /** Matériel lu dans les sources, en attente de revue (0046). */
  readonly proposals: readonly EquipmentProposal[];
  /** Le matériel de l'édition précédente, à reprendre. */
  readonly previous: {
    readonly year: number;
    readonly races: readonly GridRace[];
    readonly rows: readonly EditionEquipmentRow[];
  } | null;
}) {
  const unknown = rows?.filter((row) => row.cells.some((cell) => cell !== null && cell.requirement === null)).length ?? 0;
  const gridRows = rows?.map(gridRowOf) ?? [];

  return (
    <section className="ad-gear" id="materiel" aria-labelledby="gear-title">
      <header className="ad-gear-head">
        <div>
          <h2 id="gear-title" className="ad-gear-title">
            Matériel
          </h2>
          <p className="ad-gear-lede">
            Édition {editionYear} · le matériel tel que le règlement le nomme, épreuve par épreuve.
            Lu dans les documents et pages de l’événement, ou saisi ici. Rien n’est publié avant
            « Enregistrer » ; chaque changement est versionné et signalé aux coureurs concernés.
          </p>
        </div>
        {rows === null || rows.length === 0 ? null : (
          <dl className="ad-gear-counts">
            {REQUIREMENT_OPTIONS.map((option) => (
              <div key={option.value} className="ad-gear-count" data-requirement={option.value}>
                <dt>{option.label}</dt>
                <dd>{rows.filter((row) => row.strongest === option.value).length}</dd>
              </div>
            ))}
          </dl>
        )}
      </header>

      {proposals.length === 0 ? null : (
        <p className="ad-equipment-pending">
          <strong>
            {proposals.length} proposition{proposals.length > 1 ? 's' : ''} de matériel
          </strong>{' '}
          lue{proposals.length > 1 ? 's' : ''} dans les sources, en tête du tableau : accepte ou
          écarte, case par case visible.
        </p>
      )}

      {unknown === 0 ? null : (
        <p className="ad-gear-warning">
          {unknown} matériel{unknown > 1 ? 's' : ''} sans exigence : la source ne la disait pas. Les
          cases marquées « ? » s’affichent ainsi aux coureurs ; règle-les puis enregistre pour
          préciser.
        </p>
      )}

      {races.length === 0 ? (
        <p className="ad-gear-empty">
          Crée d’abord une épreuve dans l’édition : le matériel se règle épreuve par épreuve.
        </p>
      ) : rows === null ? (
        <p className="ad-gear-empty">Le matériel n’a pas pu être lu. Réessaie dans un instant.</p>
      ) : (
        <EquipmentGrid
          // Un enregistrement recharge les lignes : le brouillon repart d'elles.
          key={JSON.stringify([gridRows, proposals.map((proposal) => proposal.factKey)])}
          eventId={eventId}
          editionId={editionId}
          races={races}
          rows={gridRows}
          proposals={proposals.map(gridProposalOf)}
          previous={
            previous === null || previous.rows.length === 0
              ? null
              : { year: previous.year, races: previous.races, rows: previous.rows.map(gridRowOf) }
          }
        />
      )}
    </section>
  );
}
