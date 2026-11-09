import {
  getOrganizerCourse,
  getParticipantImport,
  isEditionParticipantsIncluded,
  listContactOptouts,
  listEditionParticipants,
  listParticipantInvitations,
  suggestColumns,
} from '@pluka/domain';
import { NavTabs, StatusBadge } from '@pluka/ui';
import Link from 'next/link';

import { CourseFrame } from '@/components/course-frame';
import {
  ColumnsForm,
  CommitImportForm,
  DiscardImportForm,
  ImportFileForm,
  ParticipantCorrection,
  SendInvitationsForm,
  WithdrawForm,
} from '@/components/participant-forms';
import { sessionEventSiteContext } from '@/lib/event-site-editing';
import { courseHref, participantImportContext } from '@/lib/organizer-course';
import {
  participantInvitationsEnabled,
  sessionParticipantInvitationContext,
} from '@/lib/participant-invitations';
import { requireSession } from '@/lib/session';

/**
 * Participants — 00_PRODUCT_SPEC §29.
 *
 * La liste d'une édition, et son import : fichier, colonnes, vérification. La
 * liste ne dit que ce qui sert au travail : aucun Plan, aucune préparation,
 * aucun signal ; l'e-mail seulement à qui peut inviter (03_PRIVACY_RLS §19, §28).
 * L'épreuve et le volet tiennent dans l'adresse : une correction y ramène. Une
 * vague à déclarer reste une mention neutre, pas une alerte : seul le dossard en
 * double met une ligne à vérifier.
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

function fullName(person: {
  readonly firstName: string | null;
  readonly lastName: string | null;
}): string {
  return (
    [person.firstName, person.lastName].filter((part) => part !== null).join(' ') || 'Sans nom'
  );
}

/** Ce que l'organisation voit d'une invitation : son état, jamais le lien (0069). */
const INVITATION_BADGES: Readonly<
  Record<string, { readonly label: string; readonly tone: 'neutral' | 'warning' | 'success' }>
> = {
  pending: { label: 'Envoi en cours', tone: 'neutral' },
  sent: { label: 'Invité', tone: 'neutral' },
  expired: { label: 'Invitation expirée', tone: 'warning' },
  revoked: { label: 'Importé', tone: 'neutral' },
};

/** Une case de la liste : son libellé ne se montre que lorsque les colonnes se replient. */
function Cell({ label, value }: { readonly label: string; readonly value: string | null }) {
  return (
    <span className="pa-cell">
      <span className="pa-cell-label">{label} </span>
      {value ?? '—'}
    </span>
  );
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
  const { event, edition, races, permissions } = course;
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
    importId === undefined || !canImport ? null : await getParticipantImport(context, { importId });

  // Coupé en production jusqu'à la validation juridique : sans le flag, rien ne change.
  const inviting = participantInvitationsEnabled() && edition !== null;
  const invitationContext = sessionParticipantInvitationContext(session);
  const [invitations, included, optouts] =
    !inviting || edition === null
      ? [[], false, []]
      : await Promise.all([
          listParticipantInvitations(invitationContext, { editionId: edition.id }),
          isEditionParticipantsIncluded(invitationContext, { editionId: edition.id }),
          listContactOptouts(invitationContext, { editionId: edition.id }),
        ]);
  // 0075 : ces adresses ont refusé d'être contactées ; aucun envoi ne les recontacte.
  const declined = new Set(optouts);
  const invitationOf = new Map(
    invitations.map((invitation) => [invitation.participantRaceId, invitation]),
  );
  const invitable = list.participants.filter((participant) => {
    if (participant.activated || participant.email === null || declined.has(participant.id)) {
      return false;
    }
    const invitation = invitationOf.get(participant.id);
    if (invitation === undefined || invitation.sendFailed) return true;
    return invitation.status !== 'pending' && invitation.status !== 'sent';
  }).length;
  const sentCount = typeof query.invitations === 'string' ? count(query.invitations) : null;

  const race = races.find((candidate) => candidate.slug === query.epreuve) ?? null;
  const rows =
    race === null
      ? list.participants
      : list.participants.filter((participant) => participant.raceId === race.id);
  const withdrawn =
    race === null
      ? list.withdrawn
      : list.withdrawn.filter((participant) => participant.raceName === race.name);
  const flagged = rows.filter((participant) => participant.bibConflict);
  const panels = [
    { panel: 'tous', label: `Tous (${String(race === null ? list.total : rows.length)})` },
    ...(flagged.length === 0
      ? []
      : [{ panel: 'a-verifier', label: `À vérifier (${String(flagged.length)})` }]),
    ...(withdrawn.length === 0
      ? []
      : [{ panel: 'retires', label: `Retirés (${String(withdrawn.length)})` }]),
  ];
  const panel = panels.find((item) => item.panel === query.volet)?.panel ?? 'tous';
  const shown = panel === 'a-verifier' ? flagged : rows;
  const pendingWaves = rows.filter((participant) => participant.declaredWaveName !== null).length;
  const href = (selected: { readonly race?: string | undefined; readonly panel?: string }) =>
    courseHref(
      organizationId,
      'participants',
      { event: event?.slug, year: edition?.year, ...selected },
      'participants',
    );

  const selection = new URLSearchParams({
    ...(event === null ? {} : { evenement: event.slug }),
    ...(edition === null ? {} : { edition: String(edition.year) }),
    ...(race === null ? {} : { epreuve: race.slug }),
    volet: panel,
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
      eyebrow="Participants"
      course={course}
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
          {outcome}{' '}
          <Link href={`/org/${organizationId}/participants?${selection}`} className="pk-link">
            Fermer
          </Link>
        </p>
      )}

      {sentCount === null ? null : (
        <p className="pk-body st-notice" role="status">
          {sentCount === 0
            ? 'Aucune invitation à envoyer : chaque participant avec une adresse est déjà invité ou sur PLUKA.'
            : `${plural(sentCount, 'invitation envoyée', 'invitations envoyées')} : les e-mails partent dans quelques minutes.`}{' '}
          <Link href={`/org/${organizationId}/participants?${selection}`} className="pk-link">
            Fermer
          </Link>
        </p>
      )}

      {refused.length === 0 ? null : (
        <section aria-labelledby="import-refused" className="pa-check">
          <h2 id="import-refused" className="pk-label">
            À corriger · {errorCount}{' '}
            {errorCount > 1 ? 'lignes non importées' : 'ligne non importée'}
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
          <p className="pk-body">
            Les participants se rattachent à une édition : il n’y en a pas encore.
          </p>
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
                  {plural(
                    effects.kept,
                    'correction à la main gardée',
                    'corrections à la main gardées',
                  )}
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
      ) : canImport ? null : (
        <p className="pk-body st-readonly">
          Un propriétaire ou un administrateur importe la liste.
        </p>
      )}

      {edition === null ? null : (
        <>
          {races.length < 2 ? null : (
            <nav aria-label="Épreuves" className="st-events">
              <Link
                href={href({})}
                className="st-event"
                aria-current={race === null ? 'page' : undefined}
              >
                Toutes
              </Link>
              {races.map((candidate) => (
                <Link
                  key={candidate.id}
                  href={href({ race: candidate.slug })}
                  className="st-event"
                  aria-current={candidate.id === race?.id ? 'page' : undefined}
                >
                  {candidate.name}
                </Link>
              ))}
            </nav>
          )}

          <NavTabs
            label="Volets de la liste"
            className="or-subnav"
            tabs={panels.map((item) => ({
              href: href({ race: race?.slug, panel: item.panel }),
              label: item.label,
              current: item.panel === panel,
            }))}
          />

          <section aria-labelledby="participants-list" className="or-card">
            <h2 id="participants-list" className="pk-h2">
              {panel === 'retires' ? 'Retirés' : panel === 'a-verifier' ? 'À vérifier' : 'Liste'}
            </h2>

            {canImport && current === null && panel === 'tous' ? (
              <div className="or-adds">
                <details className="st-details or-add" open={list.total === 0}>
                  <summary className="pk-btn pk-button-secondary">Importer des inscrits</summary>
                  <ImportFileForm scope={scope} editionId={edition.id} />
                </details>
                {inviting && list.total > 0 ? (
                  <details className="st-details or-add">
                    <summary className="pk-btn pk-button-secondary">
                      Inviter les participants
                    </summary>
                    <p className="pk-body">
                      Chaque participant reçoit un lien personnel, valable jusqu’au départ de son
                      épreuve. Son espace est déjà prérempli : il choisit son objectif et obtient
                      son Plan.
                    </p>
                    <p className="pk-field-hint">
                      {included
                        ? 'L’accès complet à la préparation leur est offert par votre organisation.'
                        : 'L’accès premium n’est pas inclus pour cette édition : ils démarrent avec la version gratuite.'}{' '}
                      Seules les épreuves publiées et pas encore parties sont concernées. Ne sont
                      pas invités : un participant retiré, déjà sur PLUKA, qui a refusé d’être
                      contacté, ou de moins de 15 ans d’après sa date de naissance.
                    </p>
                    {invitable === 0 ? (
                      <p className="pk-field-hint">
                        Tous les participants avec une adresse sont déjà invités ou sur PLUKA.
                      </p>
                    ) : (
                      <SendInvitationsForm
                        scope={scope}
                        editionId={edition.id}
                        label={`Inviter ${plural(invitable, 'participant', 'participants')}`}
                      />
                    )}
                  </details>
                ) : null}
              </div>
            ) : null}

            {panel === 'a-verifier' && canImport ? (
              <p className="pk-field-hint">
                Ces dossards apparaissent plusieurs fois : ouvrez Corriger sur chaque ligne.
              </p>
            ) : null}

            {panel === 'tous' && pendingWaves > 0 ? (
              <p className="pk-field-hint">
                {plural(
                  pendingWaves,
                  'participant attend que sa vague soit déclarée.',
                  'participants attendent que leur vague soit déclarée.',
                )}
              </p>
            ) : null}

            {panel === 'retires' ? (
              <p className="pk-field-hint">
                Ils ne sont plus dans la liste et leur trace est gardée. Un import ne les rétablit
                pas.
              </p>
            ) : null}

            {panel !== 'retires' && shown.length === 0 ? (
              <p className="pk-field-hint">
                {race === null
                  ? `Aucun participant pour l’édition ${String(edition.year)}.`
                  : `Aucun participant sur ${race.name}.`}
              </p>
            ) : (
              <>
                <div className="pa-head" aria-hidden="true">
                  <span>Participant</span>
                  <span>Épreuve</span>
                  <span>Dossard</span>
                  <span>Vague</span>
                  <span>Statut</span>
                  <span />
                </div>
                <ul className="pa-rows">
                  {panel === 'retires'
                    ? withdrawn.map((participant) => (
                        <li key={participant.id} className="pa-row">
                          <span className="pa-name">
                            <span className="cr-fact-value">{fullName(participant)}</span>
                          </span>
                          <Cell label="Épreuve" value={participant.raceName} />
                          <Cell label="Dossard" value={participant.bib} />
                          <Cell label="Vague" value={null} />
                          <span className="pa-badges">
                            <StatusBadge tone="neutral">Retiré</StatusBadge>
                          </span>
                          {canImport ? (
                            <WithdrawForm
                              scope={scope}
                              participantRaceId={participant.id}
                              withdrawn={false}
                            />
                          ) : null}
                        </li>
                      ))
                    : shown.map((participant) => {
                        const wave = participant.waveName ?? participant.declaredWaveName;

                        return (
                          <li
                            key={participant.id}
                            className={participant.bibConflict ? 'pa-row pa-flagged' : 'pa-row'}
                          >
                            <span className="pa-name">
                              <span className="cr-fact-value">{fullName(participant)}</span>
                              {participant.email === null ? null : (
                                <span className="or-row-meta">{participant.email}</span>
                              )}
                              {participant.bibConflict ? (
                                <span className="pa-flag">Dossard {participant.bib} en double</span>
                              ) : null}
                            </span>
                            <Cell label="Épreuve" value={participant.raceName} />
                            <Cell label="Dossard" value={participant.bib} />
                            <Cell
                              label="Vague"
                              value={
                                participant.declaredWaveName === null
                                  ? participant.waveName
                                  : `${participant.declaredWaveName} (à déclarer)`
                              }
                            />
                            <span className="pa-badges">
                              {participant.bibConflict ? (
                                <StatusBadge tone="warning">À vérifier</StatusBadge>
                              ) : null}
                              {(() => {
                                const invitation = participant.activated
                                  ? undefined
                                  : invitationOf.get(participant.id);
                                const badge =
                                  invitation === undefined
                                    ? null
                                    : invitation.sendFailed
                                      ? { label: 'Envoi en échec', tone: 'warning' as const }
                                      : (INVITATION_BADGES[invitation.status] ?? null);

                                return participant.activated ? (
                                  <StatusBadge tone="success">Sur PLUKA</StatusBadge>
                                ) : declined.has(participant.id) ? (
                                  <StatusBadge tone="neutral">A refusé d’être contacté</StatusBadge>
                                ) : (
                                  <StatusBadge tone={badge?.tone ?? 'neutral'}>
                                    {badge?.label ?? 'Importé'}
                                  </StatusBadge>
                                );
                              })()}
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
                                invite={
                                  inviting &&
                                  !participant.activated &&
                                  participant.email !== null &&
                                  !declined.has(participant.id) ? (
                                    <SendInvitationsForm
                                      scope={scope}
                                      editionId={edition.id}
                                      participantRaceId={participant.id}
                                      label={
                                        invitationOf.has(participant.id)
                                          ? 'Renvoyer l’invitation'
                                          : 'Inviter'
                                      }
                                    />
                                  ) : undefined
                                }
                              />
                            ) : null}
                          </li>
                        );
                      })}
                </ul>
                {panel === 'retires' || list.total <= list.participants.length ? null : (
                  <p className="pk-field-hint">
                    Les {list.participants.length} premiers sur {list.total}.
                  </p>
                )}
              </>
            )}
          </section>
        </>
      )}
    </CourseFrame>
  );
}
