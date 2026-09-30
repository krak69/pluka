import { getAdminReport } from '@pluka/domain';
import { DataValue, Divider, SectionHeader } from '@pluka/ui';
import Link from 'next/link';

import { AdminStatus, reportReason } from '@/components/admin-status';
import { dateTime } from '@/lib/format';
import { redirectOnReadError, requireAdminConsoleContext } from '@/lib/admin';

/**
 * Détail d'un signalement — lecture journalisée.
 *
 * `admin_get_report` écrit `report.read` dans `private.audit_logs` **avant** de
 * rendre quoi que ce soit : §104 veut un accès « justifié ; audité », et la
 * trace précède la lecture plutôt que de la suivre. Ouvrir cette page laisse
 * donc une ligne dans le journal, visible dans l'onglet Journal.
 *
 * C'est aussi pourquoi le contenu n'est pas sur la file : y afficher chaque
 * message signalé aurait rendu une centaine de lectures personnelles
 * indiscernables d'un simple coup d'œil à la liste.
 *
 * Modérer est une écriture : lot 4b.
 */
export const metadata = { title: 'Signalement' };

export default async function ReportPage({
  params,
}: {
  readonly params: Promise<{ readonly reportId: string }>;
}) {
  const { reportId } = await params;
  const context = await requireAdminConsoleContext(`/signalements/${reportId}`);

  const report = await getAdminReport(context, { reportId }).catch(redirectOnReadError);

  return (
    <main className="ad-page">
      <Link href="/signalements" className="pk-link">
        Signalements
      </Link>

      <SectionHeader
        eyebrow="Signalement"
        title={reportReason(report.reason)}
        aside={<AdminStatus domain="report" status={report.status} />}
      />

      <p className="pk-body ad-notice">
        Cette consultation est inscrite au journal d’audit : elle expose des données personnelles.
      </p>

      <div className="ad-facts">
        <DataValue
          label="Cible"
          value={report.targetKind === 'thread' ? 'Fil de discussion' : 'Message'}
        />
        <DataValue label="Signalé le" value={dateTime(report.createdAt)} />
        <DataValue
          label="Traité le"
          value={report.resolvedAt === null ? 'pas encore' : dateTime(report.resolvedAt)}
        />
      </div>

      <Divider spaced />

      <h2 className="pk-h2 ad-section-title">Ce que dit le signalement</h2>

      {report.details === null ? (
        <p className="pk-body ad-muted">Aucun commentaire n’accompagne ce signalement.</p>
      ) : (
        <blockquote className="ad-quote">{report.details}</blockquote>
      )}

      <p className="pk-body">
        <span className="pk-label">Déclarant</span>{' '}
        {report.reporterEmail ?? <span className="ad-muted">compte supprimé</span>}
      </p>

      <Divider spaced />

      <h2 className="pk-h2 ad-section-title">Contenu signalé</h2>

      {report.targetContent === null ? (
        <p className="pk-body ad-muted">
          Le contenu n’existe plus : il a été supprimé depuis le signalement.
        </p>
      ) : (
        <blockquote className="ad-quote">{report.targetContent}</blockquote>
      )}

      <p className="pk-body">
        <span className="pk-label">Auteur</span>{' '}
        {report.targetAuthorEmail ?? <span className="ad-muted">compte supprimé</span>}
      </p>
    </main>
  );
}
