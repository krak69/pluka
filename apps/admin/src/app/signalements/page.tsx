import { listAdminReports } from '@pluka/domain';
import { EmptyState, SectionHeader, Table } from '@pluka/ui';
import Link from 'next/link';

import { AdminStatus, reportReason } from '@/components/admin-status';
import { ConsoleNotice } from '@/components/console-action';
import { consoleNotice, type ConsoleNoticeParams } from '@/lib/console-notice';
import { dateTime } from '@/lib/format';
import { redirectOnReadError, requireAdminConsoleContext } from '@/lib/admin';

/**
 * Signalements — `adminTab: 'signalements'`.
 *
 * La file de triage ne montre ni le contenu signalé, ni le déclarant. Ce n'est
 * pas une limite technique : un signalement met en cause deux personnes, et
 * trier ne demande aucune des deux. Le motif, l'état et l'ancienneté suffisent
 * à décider quoi ouvrir.
 *
 * Ouvrir un signalement est une lecture de données personnelles : elle vit sur
 * sa propre route, et elle est journalisée.
 */
export const metadata = { title: 'Signalements' };

export default async function ReportsPage({
  searchParams,
}: {
  readonly searchParams: Promise<ConsoleNoticeParams>;
}) {
  const context = await requireAdminConsoleContext('/signalements');
  const reports = await listAdminReports(context, {}).catch(redirectOnReadError);
  const notice = consoleNotice(await searchParams);

  return (
    <main className="ad-page">
      <SectionHeader eyebrow="Administration" title="Signalements" />

      <ConsoleNotice notice={notice} />

      <p className="pk-body ad-measure">
        File de triage des contenus de forum. Le contenu signalé et l’auteur du signalement ne
        s’affichent qu’en ouvrant la fiche, et cette ouverture est inscrite au journal d’audit.
      </p>

      {reports.length === 0 ? (
        <EmptyState
          label="Signalements"
          title="Aucun signalement."
          detail="La file est interrogée tous statuts confondus, ouverts comme traités."
        >
          <p>Un signalement naît d’un message ou d’un fil de discussion.</p>
        </EmptyState>
      ) : (
        <Table
          caption={`${reports.length} signalement${reports.length > 1 ? 's' : ''}, tous statuts`}
          columns={[
            { key: 'reason', label: 'Motif' },
            { key: 'target', label: 'Cible' },
            { key: 'status', label: 'État' },
            { key: 'created', label: 'Signalé le' },
            { key: 'resolved', label: 'Traité le' },
            { key: 'open', label: '' },
          ]}
          rows={reports.map((report) => ({
            key: report.reportId,
            cells: {
              reason: reportReason(report.reason),
              target: report.targetKind === 'thread' ? 'Fil de discussion' : 'Message',
              status: <AdminStatus domain="report" status={report.status} />,
              created: dateTime(report.createdAt),
              resolved: report.resolvedAt === null ? '—' : dateTime(report.resolvedAt),
              open: (
                <Link href={`/signalements/${report.reportId}`} className="pk-link">
                  Ouvrir
                </Link>
              ),
            },
          }))}
        />
      )}
    </main>
  );
}
