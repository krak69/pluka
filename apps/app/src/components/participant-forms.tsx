'use client';

import { PARTICIPANT_FIELDS } from '@pluka/domain';
import { useActionState, useEffect, useId, useRef } from 'react';

import {
  commitImportAction,
  correctParticipantAction,
  createImportAction,
  discardImportAction,
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
}: {
  readonly scope: Scope;
  readonly participantRaceId: string;
  readonly bib: string | null;
  readonly wave: string | null;
  readonly waves: readonly { readonly name: string; readonly official: boolean }[];
  readonly canWithdraw: boolean;
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
