import type { EditableFactRecord, FactCandidateReviewRecord } from '@pluka/db';
import { getOrganizerCourse, listCandidatesForReview, listRaceFactsForEditing } from '@pluka/domain';
import { TrustBadge } from '@pluka/ui';
import Link from 'next/link';

import {
  CandidateForms,
  RestoreFactForm,
  RetireFactForm,
  ReviseFactForm,
} from '@/components/course-forms';
import { CourseFrame } from '@/components/course-frame';
import { sessionEventSiteContext } from '@/lib/event-site-editing';
import {
  courseHref,
  factCategoryLabel,
  factEditingContext,
  factReviewContext,
  factValue,
} from '@/lib/organizer-course';
import { requireSession } from '@/lib/session';

/**
 * Ma course · Informations — 00_PRODUCT_SPEC §28.1.
 *
 * Ce que PLUKA sait officiellement de chaque épreuve. Les exceptions d'abord :
 * ce qui attend une décision, puis ce qui est publié. L'organisation ne
 * surveille pas de pipeline ; elle tranche ce qui le demande.
 */
export const metadata = { title: 'Ma course' };

type SearchParams = Record<string, string | string[] | undefined>;

const NOTICES: Readonly<Record<string, string>> = {
  corrigee: 'Correction publiée.',
  retiree: 'Information retirée : les coureurs ne la voient plus.',
  restauree: 'Information restaurée.',
  publiee: 'Information publiée.',
  ecartee: 'Proposition écartée.',
};

function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}

function sourceLabel(source: EditableFactRecord['source']): string | null {
  if (source === null) return null;
  return source.page === null ? source.title : `${source.title}, p. ${String(source.page)}`;
}

function Candidate({
  candidate,
  scope,
  canEdit,
}: {
  readonly candidate: FactCandidateReviewRecord;
  readonly scope: { readonly organizationId: string; readonly selection: string };
  readonly canEdit: boolean;
}) {
  const label = factCategoryLabel(candidate.category);
  const conflicting = candidate.status === 'conflict';

  return (
    <li className="or-topic" data-kind={conflicting ? 'todo' : 'check'}>
      <div className="or-topic-main">
        <p className="pk-label or-topic-kind">
          {conflicting ? 'Contradiction' : 'À vérifier'} · {label}
        </p>
        <h3 className="or-topic-title">{factValue(candidate)}</h3>
        {candidate.publishedValueText === null ? null : (
          <p className="pk-body">Publié aujourd’hui : {candidate.publishedValueText}</p>
        )}
        {candidate.excerpt === null ? null : (
          <p className="or-row-meta">
            « {candidate.excerpt} »
            {candidate.pageNumber === null ? '' : ` — page ${String(candidate.pageNumber)}`}
          </p>
        )}
      </div>
      {canEdit ? (
        <CandidateForms
          scope={scope}
          candidateId={candidate.candidateId}
          conflicting={conflicting}
          label={label}
        />
      ) : null}
    </li>
  );
}

function Fact({
  fact,
  scope,
  canEdit,
}: {
  readonly fact: EditableFactRecord;
  readonly scope: { readonly organizationId: string; readonly selection: string };
  readonly canEdit: boolean;
}) {
  const value = factValue(fact);
  const source = sourceLabel(fact.source);
  // Le matériel porte une exigence structurée : il se corrige depuis Épreuves.
  const editable = canEdit && fact.category !== 'equipment';

  return (
    <li className="cr-fact">
      <div className="cr-fact-head">
        <span className="cr-fact-value">{value}</span>
        <TrustBadge level={fact.trustLevel} />
      </div>
      {source === null ? null : <span className="or-row-meta">{source}</span>}
      {!editable ? null : (
        <div className="cr-fact-actions">
          <details className="st-details">
            <summary>Corriger</summary>
            <ReviseFactForm
              scope={scope}
              factId={fact.factId}
              valueText={fact.valueText}
              valueNumber={fact.valueNumber}
              unit={fact.unit}
            />
          </details>
          <details className="st-details">
            <summary>Retirer</summary>
            <p className="pk-field-hint">
              Elle disparaît pour les coureurs, et se restaure à tout moment.
            </p>
            <RetireFactForm scope={scope} factId={fact.factId} label={value} />
          </details>
        </div>
      )}
    </li>
  );
}

export default async function CourseInformationPage({
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
  const raceSlug = typeof query.epreuve === 'string' ? query.epreuve : undefined;
  const notice = typeof query.fait === 'string' ? NOTICES[query.fait] : undefined;

  const session = await requireSession(`/org/${organizationId}/course/informations`);
  const course = await getOrganizerCourse(sessionEventSiteContext(session), {
    organizationId,
    today: today(),
    ...(eventSlug === undefined ? {} : { eventSlug }),
    ...(year === undefined ? {} : { year }),
  });
  const { event, edition, races, permissions } = course;
  const race = races.find((candidate) => candidate.slug === raceSlug) ?? races[0] ?? null;

  const [facts, candidates] =
    race === null
      ? [[], []]
      : await Promise.all([
          listRaceFactsForEditing(factEditingContext(session), { raceId: race.id }),
          listCandidatesForReview(factReviewContext(session), { raceId: race.id, limit: 100 }),
        ]);

  const toDecide = candidates.filter((candidate) =>
    ['detected', 'needs_review', 'conflict'].includes(candidate.status),
  );
  const published = facts.filter((fact) => fact.archivedAt === null);
  const retired = facts.filter((fact) => fact.archivedAt !== null);
  const categories = [...new Set(published.map((fact) => fact.category))];

  const selection = new URLSearchParams({
    ...(event === null ? {} : { evenement: event.slug }),
    ...(edition === null ? {} : { edition: String(edition.year) }),
    ...(race === null ? {} : { epreuve: race.slug }),
  }).toString();
  const scope = { organizationId, selection };

  return (
    <CourseFrame
      organizationId={organizationId}
      screen="informations"
      course={course}
      body="Ce que PLUKA sait officiellement de vos épreuves, et ce qui attend votre décision."
      footer={
        <span className="or-summary">
          {`${String(races.length)} ${races.length > 1 ? 'épreuves' : 'épreuve'} · ${String(toDecide.length)} à vérifier`}
        </span>
      }
    >
      {notice === undefined ? null : (
        <p className="pk-body st-notice" role="status">
          {notice}
        </p>
      )}

      {permissions.canEdit ? null : (
        <p className="pk-body st-readonly">
          Votre rôle permet de voir ces informations, pas de les modifier.
        </p>
      )}

      {race === null ? (
        <section className="or-card">
          <p className="pk-body">Aucune épreuve dans cette édition pour l’instant.</p>
        </section>
      ) : (
        <div className="st-workspace">
          <div className="st-rail">
            <nav aria-label="Épreuves" className="st-tabs">
              {races.map((candidate) => (
                <Link
                  key={candidate.id}
                  href={courseHref(organizationId, 'informations', {
                    event: event?.slug,
                    year: edition?.year,
                    race: candidate.slug,
                  })}
                  className="st-tab"
                  aria-current={candidate.id === race.id ? 'true' : undefined}
                >
                  {candidate.name}
                </Link>
              ))}
            </nav>
          </div>

          <div className="st-panels">
            {toDecide.length === 0 ? null : (
              <section aria-labelledby="to-decide" className="or-attention">
                <h2 id="to-decide" className="pk-label">
                  À décider
                </h2>
                <ol>
                  {toDecide.map((candidate) => (
                    <Candidate
                      key={candidate.candidateId}
                      candidate={candidate}
                      scope={scope}
                      canEdit={permissions.canEdit}
                    />
                  ))}
                </ol>
              </section>
            )}

            {published.length === 0 ? (
              <section className="or-card">
                <h2 className="pk-h2">Rien de publié pour {race.name}</h2>
                <p className="pk-body">
                  Les informations arrivent quand PLUKA analyse vos documents : règlement, guide
                  coureur, site.
                </p>
              </section>
            ) : (
              categories.map((category) => (
                <section key={category} className="or-card">
                  <h2 className="pk-h2">{factCategoryLabel(category)}</h2>
                  <ul className="cr-facts">
                    {published
                      .filter((fact) => fact.category === category)
                      .map((fact) => (
                        <Fact
                          key={fact.factId}
                          fact={fact}
                          scope={scope}
                          canEdit={permissions.canEdit}
                        />
                      ))}
                  </ul>
                </section>
              ))
            )}

            {retired.length === 0 ? null : (
              <section className="or-card">
                <h2 className="pk-h2">Retirées</h2>
                <p className="pk-field-hint">
                  Invisibles des coureurs. Leur historique est conservé.
                </p>
                <ul className="cr-facts">
                  {retired.map((fact) => (
                    <li key={fact.factId} className="cr-fact">
                      <div className="cr-fact-head">
                        <span className="cr-fact-value">{factValue(fact)}</span>
                        <span className="or-row-meta">{factCategoryLabel(fact.category)}</span>
                      </div>
                      {permissions.canEdit ? (
                        <RestoreFactForm
                          scope={scope}
                          factId={fact.factId}
                          label={factValue(fact)}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}
    </CourseFrame>
  );
}
