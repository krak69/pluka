import { listAdminSources } from '@pluka/domain';

import { AdminEmpty, AdminPageHeader } from '@/components/admin-page';
import { AdminStatus, sourceTypeLabel } from '@/components/admin-status';
import { dateTime } from '@/lib/format';
import { redirectOnReadError, requireAdminConsoleContext } from '@/lib/admin';

/**
 * Sources, toutes éditions — `adminSources` du prototype.
 *
 * Une carte par source : son nom, « édition · extraits », son statut et sa
 * date d'import. Le type et l'URL, absents du prototype, restent dans la ligne
 * grise : c'est ce qu'il faut pour retrouver la source sans ouvrir la revue.
 */
export const metadata = { title: 'Sources' };

export default async function SourcesPage() {
  const context = await requireAdminConsoleContext('/sources');
  const items = await listAdminSources(context, {}).catch(redirectOnReadError);

  return (
    <main className="ad-page">
      <AdminPageHeader
        title="Sources"
        lede="Vue technique : état d’analyse, extraits produits et erreurs de traitement, tous événements confondus."
      />

      {items.length === 0 ? (
        <AdminEmpty icon="Files" title="Aucune source importée.">
          <p>Les dépôts d’URL, de PDF et de GPX apparaîtront ici, quelle que soit l’édition.</p>
        </AdminEmpty>
      ) : (
        <ul className="ad-cards" aria-label={`${items.length} source${items.length > 1 ? 's' : ''}, toutes éditions`}>
          {items.map((item) => (
            <li key={item.sourceId} className="ad-card">
              <div className="ad-card-main">
                <span className="ad-card-title">{item.title}</span>
                <span className="ad-card-meta">
                  {item.eventName} {item.editionYear} · {sourceTypeLabel(item.sourceType)} ·{' '}
                  {item.chunksCount} extrait{item.chunksCount > 1 ? 's' : ''}
                  {/* Une source sans capture n'a pas encore été figée : c'est ce
                      qui distingue « lue une fois » de « archivée pour preuve » (§43). */}
                  {item.snapshotRetrievedAt === null ? ' · aucune capture' : null}
                </span>
                {item.url === null ? null : (
                  <a
                    className="pk-link ad-card-meta"
                    href={item.url}
                    rel="noreferrer noopener nofollow"
                    target="_blank"
                  >
                    {item.url}
                  </a>
                )}
              </div>

              <AdminStatus domain="source" status={item.status} />
              <span className="ad-card-side">Importée le {dateTime(item.importedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
