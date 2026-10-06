import { listAdminReports } from '@pluka/domain';
import Link from 'next/link';

import { AdminEmpty, AdminPageHeader, Chip } from '@/components/admin-page';
import { AdminStatus, reportReason } from '@/components/admin-status';
import { ConsoleNotice } from '@/components/console-action';
import { consoleNotice, type ConsoleNoticeParams } from '@/lib/console-notice';
import { dateTime } from '@/lib/format';
import { redirectOnReadError, requireAdminConsoleContext } from '@/lib/admin';

/**
 * Signalements — `adminModeration` du prototype.
 *
 * Une carte par signalement : le motif en pastille d'avertissement, la cible
 * et la date, puis « Ouvrir ».
 *
 * Le prototype cite le contenu signalé et son auteur dans la carte. Pas ici :
 * un signalement met en cause deux personnes, et trier ne demande aucune des
 * deux. Le contenu, le déclarant, et les gestes Masquer / Classer sans suite
 * vivent sur la fiche, dont l'ouverture est journalisée (lot 4a, §104).
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
      <AdminPageHeader title="Signalements" />

      <ConsoleNotice notice={notice} />

      {reports.length === 0 ? (
        <AdminEmpty icon="Flag" title="Aucun signalement.">
          <p>Un signalement naît d’un message ou d’un fil de discussion de la communauté.</p>
        </AdminEmpty>
      ) : (
        <ul className="ad-cards ad-cards-narrow" aria-label={`${reports.length} signalement${reports.length > 1 ? 's' : ''}, tous statuts`}>
          {reports.map((report) => (
            <li key={report.reportId} className="ad-card ad-card-stack">
              <div className="ad-card-line">
                <Chip tone="warning">{reportReason(report.reason)}</Chip>
                <span className="ad-card-meta">
                  {report.targetKind === 'thread' ? 'Fil de discussion' : 'Message'} · signalé le{' '}
                  {dateTime(report.createdAt)}
                  {report.resolvedAt === null ? null : ` · traité le ${dateTime(report.resolvedAt)}`}
                </span>
                <span className="ad-card-line-end">
                  <AdminStatus domain="report" status={report.status} />
                </span>
              </div>

              <p className="ad-card-meta ad-card-source">
                Le contenu et son auteur s’affichent en ouvrant la fiche ; l’ouverture est inscrite
                au journal.
              </p>

              <div className="ad-card-actions">
                <Link href={`/signalements/${report.reportId}`} className="pk-btn pk-button-secondary">
                  Ouvrir
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
