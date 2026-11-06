import { getOrganizerCourse, listEditionDocuments } from '@pluka/domain';
import { StatusBadge, type StatusTone } from '@pluka/ui';
import Link from 'next/link';

import { AutoRefresh } from '@/components/auto-refresh';
import { AddDocumentFileForm, AddDocumentLinkForm } from '@/components/course-forms';
import { CourseFrame } from '@/components/course-frame';
import { sessionEventSiteContext } from '@/lib/event-site-editing';
import { courseDocumentsContext, courseHref } from '@/lib/organizer-course';
import { requireSession } from '@/lib/session';

/**
 * Ma course · Sources — 00_PRODUCT_SPEC §28.2.
 *
 * « Importer → PLUKA analyse → exceptions → validation humaine → publication ».
 * L'organisation fournit ses documents et voit où ils en sont ; ce qui en sort
 * l'attend dans Informations. Rien n'est publié d'ici, et le pipeline reste
 * caché : quatre états, pas d'étapes techniques (AGENTS §88).
 */
export const metadata = { title: 'Sources' };

type SearchParams = Record<string, string | string[] | undefined>;

const STATES: Readonly<Record<string, { label: string; tone: StatusTone }>> = {
  queued: { label: 'En attente', tone: 'neutral' },
  reading: { label: 'Analyse en cours', tone: 'warning' },
  done: { label: 'Analysé', tone: 'success' },
  failed: { label: 'Lecture impossible', tone: 'error' },
};

const NOTICES: Readonly<Record<string, string>> = {
  document: 'Document ajouté : PLUKA l’analyse.',
  'deja-ajoute': 'Cette adresse est déjà dans vos documents.',
  'fichier-deja-depose':
    'Ce fichier est déjà dans vos documents, avec le même contenu, peut-être sous un autre nom. Rien n’a été ajouté.',
};

function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}

export default async function CourseSourcesPage({
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
  const notice = typeof query.fait === 'string' ? NOTICES[query.fait] : undefined;

  const session = await requireSession(`/org/${organizationId}/course/sources`);
  const course = await getOrganizerCourse(sessionEventSiteContext(session), {
    organizationId,
    today: today(),
    ...(eventSlug === undefined ? {} : { eventSlug }),
    ...(year === undefined ? {} : { year }),
  });
  const { event, edition, races, permissions } = course;

  const record =
    edition === null
      ? { documents: [], pendingByCategory: [] }
      : await listEditionDocuments(courseDocumentsContext(session), { editionId: edition.id });

  // Une saisie de l'organisation n'est pas un document à analyser : elle ne finirait jamais.
  const documents = record.documents.filter(
    (document) => document.sourceType !== 'organizer_input' && document.sourceType !== 'manual',
  );
  const analysing = documents.some(
    (document) => document.state === 'queued' || document.state === 'reading',
  );
  const pending = record.pendingByCategory.reduce((total, item) => total + item.count, 0);
  const selection = new URLSearchParams({
    ...(event === null ? {} : { evenement: event.slug }),
    ...(edition === null ? {} : { edition: String(edition.year) }),
  }).toString();

  return (
    <CourseFrame
      organizationId={organizationId}
      screen="sources"
      course={course}
      body="Donnez vos documents à PLUKA : il y relève les informations, et vous décidez de ce qui est publié."
      footer={
        <span className="or-summary">
          {`${String(documents.length)} ${documents.length > 1 ? 'documents' : 'document'} · ${String(pending)} à vérifier`}
        </span>
      }
    >
      <AutoRefresh active={analysing} />

      {notice === undefined ? null : (
        <p className="pk-body st-notice" role="status">
          {notice}
        </p>
      )}

      {pending === 0 ? null : (
        <p className="pk-body st-notice">
          PLUKA a relevé {pending} {pending > 1 ? 'informations' : 'information'} à vérifier.{' '}
          <Link
            href={courseHref(organizationId, 'informations', {
              event: event?.slug,
              year: edition?.year,
            })}
            className="pk-link"
          >
            Les vérifier
          </Link>
        </p>
      )}

      {edition === null ? (
        <section className="or-card">
          <p className="pk-body">Les documents se rattachent à une édition : il n’y en a pas encore.</p>
        </section>
      ) : (
        <>
          {permissions.canEdit ? (
            <section aria-labelledby="add-document" className="or-card">
              <h2 id="add-document" className="pk-h2">
                Ajouter un document
              </h2>
              <div className="cr-add">
                <AddDocumentFileForm
                  scope={{
                    organizationId,
                    selection,
                    editionId: edition.id,
                    races: races.map((race) => ({ id: race.id, name: race.name })),
                  }}
                />
                <AddDocumentLinkForm
                  scope={{
                    organizationId,
                    selection,
                    editionId: edition.id,
                    races: races.map((race) => ({ id: race.id, name: race.name })),
                  }}
                />
              </div>
            </section>
          ) : (
            <p className="pk-body st-readonly">
              Votre rôle permet de voir les documents, pas d’en ajouter.
            </p>
          )}

          <section aria-labelledby="documents" className="or-card">
            <h2 id="documents" className="pk-h2">
              Vos documents
            </h2>
            {documents.length === 0 ? (
              <p className="pk-field-hint">
                Aucun document pour l’édition {edition.year}. Commencez par votre règlement.
              </p>
            ) : (
              <ul className="cr-facts">
                {documents.map((document) => {
                  const state = STATES[document.state] ?? STATES['queued'];
                  return (
                    <li key={document.sourceId} className="cr-fact">
                      <div className="cr-fact-head">
                        <span className="cr-fact-value">{document.title}</span>
                        {state === undefined ? null : (
                          <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                        )}
                      </div>
                      <span className="or-row-meta">
                        {[
                          document.uploaded ? 'Fichier' : document.url === null ? 'Saisie' : 'Page web',
                          document.raceName ?? 'Toutes les épreuves',
                          ...(document.state === 'done'
                            ? [
                                document.candidateCount === 0
                                  ? 'Aucune information relevée'
                                  : `${String(document.candidateCount)} ${document.candidateCount > 1 ? 'informations relevées' : 'information relevée'}`,
                              ]
                            : []),
                        ].join(' · ')}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </CourseFrame>
  );
}
