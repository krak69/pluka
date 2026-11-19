import {
  DomainError,
  getAssistance,
  getEmergencyContact,
  type AssistanceOverview,
  type AssistanceStatus,
  type AssistantView,
  type RendezvousView,
} from '@pluka/domain';
import { SectionHeader } from '@pluka/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  addItemAction,
  addRendezvousAction,
  removeAssistantAction,
  removeItemAction,
  removeRendezvousAction,
  setInstructionsAction,
  setStatusAction,
} from '@/app/(shell)/courses/[participantRaceId]/assistance/actions';
import {
  ActionForm,
  AddPersonForm,
  EmergencyContactPanel,
  LinkPanel,
  PersonHeader,
} from '@/app/(shell)/courses/[participantRaceId]/assistance/assistance-forms';
import { Icon } from '@/components/icon';
import {
  NutritionSendAlert,
  NutritionSendStatus,
} from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-send';
import { sendLine, suppliedLines, type SendLine } from '@/lib/nutrition-format';
import { assistanceContext } from '@/lib/assistance';
import { formatClock, formatDistance } from '@/lib/plan-format';
import { requireSession } from '@/lib/session';

/**
 * Assistance — 00_PRODUCT_SPEC §15 ; prototype, `isCrew` ; décisions du
 * 2026-11-17.
 *
 * Le coureur dit d'abord s'il sera assisté (gratuit). Avec assistance, chaque
 * personne a ses rendez-vous aux points où l'organisation autorise
 * l'assistance, l'heure de passage lue dans le Plan, et ce qu'elle doit lui
 * donner. Personnes et rendez-vous demandent le Race Pass, et l'écran le dit
 * au lieu de masquer la section (04 §46). Pas de lien à partager ici : il
 * viendra avec la page privée de l'accompagnant.
 */
export const metadata = { title: 'Assistance' };

const STATUSES: readonly { value: AssistanceStatus; label: string }[] = [
  { value: 'enabled', label: 'Avec assistance' },
  { value: 'autonomous', label: 'Autonome' },
  { value: 'to_define', label: 'Je verrai plus tard' },
];

function passageDay(isoInstant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(new Date(isoInstant));
}

/** La liste Nutrition d'un rendez-vous, vue depuis l'Assistance ; nulle s'il n'y a rien. */
function sendOf(
  person: AssistanceOverview['people'][number],
  rendezvous: RendezvousView,
  timezone: string,
): SendLine | null {
  if (rendezvous.nutritionSend.status === 'none') return null;
  return sendLine(
    {
      rendezvousId: rendezvous.id,
      assistant: person.firstName,
      pointId: rendezvous.point?.id ?? '',
      pointName: rendezvous.point?.name ?? 'ce point',
      status: rendezvous.nutritionSend.status,
      sentAt: rendezvous.nutritionSend.sentAt,
      nothingToGive: rendezvous.nutrition.length === 0,
      sentLabels: rendezvous.nutritionSend.sentLabels,
      labels: rendezvous.nutritionSend.labels,
      clock: rendezvous.passage === null ? null : formatClock(rendezvous.passage.at, timezone),
    },
    timezone,
  );
}

function staleSends(overview: AssistanceOverview): SendLine[] {
  return overview.people.flatMap((person) =>
    person.rendezvous.flatMap((rendezvous) => {
      const line = sendOf(person, rendezvous, overview.timezone);
      return line?.status === 'stale' ? [line] : [];
    }),
  );
}

export default async function AssistancePage({
  params,
}: {
  readonly params: Promise<{ readonly participantRaceId: string }>;
}) {
  const { participantRaceId } = await params;
  const session = await requireSession(`/courses/${participantRaceId}/assistance`);

  const overview = await getAssistance(assistanceContext(session), { participantRaceId }).catch(
    (error: unknown) => {
      if (error instanceof DomainError && error.code === 'not_found') notFound();
      throw error;
    },
  );
  // Gratuit, et lu même en autonomie (0101).
  const emergency = await getEmergencyContact(assistanceContext(session), { participantRaceId });

  return (
    <div className="ap-page as-page">
      <SectionHeader eyebrow="Ma course" title="Assistance" />
      <p className="as-lead">Qui te retrouve, où, et avec quoi.</p>

      <section className="as-status" aria-labelledby="as-status-title">
        <h2 id="as-status-title" className="pk-label">
          Pendant la course
        </h2>
        <div className="as-status-choices">
          {STATUSES.map((choice) => (
            <ActionForm
              key={choice.value}
              action={setStatusAction}
              participantRaceId={participantRaceId}
            >
              <input type="hidden" name="status" value={choice.value} />
              <button
                type="submit"
                className="as-status-choice"
                aria-pressed={overview.status === choice.value}
              >
                {choice.label}
              </button>
            </ActionForm>
          ))}
        </div>
      </section>

      {staleSends(overview).map((line) => (
        <NutritionSendAlert
          key={line.rendezvousId}
          participantRaceId={participantRaceId}
          line={line}
          canSend={overview.canEdit}
        />
      ))}

      {overview.status === 'autonomous' ? (
        <Autonomous participantRaceId={participantRaceId} />
      ) : overview.status === 'to_define' ? (
        <p className="as-note">
          Tu n’as pas encore dit si quelqu’un pourra te retrouver pendant la course. Rien ne bloque
          ta préparation.
        </p>
      ) : (
        <Crew participantRaceId={participantRaceId} overview={overview} />
      )}

      <section className="as-emergency" aria-labelledby="as-emergency-title">
        <h2 id="as-emergency-title" className="as-add-title">
          Contact d’urgence
        </h2>
        <p className="as-hint">
          La personne à joindre en cas de problème. Différente d’un accompagnant, et utile même en
          autonomie.
        </p>
        <EmergencyContactPanel
          participantRaceId={participantRaceId}
          contact={emergency.contact}
          raceName={emergency.raceName}
        />
      </section>
    </div>
  );
}

function Autonomous({ participantRaceId }: { readonly participantRaceId: string }) {
  const base = `/courses/${participantRaceId}`;
  return (
    <section className="as-note" aria-label="Autonomie">
      <p>
        Aucun accompagnant n’est prévu. Ton organisation reste complète : ravitaillements officiels,
        sacs autorisés et autonomie entre les points.
      </p>
      <div className="as-row-actions">
        <Link href={`${base}/course`} className="pk-btn pk-button-secondary">
          Ravitos et règlement
        </Link>
        <Link href={`${base}/preparation/sacs`} className="pk-btn pk-button-secondary">
          Mes sacs
        </Link>
      </div>
    </section>
  );
}

function Crew({
  participantRaceId,
  overview,
}: {
  readonly participantRaceId: string;
  readonly overview: AssistanceOverview;
}) {
  const base = `/courses/${participantRaceId}`;

  return (
    <>
      {overview.points.length === 0 ? (
        <p className="as-note">
          L’organisation n’a indiqué aucun point où l’assistance est autorisée. Tu pourras y poser
          des rendez-vous dès qu’elle l’aura fait.
        </p>
      ) : !overview.hasPlan ? (
        <p className="as-note">
          L’heure de chaque rendez-vous vient de ton Plan.{' '}
          <Link href={`${base}/objectif`}>Fixe ton objectif</Link> pour la voir.
        </p>
      ) : null}

      {overview.people.length === 0 ? null : (
        <ul className="as-people">
          {overview.people.map((person) => (
            <li key={person.id}>
              <Person participantRaceId={participantRaceId} person={person} overview={overview} />
            </li>
          ))}
        </ul>
      )}

      <section className="as-add" aria-labelledby="as-add-title">
        <h2 id="as-add-title" className="as-add-title">
          {overview.people.length === 0 ? 'Qui t’assiste ?' : 'Ajouter une personne'}
        </h2>
        {overview.canEdit ? (
          <AddPersonForm participantRaceId={participantRaceId} />
        ) : (
          <div className="eq-locked">
            <p>
              Note qui te retrouve, à quels points, et ce qu’il doit te donner : l’heure de chaque
              rendez-vous suit ton Plan. Tes accompagnants font partie de la préparation complète.
            </p>
            <Link
              href={`/offre?course=${participantRaceId}`}
              className="pk-btn pk-button-secondary"
            >
              Voir le Race Pass
            </Link>
          </div>
        )}
      </section>
    </>
  );
}

function Person({
  participantRaceId,
  person,
  overview,
}: {
  readonly participantRaceId: string;
  readonly person: AssistantView;
  readonly overview: AssistanceOverview;
}) {
  const used = new Set(person.rendezvous.map((entry) => entry.point?.id));
  const free = overview.points.filter((entry) => !used.has(entry.id));
  const name = [person.firstName, person.lastName].filter(Boolean).join(' ');

  return (
    <article className="as-person" aria-label={name}>
      <PersonHeader
        participantRaceId={participantRaceId}
        person={person}
        canEdit={overview.canEdit}
      />

      <LinkPanel
        participantRaceId={participantRaceId}
        person={person}
        link={person.link}
        canShare={overview.canShare}
      />

      {person.rendezvous.length === 0 ? (
        <p className="as-hint">Aucun rendez-vous pour l’instant.</p>
      ) : (
        <ol className="as-rendezvous-list">
          {person.rendezvous.map((rendezvous) => (
            <li key={rendezvous.id}>
              <Rendezvous
                participantRaceId={participantRaceId}
                rendezvous={rendezvous}
                timezone={overview.timezone}
                canEdit={overview.canEdit}
                send={sendOf(person, rendezvous, overview.timezone)}
              />
            </li>
          ))}
        </ol>
      )}

      {overview.canEdit && free.length > 0 ? (
        <ActionForm
          action={addRendezvousAction}
          participantRaceId={participantRaceId}
          className="as-inline-form"
        >
          <input type="hidden" name="assistantId" value={person.id} />
          <label className="pk-visually-hidden" htmlFor={`as-point-${person.id}`}>
            Point du rendez-vous avec {person.firstName}
          </label>
          <select id={`as-point-${person.id}`} name="pointId" className="pk-input" required>
            {free.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name} · km {formatDistance(entry.distanceKm)}
              </option>
            ))}
          </select>
          <button type="submit" className="pk-btn pk-button-secondary">
            Ajouter ce rendez-vous
          </button>
        </ActionForm>
      ) : null}

      {overview.canEdit ? (
        <ActionForm
          action={removeAssistantAction}
          participantRaceId={participantRaceId}
          className="as-remove-person"
        >
          <input type="hidden" name="assistantId" value={person.id} />
          <button type="submit" className="pk-btn pk-button-ghost">
            Retirer {person.firstName}
          </button>
        </ActionForm>
      ) : null}
    </article>
  );
}

const ISSUES = {
  removed: 'L’organisation a retiré ce point du parcours.',
  assistance_withdrawn:
    'L’organisation n’autorise plus l’assistance à ce point. Vérifie les consignes officielles.',
} as const;

function Rendezvous({
  participantRaceId,
  rendezvous,
  timezone,
  canEdit,
  send,
}: {
  readonly participantRaceId: string;
  readonly rendezvous: RendezvousView;
  readonly timezone: string;
  readonly canEdit: boolean;
  readonly send: SendLine | null;
}) {
  const where = rendezvous.point?.name ?? 'Point retiré';
  const passage = rendezvous.passage;

  return (
    <section className="as-rendezvous" aria-label={`Rendez-vous : ${where}`}>
      <header className="as-rendezvous-head">
        <span className="as-rendezvous-point">
          {where}
          {rendezvous.point === null ? null : (
            <span className="as-km"> · km {formatDistance(rendezvous.point.distanceKm)}</span>
          )}
        </span>
        {canEdit ? (
          <ActionForm action={removeRendezvousAction} participantRaceId={participantRaceId}>
            <input type="hidden" name="rendezvousId" value={rendezvous.id} />
            <button
              type="submit"
              className="td-icon td-icon-danger"
              aria-label={`Retirer le rendez-vous : ${where}`}
            >
              <Icon name="Trash" size={16} />
            </button>
          </ActionForm>
        ) : null}
      </header>

      {rendezvous.pointIssue === null ? null : (
        <p className="as-issue" role="note">
          {ISSUES[rendezvous.pointIssue]}
        </p>
      )}

      <dl className="as-passage">
        <div>
          <dt>Passage estimé</dt>
          <dd>
            {passage === null
              ? '—'
              : `${passageDay(passage.at, timezone)} · ${formatClock(passage.at, timezone)}`}
          </dd>
        </div>
        <div>
          <dt>Fenêtre probable</dt>
          <dd>
            {passage === null
              ? '—'
              : `${formatClock(passage.windowStart, timezone)} – ${formatClock(passage.windowEnd, timezone)}`}
          </dd>
        </div>
      </dl>
      {passage === null ? (
        <p className="as-hint">
          Ton Plan ne passe pas encore par ce point : mets-le à jour pour voir l’heure.
        </p>
      ) : null}

      <div className="as-give">
        <h3 className="pk-label">À me donner</h3>
        {rendezvous.nutrition.length === 0 ? null : (
          <ul className="as-items as-nutrition" aria-label="Nutrition, d’après ta stratégie">
            {suppliedLines(rendezvous.nutrition).map((line) => (
              <li key={line} className="as-item">
                <span>{line}</span>
                <span className="as-from">Nutrition</span>
              </li>
            ))}
          </ul>
        )}
        {send === null ? null : (
          <NutritionSendStatus
            participantRaceId={participantRaceId}
            line={send}
            canSend={canEdit}
          />
        )}
        {rendezvous.items.length === 0 ? (
          rendezvous.nutrition.length === 0 ? (
            <p className="as-hint">Rien de noté.</p>
          ) : null
        ) : (
          <ul className="as-items">
            {rendezvous.items.map((item) => (
              <li key={item.id} className="as-item">
                <span>{item.label}</span>
                {canEdit ? (
                  <ActionForm action={removeItemAction} participantRaceId={participantRaceId}>
                    <input type="hidden" name="itemId" value={item.id} />
                    <button
                      type="submit"
                      className="td-icon td-icon-danger"
                      aria-label={`Retirer : ${item.label}`}
                    >
                      <Icon name="X" size={16} />
                    </button>
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canEdit ? (
          <ActionForm
            action={addItemAction}
            participantRaceId={participantRaceId}
            className="as-inline-form"
            resetOnSuccess
          >
            <input type="hidden" name="rendezvousId" value={rendezvous.id} />
            <label className="pk-visually-hidden" htmlFor={`as-item-${rendezvous.id}`}>
              À me donner à {where}
            </label>
            <input
              id={`as-item-${rendezvous.id}`}
              name="label"
              className="pk-input"
              placeholder="Gourde pleine, chaussettes sèches…"
              maxLength={120}
              required
              autoComplete="off"
            />
            <button type="submit" className="pk-btn pk-button-secondary">
              Ajouter
            </button>
          </ActionForm>
        ) : null}
      </div>

      {canEdit ? (
        <ActionForm
          action={setInstructionsAction}
          participantRaceId={participantRaceId}
          className="as-instructions"
        >
          <input type="hidden" name="rendezvousId" value={rendezvous.id} />
          <label className="pk-label" htmlFor={`as-instructions-${rendezvous.id}`}>
            Consignes
          </label>
          <textarea
            id={`as-instructions-${rendezvous.id}`}
            name="instructions"
            className="pk-input as-textarea"
            rows={2}
            maxLength={1000}
            defaultValue={rendezvous.instructions ?? ''}
            placeholder="Où te garer, où m’attendre…"
          />
          <button type="submit" className="pk-btn pk-button-ghost">
            Enregistrer les consignes
          </button>
        </ActionForm>
      ) : rendezvous.instructions === null ? null : (
        <div className="as-instructions">
          <h3 className="pk-label">Consignes</h3>
          <p>{rendezvous.instructions}</p>
        </div>
      )}
    </section>
  );
}
