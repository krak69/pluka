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
  ParticipantCorrection,
  WithdrawForm,
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

function count(value: string | string[] | undefined): number {
  const parsed = typeof value === 'string' ? Number(value) : 0;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function plural(value: number, one: string, many: string): string {
  return `${String(value)} ${value > 1 ? many : one}`;
}

/** Le bilan d'un import : un fichier repris compte ses mises à jour, pas seulement ses créations. */
function importOutcome(imported: string, query: SearchParams): string {
  const updated = count(query.majs);
  const ignored = count(query.ignores);
  const kept = count(query.gardes);
  const withdrawn = count(query.retires);

  return [
    plural(count(imported), 'participant importé', 'participants importés'),
    ...(updated === 0 ? [] : [`${String(updated)} mis à jour`]),
    ...(ignored === 0 ? [] : [`${String(ignored)} déjà dans la liste`]),
    ...(kept === 0
      ? []
      : [plural(kept, 'correction à la main gardée', 'corrections à la main gardées')]),
    ...(withdrawn === 0 ? [] : [plural(withdrawn, 'retiré, non rétabli', 'retirés, non rétablis')]),
  ]
    .join(', ')
    .concat('.');
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
      ? {
          total: 0,
          toCheck: { bibs: 0 },
          pendingWaves: 0,
          waveOptions: [],
          participants: [],
          withdrawn: [],
        }
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
  const outcome = imported === undefined ? null : importOutcome(imported, query);

  const firstRow = current?.rows[0]?.data ?? {};
  const headers = current?.headers ?? [];
  const effects = current?.effects;
  const validCount = current?.counts['valid'] ?? 0;
  const errorCount = current?.counts['error'] ?? 0;
  const skippedCount = current?.counts['skipped'] ?? 0;
  const refused =
    current?.status === 'imported'
      ? current.exceptions.filter((exception) => exception.status === 'error')
      : [];

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
      {outcome === null ? null : (
        <p className="pk-body st-notice" role="status">
          {outcome}
        </p>
      )}

      {refused.length === 0 ? null : (
        <section aria-labelledby="import-refused" className="pa-check">
          <h2 id="import-refused" className="pk-label">
            À corriger · {errorCount} {errorCount > 1 ? 'lignes non importées' : 'ligne non importée'}
          </h2>
          <ul className="cr-facts">
            {refused.map((exception) => (
              <li key={exception.rowNumber} className="cr-fact">
                <span className="cr-fact-value">Ligne {exception.rowNumber + 1}</span>
                <span className="or-row-meta">{exception.message}</span>
              </li>
            ))}
          </ul>
          <p className="pk-field-hint">
            {refused.length < errorCount
              ? `Les ${String(refused.length)} premières sur ${String(errorCount)}. `
              : ''}
            Corrigez ces lignes dans votre fichier et relancez l’import : les autres ne seront pas
            doublées.
          </p>
        </section>
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
          {effects === undefined || effects.created === validCount ? null : (
            <ul className="pa-effects">
              {effects.created === 0 ? null : (
                <li>{plural(effects.created, 'nouveau participant', 'nouveaux participants')}</li>
              )}
              {effects.updated === 0 ? null : (
                <li>{effects.updated} mis à jour : dossard ou vague</li>
              )}
              {effects.unchanged === 0 ? null : <li>{effects.unchanged} déjà à jour</li>}
              {effects.kept === 0 ? null : (
                <li>
                  {plural(effects.kept, 'correction à la main gardée', 'corrections à la main gardées')}
                  , le fichier dit autre chose
                </li>
              )}
              {effects.withdrawn === 0 ? null : (
                <li>{plural(effects.withdrawn, 'retiré, non rétabli', 'retirés, non rétablis')}</li>
              )}
            </ul>
          )}
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
          {current.unknownWaves.rows === 0 ? null : (
            <>
              <p className="pk-body">
                {current.unknownWaves.rows}{' '}
                {current.unknownWaves.rows > 1
                  ? 'lignes ont une vague inconnue'
                  : 'ligne a une vague inconnue'}{' '}
                sur cette édition. Ces coureurs seront importés et leur vague est gardée : elle se
                rattachera dès qu’elle sera déclarée sur l’épreuve. D’ici là, ils partent à l’heure
                de départ de l’épreuve.
              </p>
              <ul className="cr-facts">
                {current.unknownWaves.shown.map((group) => (
                  <li key={`${group.raceName}|${group.wave}`} className="cr-fact">
                    <span className="cr-fact-value">
                      {group.raceName} · {group.wave}
                    </span>
                    <span className="or-row-meta">
                      {group.rows} {group.rows > 1 ? 'lignes' : 'ligne'}
                    </span>
                  </li>
                ))}
              </ul>
              {current.unknownWaves.groups <= current.unknownWaves.shown.length ? null : (
                <p className="pk-field-hint">
                  {current.unknownWaves.shown.length} vagues sur {current.unknownWaves.groups}.
                  Vérifiez que la colonne Vague est la bonne.
                </p>
              )}
            </>
          )}
          <p className="pk-field-hint">
            Les lignes à corriger ne sont pas importées : corrigez votre fichier et relancez. Une
            personne déjà présente n’est jamais doublée, seuls son dossard et sa vague se
            complètent. Une case vide n’efface rien.
          </p>
          <div className="or-inline-form">
            <CommitImportForm
              scope={scope}
              importId={current.id}
              created={effects?.created ?? 0}
              updated={effects?.updated ?? 0}
            />
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
              {list.toCheck.bibs === 0 ? null : (
                <div className="pa-check">
                  <p className="pk-label">À vérifier</p>
                  <p className="pk-body">
                    {plural(
                      list.toCheck.bibs,
                      'participant avec un dossard en double',
                      'participants avec un dossard en double',
                    )}
                    {canImport ? ' : ouvrez Corriger sur leur ligne, en tête de liste.' : '.'}
                  </p>
                </div>
              )}
              {list.pendingWaves === 0 ? null : (
                <p className="pk-field-hint">
                  {plural(
                    list.pendingWaves,
                    'participant attend que sa vague soit déclarée.',
                    'participants attendent que leur vague soit déclarée.',
                  )}
                </p>
              )}
              <ul className="cr-facts">
                {list.participants.map((participant) => {
                  const wave = participant.waveName ?? participant.declaredWaveName;

                  return (
                    <li
                      key={participant.id}
                      className={participant.bibConflict ? 'cr-fact pa-flagged' : 'cr-fact'}
                    >
                      <div className="cr-fact-head">
                        <span className="cr-fact-value">
                          {[participant.firstName, participant.lastName]
                            .filter((part) => part !== null)
                            .join(' ') || 'Sans nom'}
                        </span>
                        <span className="pa-badges">
                          {participant.bibConflict ? (
                            <StatusBadge tone="warning">À vérifier</StatusBadge>
                          ) : null}
                          <StatusBadge tone={participant.activated ? 'success' : 'neutral'}>
                            {participant.activated ? 'Sur PLUKA' : 'Importé'}
                          </StatusBadge>
                        </span>
                      </div>
                      {participant.bibConflict ? (
                        <span className="pa-flag">Dossard {participant.bib} en double</span>
                      ) : null}
                      <span className="or-row-meta">
                        {[
                          participant.raceName,
                          ...(participant.bib === null ? [] : [`Dossard ${participant.bib}`]),
                          ...(participant.waveName === null ? [] : [participant.waveName]),
                          ...(participant.declaredWaveName === null
                            ? []
                            : [`${participant.declaredWaveName} (vague à déclarer)`]),
                          ...(participant.email === null ? [] : [participant.email]),
                        ].join(' · ')}
                      </span>
                      {canImport ? (
                        // La clé referme le panneau dès que la valeur enregistrée change.
                        <ParticipantCorrection
                          key={`${participant.bib ?? ''}|${wave ?? ''}`}
                          scope={scope}
                          participantRaceId={participant.id}
                          bib={participant.bib}
                          wave={wave}
                          waves={list.waveOptions.filter(
                            (option) => option.raceId === participant.raceId,
                          )}
                          canWithdraw={!participant.activated}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {list.total <= list.participants.length ? null : (
                <p className="pk-field-hint">
                  Les {list.participants.length} premiers sur {list.total}.
                </p>
              )}
            </>
          )}
          {list.withdrawn.length === 0 ? null : (
            <details className="st-details">
              <summary>Retirés ({list.withdrawn.length})</summary>
              <ul className="cr-facts">
                {list.withdrawn.map((participant) => (
                  <li key={participant.id} className="cr-fact">
                    <div className="cr-fact-head">
                      <span className="cr-fact-value">
                        {[participant.firstName, participant.lastName]
                          .filter((part) => part !== null)
                          .join(' ') || 'Sans nom'}
                      </span>
                      <StatusBadge tone="neutral">Retiré</StatusBadge>
                    </div>
                    <span className="or-row-meta">
                      {[
                        participant.raceName,
                        ...(participant.bib === null ? [] : [`Dossard ${participant.bib}`]),
                      ].join(' · ')}
                    </span>
                    {canImport ? (
                      <WithdrawForm
                        scope={scope}
                        participantRaceId={participant.id}
                        withdrawn={false}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
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
