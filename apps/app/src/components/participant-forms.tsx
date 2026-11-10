'use client';

import { PARTICIPANT_FIELDS } from '@pluka/domain';
import { useActionState, useEffect, useId, useRef } from 'react';

import {
  commitImportAction,
  correctParticipantAction,
  createImportAction,
  declareStartWaveAction,
  deleteStartWaveAction,
  updateStartWaveAction,
  discardImportAction,
  sendParticipantInvitationsAction,
  setParticipantWithdrawnAction,
  validateImportAction,
  type ParticipantActionState,
} from '@/app/participant-actions';

/** L'assistant d'import : un état de l'écran, pas des routes (05_ROUTES_FLOWS §6.2). */

const INITIAL: ParticipantActionState = {};

function ActionError({ state }: { readonly state: ParticipantActionState }) {
  if (state.error === undefined) return null;
  return (
    <p className="pk-field-error" role="alert">
      {state.error}
    </p>
  );
}

interface Scope {
  readonly organizationId: string;
  readonly selection: string;
}

function ScopeFields({ organizationId, selection }: Scope) {
  return (
    <>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="selection" value={selection} />
    </>
  );
}

export function ImportFileForm({
  scope,
  editionId,
}: {
  readonly scope: Scope;
  readonly editionId: string;
}) {
  const [state, action, pending] = useActionState(createImportAction, INITIAL);
  const id = useId();

  return (
    <form action={action} className="cr-revise">
      <ScopeFields {...scope} />
      <input type="hidden" name="editionId" value={editionId} />
      <div className="pk-field">
        <label className="pk-field-label" htmlFor={`${id}-file`}>
          Fichier CSV
        </label>
        <input
          id={`${id}-file`}
          name="file"
          type="file"
          accept=".csv,text/csv"
          className="pk-input"
          disabled={pending}
          aria-describedby={`${id}-hint`}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
          required
        />
        <p id={`${id}-hint`} className="pk-field-hint">
          {pending
            ? 'Lecture du fichier…'
            : 'L’export de votre plateforme d’inscription, 5 000 lignes au plus. Rien n’est importé avant votre confirmation.'}
        </p>
      </div>
      <ActionError state={state} />
    </form>
  );
}

export function ColumnsForm({
  scope,
  importId,
  eventSlug,
  year,
  headers,
  columns,
  samples,
}: {
  readonly scope: Scope;
  readonly importId: string;
  readonly eventSlug: string;
  readonly year: number;
  readonly headers: readonly string[];
  readonly columns: Readonly<Record<string, string>>;
  readonly samples: Readonly<Record<string, string>>;
}) {
  const [state, action, pending] = useActionState(validateImportAction, INITIAL);

  return (
    <form action={action} className="cr-revise">
      <ScopeFields {...scope} />
      <input type="hidden" name="importId" value={importId} />
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <input type="hidden" name="year" value={year} />
      <ul className="pa-columns">
        {PARTICIPANT_FIELDS.map((field) => (
          <li key={field.key} className="pa-column">
            <label className="pk-field-label" htmlFor={`column-${field.key}`}>
              {field.label}
              {field.required ? ' *' : ''}
            </label>
            <select
              id={`column-${field.key}`}
              name={`column.${field.key}`}
              className="pk-input"
              defaultValue={columns[field.key] ?? ''}
            >
              <option value="">— Ignorer</option>
              {headers.map((header) => (
                <option key={header} value={header}>
                  {header}
                  {samples[header] === undefined || samples[header] === ''
                    ? ''
                    : ` (ex. ${samples[header]})`}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
      <div className="or-inline-form">
        <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
          {pending ? 'Vérification…' : 'Vérifier les lignes'}
        </button>
      </div>
      <ActionError state={state} />
    </form>
  );
}

function commitLabel(created: number, updated: number): string {
  const add = `Importer ${String(created)} ${created > 1 ? 'participants' : 'participant'}`;
  const update = `Mettre à jour ${String(updated)} ${updated > 1 ? 'participants' : 'participant'}`;
  if (created === 0 && updated === 0) return 'Terminer sans rien changer';
  if (created === 0) return update;
  return updated === 0 ? add : `${add} et en mettre à jour ${String(updated)}`;
}

export function CommitImportForm({
  scope,
  importId,
  created,
  updated,
}: {
  readonly scope: Scope;
  readonly importId: string;
  readonly created: number;
  readonly updated: number;
}) {
  const [state, action, pending] = useActionState(commitImportAction, INITIAL);

  return (
    <form action={action} className="or-inline-form">
      <ScopeFields {...scope} />
      <input type="hidden" name="importId" value={importId} />
      <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
        {pending ? 'Import…' : commitLabel(created, updated)}
      </button>
      <ActionError state={state} />
    </form>
  );
}

/** Corriger une ligne : dossard et vague, puis le retrait pour qui n'a pas de compte. */
export function ParticipantCorrection({
  scope,
  participantRaceId,
  bib,
  wave,
  waves,
  canWithdraw,
  invite,
}: {
  readonly scope: Scope;
  readonly participantRaceId: string;
  readonly bib: string | null;
  readonly wave: string | null;
  readonly waves: readonly { readonly name: string; readonly official: boolean }[];
  readonly canWithdraw: boolean;
  /** Le renvoi de l'invitation, quand il a lieu d'être. */
  readonly invite?: React.ReactNode;
}) {
  const [state, action, pending] = useActionState(correctParticipantAction, INITIAL);
  const id = useId();
  const panel = useRef<HTMLDetailsElement>(null);

  // Enregistrer referme le panneau, même sans changement ; une erreur le laisse ouvert.
  useEffect(() => {
    if (state !== INITIAL && state.error === undefined && panel.current !== null) {
      panel.current.open = false;
    }
  }, [state]);

  function cancel(form: HTMLFormElement | null) {
    form?.reset();
    if (panel.current !== null) panel.current.open = false;
  }
  // La vague actuelle reste choisie même hors de la liste : enregistrer ne doit pas la vider.
  const options =
    wave === null || waves.some((option) => option.name === wave)
      ? waves
      : [{ name: wave, official: false }, ...waves];

  return (
    <details ref={panel} className="st-details pa-correction">
      <summary>Corriger</summary>
      <form action={action} className="pa-correction-form">
        <ScopeFields {...scope} />
        <input type="hidden" name="participantRaceId" value={participantRaceId} />
        <div className="pk-field">
          <label className="pk-field-label" htmlFor={`${id}-bib`}>
            Dossard
          </label>
          <input
            id={`${id}-bib`}
            name="bib"
            className="pk-input"
            defaultValue={bib ?? ''}
            maxLength={30}
          />
        </div>
        <div className="pk-field">
          <label className="pk-field-label" htmlFor={`${id}-wave`}>
            Vague
          </label>
          <select id={`${id}-wave`} name="wave" className="pk-input" defaultValue={wave ?? ''}>
            <option value="">Sans vague</option>
            {options.map((option) => (
              <option key={option.name} value={option.name}>
                {option.official ? option.name : `${option.name} (à déclarer)`}
              </option>
            ))}
          </select>
        </div>
        <div className="or-inline-form">
          <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
            {pending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          <button
            type="button"
            className="pk-btn pk-button-ghost"
            disabled={pending}
            onClick={(event) => cancel(event.currentTarget.form)}
          >
            Annuler
          </button>
        </div>
        <ActionError state={state} />
      </form>
      <p className="pk-field-hint">
        Une valeur choisie ici n’est jamais remplacée par un fichier. Laissée vide, un prochain
        import pourra la renseigner.
      </p>
      {invite}
      {canWithdraw ? (
        <details className="st-details or-danger">
          <summary>Retirer de la liste</summary>
          <p className="pk-field-hint">Sa trace est gardée, et il se rétablit à tout moment.</p>
          <WithdrawForm scope={scope} participantRaceId={participantRaceId} withdrawn />
        </details>
      ) : null}
    </details>
  );
}

/**
 * Inviter — sans participant : toute la liste à inviter ; avec : un renvoi.
 * La base dit combien sont partis, et l'écran le répète.
 */
export function SendInvitationsForm({
  scope,
  editionId,
  participantRaceId,
  label,
}: {
  readonly scope: Scope;
  readonly editionId: string;
  readonly participantRaceId?: string;
  readonly label: string;
}) {
  const [state, action, pending] = useActionState(sendParticipantInvitationsAction, INITIAL);

  return (
    <form action={action} className="or-inline-form">
      <ScopeFields {...scope} />
      <input type="hidden" name="editionId" value={editionId} />
      {participantRaceId === undefined ? null : (
        <input type="hidden" name="participantRaceId" value={participantRaceId} />
      )}
      <button
        type="submit"
        className={
          participantRaceId === undefined
            ? 'pk-btn pk-button-primary'
            : 'pk-btn pk-button-secondary'
        }
        disabled={pending}
      >
        {pending ? 'Envoi…' : label}
      </button>
      <ActionError state={state} />
    </form>
  );
}

export function WithdrawForm({
  scope,
  participantRaceId,
  withdrawn,
}: {
  readonly scope: Scope;
  readonly participantRaceId: string;
  /** L'état à atteindre : vrai retire, faux rétablit. */
  readonly withdrawn: boolean;
}) {
  const [state, action, pending] = useActionState(setParticipantWithdrawnAction, INITIAL);

  return (
    <form action={action} className="or-inline-form">
      <ScopeFields {...scope} />
      <input type="hidden" name="participantRaceId" value={participantRaceId} />
      <input type="hidden" name="withdrawn" value={String(withdrawn)} />
      <button type="submit" className="pk-btn pk-button-secondary" disabled={pending}>
        {withdrawn ? 'Confirmer le retrait' : 'Rétablir'}
      </button>
      <ActionError state={state} />
    </form>
  );
}

export function DiscardImportForm({
  scope,
  importId,
}: {
  readonly scope: Scope;
  readonly importId: string;
}) {
  const [state, action, pending] = useActionState(discardImportAction, INITIAL);

  return (
    <form action={action} className="or-inline-form">
      <ScopeFields {...scope} />
      <input type="hidden" name="importId" value={importId} />
      <button type="submit" className="pk-btn pk-button-ghost" disabled={pending}>
        Abandonner cet import
      </button>
      <ActionError state={state} />
    </form>
  );
}

/**
 * Déclarer une vague, ou la changer — migration 0081. Un nom et une heure de
 * départ, dans le fuseau de l'épreuve. Publier prévient les coureurs de la vague
 * dont le Plan en dépend : le texte le dit avant le geste.
 */
export function StartWaveForm({
  scope,
  raceId,
  waveId,
  timeZone,
  name,
  day,
  time,
  participants,
}: {
  readonly scope: Scope;
  readonly raceId: string;
  /** Absent : une déclaration. Présent : une nouvelle version de cette vague. */
  readonly waveId?: string;
  readonly timeZone: string;
  readonly name: string;
  readonly day: string;
  readonly time: string;
  readonly participants: number;
}) {
  const [state, action, pending] = useActionState(
    waveId === undefined ? declareStartWaveAction : updateStartWaveAction,
    INITIAL,
  );
  const id = useId();
  const panel = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (state !== INITIAL && state.error === undefined && panel.current !== null) {
      panel.current.open = false;
    }
  }, [state]);

  return (
    <details ref={panel} className="st-details pa-correction">
      <summary>
        {waveId !== undefined ? 'Modifier' : name === '' ? 'Ajouter une vague' : 'Déclarer'}
      </summary>
      <form action={action} className="pa-correction-form">
        <ScopeFields {...scope} />
        <input type="hidden" name="raceId" value={raceId} />
        {waveId === undefined ? null : <input type="hidden" name="waveId" value={waveId} />}
        <input type="hidden" name="timeZone" value={timeZone} />
        <div className="pk-field">
          <label className="pk-field-label" htmlFor={`${id}-name`}>
            Nom
          </label>
          <input
            id={`${id}-name`}
            name="name"
            className="pk-input"
            defaultValue={name}
            maxLength={120}
            required
          />
        </div>
        <div className="pk-field">
          <label className="pk-field-label" htmlFor={`${id}-day`}>
            Jour du départ
          </label>
          <input
            id={`${id}-day`}
            name="day"
            type="date"
            className="pk-input"
            defaultValue={day}
            required
          />
        </div>
        <div className="pk-field">
          <label className="pk-field-label" htmlFor={`${id}-time`}>
            Heure du départ
          </label>
          <input
            id={`${id}-time`}
            name="time"
            type="time"
            className="pk-input"
            defaultValue={time}
            required
          />
        </div>
        <p className="pk-field-hint">
          C’est une information officielle : elle s’affiche aux coureurs de l’épreuve.
          {participants === 0
            ? ''
            : ` Ceux de ses ${String(participants)} inscrits qui ont déjà un Plan sont prévenus que leur heure de départ ${waveId === undefined ? 'est fixée' : 'change'}, et choisissent de le recalculer.`}
        </p>
        <div>
          <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
            {waveId === undefined ? 'Publier la vague' : 'Publier la modification'}
          </button>
        </div>
        <ActionError state={state} />
      </form>
    </details>
  );
}

/**
 * Supprimer une vague — migration 0082. « Supprimer » a déjà ouvert ce panneau :
 * ce bouton est la confirmation. Ses coureurs repartent à l'heure de l'épreuve.
 */
export function DeleteStartWaveForm({
  scope,
  waveId,
  name,
  participants,
}: {
  readonly scope: Scope;
  readonly waveId: string;
  readonly name: string;
  readonly participants: number;
}) {
  const [state, action, pending] = useActionState(deleteStartWaveAction, INITIAL);

  return (
    <details className="st-details or-danger">
      <summary>Supprimer</summary>
      <form action={action} className="or-form">
        <ScopeFields {...scope} />
        <input type="hidden" name="waveId" value={waveId} />
        <p className="pk-field-hint">
          {participants === 0
            ? `La vague ${name} disparaît pour vos coureurs.`
            : `Ses ${String(participants)} inscrits repartent à l’heure de l’épreuve. Ceux qui sont sur PLUKA en sont prévenus par e-mail et dans leur compte.`}
        </p>
        <div>
          <button type="submit" className="pk-btn pk-button-destructive" disabled={pending}>
            Confirmer la suppression
          </button>
        </div>
        <ActionError state={state} />
      </form>
    </details>
  );
}
