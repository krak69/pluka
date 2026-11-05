'use client';

import { PARTICIPANT_FIELDS } from '@pluka/domain';
import { useActionState, useId } from 'react';

import {
  commitImportAction,
  createImportAction,
  discardImportAction,
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

export function CommitImportForm({
  scope,
  importId,
  count,
}: {
  readonly scope: Scope;
  readonly importId: string;
  readonly count: number;
}) {
  const [state, action, pending] = useActionState(commitImportAction, INITIAL);

  return (
    <form action={action} className="or-inline-form">
      <ScopeFields {...scope} />
      <input type="hidden" name="importId" value={importId} />
      <button type="submit" className="pk-btn pk-button-primary" disabled={pending || count === 0}>
        {pending
          ? 'Import…'
          : `Importer ${String(count)} ${count > 1 ? 'participants' : 'participant'}`}
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
