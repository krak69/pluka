import {
  getOrganizerCourse,
  getParticipantImport,
  listEditionParticipants,
  suggestColumns,
} from '@pluka/domain';
import { StatusBadge } from '@pluka/ui';
import Link from 'next/link';

import { CourseFrame } from '@/components/course-frame';
import {
  ColumnsForm,
  CommitImportForm,
  DiscardImportForm,
  ImportFileForm,
} from '@/components/participant-forms';
import { sessionEventSiteContext } from '@/lib/event-site-editing';
import { participantImportContext } from '@/lib/organizer-course';
import { requireSession } from '@/lib/session';

/**
 * Participants — 00_PRODUCT_SPEC §29.
 *
 * La liste d'une édition, et son import : fichier, colonnes, vérification. La
 * liste ne dit que ce qui sert au travail : aucun Plan, aucune préparation,
 * aucun signal ; l'e-mail seulement à qui peut inviter (03_PRIVACY_RLS §19, §28).
 */
export const metadata = { title: 'Participants' };

type SearchParams = Record<string, string | string[] | undefined>;

function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}

export default async function ParticipantsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly organizationId: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { organizationId } = await params;
  const query = await searchParams;
  const eventSlug = typeof query.evenement === 'string' ? query.evenement : undefined;
  const yearParam = typeof query.edition === 'string' ? Number(query.edition) : undefined;
  const year = Number.isInteger(yearParam) ? yearParam : undefined;
  const importId = typeof query.import === 'string' ? query.import : undefined;

  const session = await requireSession(`/org/${organizationId}/participants`);
  const course = await getOrganizerCourse(sessionEventSiteContext(session), {
    organizationId,
    today: today(),
    ...(eventSlug === undefined ? {} : { eventSlug }),
    ...(year === undefined ? {} : { year }),
  });
  const { event, edition, permissions } = course;
  const context = participantImportContext(session);

  const list =
    edition === null
      ? { total: 0, participants: [] }
      : await listEditionParticipants(context, { editionId: edition.id });
  // Owner et admin importent ; le même rang que la base (0060).
  const canImport = permissions.canPublish;
  const current =
    importId === undefined || !canImport
      ? null
      : await getParticipantImport(context, { importId });

  const selection = new URLSearchParams({
    ...(event === null ? {} : { evenement: event.slug }),
    ...(edition === null ? {} : { edition: String(edition.year) }),
  }).toString();
  const scope = { organizationId, selection };
  const activated = list.participants.filter((participant) => participant.activated).length;
  const imported = typeof query.importes === 'string' ? query.importes : undefined;
  const ignored = typeof query.ignores === 'string' ? query.ignores : '0';

  const firstRow = current?.rows[0]?.data ?? {};
  const headers = current?.headers ?? [];
  const validCount = current?.counts['valid'] ?? 0;
  const errorCount = current?.counts['error'] ?? 0;
  const skippedCount = current?.counts['skipped'] ?? 0;

  return (
    <CourseFrame
      organizationId={organizationId}
      screen="participants"
      course={course}
      eyebrow="Participants"
      section="participants"
      body="Votre liste d’inscrits. Leur préparation reste la leur : vous n’y avez jamais accès."
      footer={
        <span className="or-summary">
          {`${String(list.total)} ${list.total > 1 ? 'participants' : 'participant'} · ${String(activated)} sur PLUKA`}
        </span>
      }
    >
      {imported === undefined ? null : (
        <p className="pk-body st-notice" role="status">
          {imported} {Number(imported) > 1 ? 'participants importés' : 'participant importé'}
          {ignored === '0' ? '.' : `, ${ignored} déjà dans la liste.`}
        </p>
      )}

      {edition === null ? (
        <section className="or-card">
          <p className="pk-body">Les participants se rattachent à une édition : il n’y en a pas encore.</p>
        </section>
      ) : current !== null && current.status === 'mapping' ? (
        <section aria-labelledby="import-columns" className="or-card">
          <h2 id="import-columns" className="pk-h2">
            Vos colonnes
          </h2>
          <p className="pk-body">
            {current.fileName ?? 'Votre fichier'} : {current.rows.length}{' '}
            {current.rows.length > 1 ? 'lignes' : 'ligne'}. PLUKA propose une correspondance, à vous
            de la vérifier.
          </p>
          <ColumnsForm
            scope={scope}
            importId={current.id}
            eventSlug={event?.slug ?? ''}
            year={edition.year}
            headers={headers}
            columns={{ ...suggestColumns(headers), ...current.columns }}
            samples={firstRow}
          />
          <p className="pk-field-hint">
            Sexe, date de naissance, nationalité et indices sont conservés à part : vous ne les
            reverrez pas, ils ne serviront qu’à des analyses d’ensemble. Importez uniquement ce que
            vos participants ont accepté de vous confier.
          </p>
          <DiscardImportForm scope={scope} importId={current.id} />
        </section>
      ) : current !== null && current.status === 'validating' ? (
        <section aria-labelledby="import-check" className="or-card">
          <h2 id="import-check" className="pk-h2">
            Vérification
          </h2>
          <p className="pk-body">
            {validCount} {validCount > 1 ? 'lignes prêtes' : 'ligne prête'}
            {errorCount === 0 ? '' : `, ${String(errorCount)} à corriger`}
            {skippedCount === 0 ? '' : `, ${String(skippedCount)} en double`}.
          </p>
          {current.exceptions.length === 0 ? null : (
            <ul className="cr-facts">
              {current.exceptions.map((exception) => (
                <li key={exception.rowNumber} className="cr-fact">
                  <span className="cr-fact-value">Ligne {exception.rowNumber + 1}</span>
                  <span className="or-row-meta">{exception.message}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="pk-field-hint">
            Les lignes à corriger ne sont pas importées : corrigez votre fichier et relancez, celles
            déjà importées ne seront pas doublées.
          </p>
          <div className="or-inline-form">
            <CommitImportForm scope={scope} importId={current.id} count={validCount} />
            <DiscardImportForm scope={scope} importId={current.id} />
          </div>
        </section>
      ) : canImport ? (
        <section aria-labelledby="import-file" className="or-card">
          <h2 id="import-file" className="pk-h2">
            Importer vos inscrits
          </h2>
          <ImportFileForm scope={scope} editionId={edition.id} />
        </section>
      ) : (
        <p className="pk-body st-readonly">
          Un propriétaire ou un administrateur importe la liste.
        </p>
      )}

      {edition === null ? null : (
        <section aria-labelledby="participants-list" className="or-card">
          <h2 id="participants-list" className="pk-h2">
            Liste
          </h2>
          {list.participants.length === 0 ? (
            <p className="pk-field-hint">Aucun participant pour l’édition {edition.year}.</p>
          ) : (
            <>
              <ul className="cr-facts">
                {list.participants.map((participant) => (
                  <li key={participant.id} className="cr-fact">
                    <div className="cr-fact-head">
                      <span className="cr-fact-value">
                        {[participant.firstName, participant.lastName]
                          .filter((part) => part !== null)
                          .join(' ') || 'Sans nom'}
                      </span>
                      <StatusBadge tone={participant.activated ? 'success' : 'neutral'}>
                        {participant.activated ? 'Sur PLUKA' : 'Importé'}
                      </StatusBadge>
                    </div>
                    <span className="or-row-meta">
                      {[
                        participant.raceName,
                        ...(participant.bib === null ? [] : [`Dossard ${participant.bib}`]),
                        ...(participant.waveName === null ? [] : [participant.waveName]),
                        ...(participant.email === null ? [] : [participant.email]),
                      ].join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
              {list.total <= list.participants.length ? null : (
                <p className="pk-field-hint">
                  Les {list.participants.length} premiers sur {list.total}.
                </p>
              )}
            </>
          )}
        </section>
      )}

      {imported === undefined ? null : (
        <p className="pk-body">
          <Link href={`/org/${organizationId}/participants?${selection}`} className="pk-link">
            Fermer ce message
          </Link>
        </p>
      )}
    </CourseFrame>
  );
}
