import { listAdminJobs } from '@pluka/domain';

import { retryJobAction } from '@/app/console-actions';
import { AdminEmpty, AdminPageHeader } from '@/components/admin-page';
import { AdminStatus, jobTypeLabel } from '@/components/admin-status';
import { ConsoleAction, ConsoleNotice } from '@/components/console-action';
import { consoleNotice, type ConsoleNoticeParams } from '@/lib/console-notice';
import { dateTime } from '@/lib/format';
import { redirectOnReadError, requireAdminConsoleContext } from '@/lib/admin';

/**
 * Imports et traitements — `adminJobs` du prototype.
 *
 * Une carte par traitement : « Analyse GPX · fichier », son erreur ou ses
 * essais, son statut, sa date, et « Relancer » s'il a échoué.
 *
 * Le prototype s'arrête là. Ce qui a remplacé psql le jour où un import a
 * échoué — la clé d'idempotence, les essais, la chronologie — reste à portée,
 * replié sous « Détail technique ».
 *
 * `private.ingestion_jobs` reste `service only` (03_PRIVACY_RLS §8) : la
 * lecture passe par `admin_list_jobs`, jamais par un client.
 *
 * RELANCER — lot 4b, migration 0029
 *
 * Le bouton suit le statut du job — seul `failed` se relance — et jamais le
 * rôle de la personne qui regarde. La relance rejoue l'événement d'origine ;
 * un double clic produit une relance et un refus, pas deux messages de file.
 */
export const metadata = { title: 'Imports et traitements' };

export default async function JobsPage({
  searchParams,
}: {
  readonly searchParams: Promise<ConsoleNoticeParams>;
}) {
  const context = await requireAdminConsoleContext('/traitements');
  const jobs = await listAdminJobs(context, {}).catch(redirectOnReadError);
  const notice = consoleNotice(await searchParams);

  return (
    <main className="ad-page">
      <AdminPageHeader title="Imports et traitements" />

      <ConsoleNotice notice={notice} />

      {jobs.length === 0 ? (
        <AdminEmpty icon="ArrowsClockwise" title="Aucun traitement.">
          <p>Un traitement naît du dépôt d’une source ou d’un import GPX.</p>
        </AdminEmpty>
      ) : (
        <ul className="ad-cards" aria-label={`${jobs.length} traitement${jobs.length > 1 ? 's' : ''}`}>
          {jobs.map((job) => {
            const subject = job.sourceTitle ?? job.eventName;

            return (
              <li key={job.jobId} className="ad-card">
                <div className="ad-card-main">
                  <span className="ad-card-title">
                    {jobTypeLabel(job.jobType)}
                    {subject === null ? null : ` · ${subject}`}
                  </span>
                  <span className={job.lastError === null ? 'ad-card-meta' : 'ad-card-meta ad-error'}>
                    {job.lastError ?? `${job.attempts} essai${job.attempts > 1 ? 's' : ''} sur ${job.maxAttempts}`}
                  </span>

                  <details className="ad-tech">
                    <summary>Détail technique</summary>
                    <dl className="ad-payload">
                      <div>
                        <dt>Type</dt>
                        <dd className="ad-mono">{job.jobType}</dd>
                      </div>
                      <div>
                        <dt>Identifiant</dt>
                        <dd className="ad-mono">{job.jobId}</dd>
                      </div>
                      {/* C'est elle qui rapproche deux essais du même travail :
                          sans elle, un doublon est indiscernable d'une relance. */}
                      <div>
                        <dt>Clé d’idempotence</dt>
                        <dd>
                          <code className="ad-key">{job.idempotencyKey}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Essais</dt>
                        <dd>
                          {job.attempts}/{job.maxAttempts}
                        </dd>
                      </div>
                      <div>
                        <dt>Chronologie</dt>
                        <dd>
                          créé {dateTime(job.createdAt)}
                          {job.startedAt === null ? null : ` · démarré ${dateTime(job.startedAt)}`}
                          {job.completedAt === null ? null : ` · fini ${dateTime(job.completedAt)}`}
                        </dd>
                      </div>
                    </dl>
                  </details>
                </div>

                <AdminStatus domain="job" status={job.status} />
                <span className="ad-card-side">
                  {dateTime(job.completedAt ?? job.startedAt ?? job.createdAt)}
                </span>
                {job.status === 'failed' ? (
                  <ConsoleAction action={retryJobAction} fields={{ jobId: job.jobId }} label="Relancer" />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
