import { listAdminJobs } from '@pluka/domain';
import { EmptyState, SectionHeader, Table } from '@pluka/ui';

import { AdminStatus } from '@/components/admin-status';
import { dateTime } from '@/lib/format';
import { redirectOnReadError, requireAdminConsoleContext } from '@/lib/admin';

/**
 * Imports et traitements — `adminTab: 'traitements'`.
 *
 * Trois colonnes font tout l'intérêt de cet écran : le statut, l'erreur, et la
 * clé d'idempotence. C'est ce triplet qui remplace l'ouverture de psql quand un
 * import échoue — l'enquête sur le dénivelé s'était faite en SQL faute de cette
 * page.
 *
 * `private.ingestion_jobs` reste `service only` (03_PRIVACY_RLS §8) : la
 * lecture passe par `admin_list_jobs`, jamais par un client.
 *
 * Relancer un job est une écriture : lot 4b. Les échecs sont donc visibles ici
 * sans être actionnables, ce qui est déjà l'essentiel — on ne relance pas ce
 * qu'on n'a pas lu.
 */
export const metadata = { title: 'Imports et traitements' };

export default async function JobsPage() {
  const context = await requireAdminConsoleContext('/traitements');
  const jobs = await listAdminJobs(context, {}).catch(redirectOnReadError);

  const failed = jobs.filter((job) => job.status === 'failed').length;

  return (
    <main className="ad-page">
      <SectionHeader eyebrow="Administration" title="Imports et traitements" />

      <p className="pk-body ad-measure">
        Vue technique : état d’analyse, erreurs de traitement et clés d’idempotence, tous événements
        confondus.
      </p>

      {jobs.length === 0 ? (
        <EmptyState
          label="Traitements"
          title="Aucun traitement."
          detail="La file d’ingestion est vide : ni import en attente, ni échec."
        >
          <p>Un traitement naît du dépôt d’une source ou d’un import GPX.</p>
        </EmptyState>
      ) : (
        <Table
          caption={
            failed === 0
              ? `${jobs.length} traitement${jobs.length > 1 ? 's' : ''}, aucun en échec`
              : `${jobs.length} traitement${jobs.length > 1 ? 's' : ''}, dont ${failed} en échec`
          }
          columns={[
            { key: 'job', label: 'Traitement' },
            { key: 'status', label: 'Statut' },
            { key: 'attempts', label: 'Essais', align: 'numeric' },
            { key: 'target', label: 'Porte sur' },
            { key: 'idempotency', label: 'Clé d’idempotence' },
            { key: 'error', label: 'Dernière erreur' },
            { key: 'timing', label: 'Chronologie' },
          ]}
          rows={jobs.map((job) => ({
            key: job.jobId,
            emphasis: job.status === 'failed',
            cells: {
              job: (
                <>
                  <span className="ad-mono">{job.jobType}</span>
                  <span className="ad-sub ad-mono">{job.jobId}</span>
                </>
              ),
              status: <AdminStatus domain="job" status={job.status} />,
              attempts: `${job.attempts}/${job.maxAttempts}`,
              target:
                job.sourceTitle === null && job.eventName === null ? (
                  <span className="ad-muted">hors source</span>
                ) : (
                  <>
                    <span>{job.sourceTitle ?? '—'}</span>
                    {job.eventName === null ? null : (
                      <span className="ad-sub">{job.eventName}</span>
                    )}
                  </>
                ),
              /* La clé est longue et technique : elle se lit en monospace et
                 se copie. C'est elle qui rapproche deux essais du même
                 travail — sans elle, un doublon est indiscernable d'une
                 relance légitime. */
              idempotency: <code className="ad-key">{job.idempotencyKey}</code>,
              error:
                job.lastError === null ? (
                  <span className="ad-muted">aucune</span>
                ) : (
                  <span className="ad-error">{job.lastError}</span>
                ),
              timing: (
                <>
                  <span className="ad-sub">créé {dateTime(job.createdAt)}</span>
                  <span className="ad-sub">
                    {job.completedAt !== null
                      ? `fini ${dateTime(job.completedAt)}`
                      : job.startedAt !== null
                        ? `démarré ${dateTime(job.startedAt)}`
                        : `prévu ${dateTime(job.availableAt)}`}
                  </span>
                </>
              ),
            },
          }))}
        />
      )}
    </main>
  );
}
