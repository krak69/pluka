import { getAdminReport } from '@pluka/domain';
import { DataValue, Divider, SectionHeader } from '@pluka/ui';
import Link from 'next/link';

import { dismissReportAction, hideReportedContentAction } from '@/app/console-actions';
import { AdminStatus, reportReason } from '@/components/admin-status';
import { ConsoleAction } from '@/components/console-action';
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
 * DÉCIDER — lot 4b, migration 0029
 *
 * Deux gestes, tant que le signalement est ouvert (`open` ou `reviewed`) :
 *
 * - **Masquer le contenu** — destructeur pour l'auteur, donc confirmé à
 *   l'écran. Clôt aussi tous les signalements ouverts sur ce contenu, et pour
 *   un fil ceux de ses messages, sous une seule entrée d'audit.
 * - **Classer sans suite** — ne touche ni au contenu, ni aux autres
 *   signalements. Pas de confirmation : rien n'est retiré à personne.
 *
 * Les deux boutons s'affichent selon l'état du signalement, jamais selon le
 * rôle de la personne qui regarde : un refus de droit est dit par la base, à
 * côté du bouton.
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

      <Divider spaced />

      <h2 className="pk-h2 ad-section-title">Décision</h2>

      {report.status === 'open' || report.status === 'reviewed' ? (
        <>
          <p className="pk-body ad-measure">
            Masquer retire le {report.targetKind === 'thread' ? 'fil et ses messages' : 'message'}{' '}
            de la lecture des participants, sans le supprimer, et clôt les autres signalements
            ouverts sur ce contenu. Classer sans suite ne clôt que ce signalement.
          </p>

          <div className="ad-decisions">
            <ConsoleAction
              action={hideReportedContentAction}
              fields={{ reportId: report.reportId }}
              label="Masquer le contenu"
              variant="destructive"
              confirm={
                report.targetKind === 'thread'
                  ? 'Je confirme masquer ce fil aux participants'
                  : 'Je confirme masquer ce message aux participants'
              }
            />

            <ConsoleAction
              action={dismissReportAction}
              fields={{ reportId: report.reportId }}
              label="Classer sans suite"
            />
          </div>
        </>
      ) : (
        <p className="pk-body ad-muted">
          Ce signalement est traité : aucune décision ne reste à prendre. Le geste et les
          signalements qu’il a clos figurent au journal.
        </p>
      )}
    </main>
  );
}
