import { listAdminSources } from '@pluka/domain';
import { EmptyState, SectionHeader, Table } from '@pluka/ui';

import { AdminStatus, sourceTypeLabel } from '@/components/admin-status';
import { dateTime } from '@/lib/format';
import { redirectOnReadError, requireAdminConsoleContext } from '@/lib/admin';

/**
 * Sources — `adminTab: 'sources'`.
 *
 * Toutes éditions confondues, y compris celles d'un événement non publié : une
 * source déposée sur une édition en préparation est précisément celle qu'on
 * veut voir avant la publication.
 *
 * L'URL est rendue en lien sortant. Aucun contenu de source n'est affiché ici :
 * l'extrait appartient au tiroir de provenance, qui a son propre écran.
 */
export const metadata = { title: 'Sources' };

export default async function SourcesPage() {
  const context = await requireAdminConsoleContext('/sources');
  const items = await listAdminSources(context, {}).catch(redirectOnReadError);

  return (
    <main className="ad-page">
      <SectionHeader eyebrow="Administration" title="Sources" />

      {items.length === 0 ? (
        <EmptyState
          label="Sources"
          title="Aucune source importée."
          detail="Les dépôts d’URL, de PDF et de GPX apparaissent ici, quelle que soit l’édition."
        >
          <p>Une source s’importe depuis l’écran d’une épreuve.</p>
        </EmptyState>
      ) : (
        <Table
          caption={`${items.length} source${items.length > 1 ? 's' : ''}, toutes éditions`}
          columns={[
            { key: 'title', label: 'Source' },
            { key: 'type', label: 'Type' },
            { key: 'status', label: 'Statut' },
            { key: 'edition', label: 'Édition' },
            { key: 'chunks', label: 'Fragments', align: 'numeric' },
            { key: 'snapshot', label: 'Capture' },
            { key: 'imported', label: 'Importée le' },
          ]}
          rows={items.map((item) => ({
            key: item.sourceId,
            cells: {
              title: (
                <>
                  <span>{item.title}</span>
                  {item.url === null ? null : (
                    <a
                      className="pk-link ad-sub"
                      href={item.url}
                      rel="noreferrer noopener nofollow"
                      target="_blank"
                    >
                      {item.url}
                    </a>
                  )}
                </>
              ),
              type: sourceTypeLabel(item.sourceType),
              status: <AdminStatus domain="source" status={item.status} />,
              edition: (
                <>
                  <span>{item.eventName}</span>
                  <span className="ad-sub">{item.editionYear}</span>
                </>
              ),
              chunks: item.chunksCount,
              /* Une source sans capture n'a pas encore été figée : c'est ce qui
                 distingue « lue une fois » de « archivée pour preuve » (§43). */
              snapshot:
                item.snapshotRetrievedAt === null ? (
                  <span className="ad-muted">aucune</span>
                ) : (
                  dateTime(item.snapshotRetrievedAt)
                ),
              imported: dateTime(item.importedAt),
            },
          }))}
        />
      )}
    </main>
  );
}
