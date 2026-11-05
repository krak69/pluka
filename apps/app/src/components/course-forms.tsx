'use client';

import { Input } from '@pluka/ui';
import { useActionState, useId } from 'react';

import {
  addDocumentFileAction,
  addDocumentLinkAction,
  publishCandidateAction,
  rejectCandidateAction,
  restoreFactAction,
  retireFactAction,
  reviseFactAction,
  type CourseActionState,
} from '@/app/course-actions';

/**
 * Les gestes de Ma course · Informations. Client parce que `useActionState` rend
 * le refus à côté du geste. Aucune règle ici : tout se tranche côté serveur.
 */

const INITIAL: CourseActionState = {};

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

function ActionError({ state }: { readonly state: CourseActionState }) {
  if (state.error === undefined) return null;
  return (
    <p className="pk-field-error" role="alert">
      {state.error}
    </p>
  );
}

export function ReviseFactForm({
  scope,
  factId,
  valueText,
  valueNumber,
  unit,
}: {
  readonly scope: Scope;
  readonly factId: string;
  readonly valueText: string | null;
  readonly valueNumber: number | null;
  readonly unit: string | null;
}) {
  const [state, action, pending] = useActionState(reviseFactAction, INITIAL);
  const id = useId();
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="cr-revise">
      <ScopeFields {...scope} />
      <input type="hidden" name="factId" value={factId} />
      <input type="hidden" name="originalText" value={valueText ?? ''} />
      <input
        type="hidden"
        name="originalNumber"
        value={valueNumber === null ? '' : String(valueNumber).replace('.', ',')}
      />
      <input type="hidden" name="originalUnit" value={unit ?? ''} />
      {valueNumber === null ? (
        <>
          <div className="pk-field">
            <label className="pk-field-label" htmlFor={`${id}-text`}>
              Valeur
            </label>
            <textarea
              id={`${id}-text`}
              name="valueText"
              className="pk-input st-textarea"
              rows={3}
              maxLength={4000}
              defaultValue={valueText ?? ''}
            />
            {errors['valueText'] === undefined ? null : (
              <p className="pk-field-error">{errors['valueText']}</p>
            )}
          </div>
          <input type="hidden" name="unit" value={unit ?? ''} />
        </>
      ) : (
        <div className="cr-revise-number">
          <input type="hidden" name="valueText" value={valueText ?? ''} />
          <Input
            id={`${id}-number`}
            name="valueNumber"
            label="Valeur"
            inputMode="decimal"
            defaultValue={String(valueNumber).replace('.', ',')}
            error={errors['valueNumber']}
          />
          <Input id={`${id}-unit`} name="unit" label="Unité" maxLength={20} defaultValue={unit ?? ''} />
        </div>
      )}
      <div className="or-inline-form">
        <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
          {pending ? 'Publication…' : 'Publier la correction'}
        </button>
      </div>
      <p className="pk-field-hint">
        La correction crée une nouvelle version : l’ancienne reste dans l’historique.
      </p>
      <ActionError state={state} />
    </form>
  );
}

export function RetireFactForm({
  scope,
  factId,
  label,
}: {
  readonly scope: Scope;
  readonly factId: string;
  readonly label: string;
}) {
  const [state, action, pending] = useActionState(retireFactAction, INITIAL);

  return (
    <form action={action} className="or-inline-form">
      <ScopeFields {...scope} />
      <input type="hidden" name="factId" value={factId} />
      <button
        type="submit"
        className="pk-btn pk-button-secondary"
        disabled={pending}
        aria-label={`Confirmer le retrait : ${label}`}
      >
        Confirmer le retrait
      </button>
      <ActionError state={state} />
    </form>
  );
}

export function RestoreFactForm({
  scope,
  factId,
  label,
}: {
  readonly scope: Scope;
  readonly factId: string;
  readonly label: string;
}) {
  const [state, action, pending] = useActionState(restoreFactAction, INITIAL);

  return (
    <form action={action} className="or-inline-form">
      <ScopeFields {...scope} />
      <input type="hidden" name="factId" value={factId} />
      <button
        type="submit"
        className="pk-btn pk-button-secondary"
        disabled={pending}
        aria-label={`Restaurer : ${label}`}
      >
        Restaurer
      </button>
      <ActionError state={state} />
    </form>
  );
}

export function CandidateForms({
  scope,
  candidateId,
  conflicting,
  label,
}: {
  readonly scope: Scope;
  readonly candidateId: string;
  readonly conflicting: boolean;
  readonly label: string;
}) {
  const [publishState, publish, publishing] = useActionState(publishCandidateAction, INITIAL);
  const [rejectState, reject, rejecting] = useActionState(rejectCandidateAction, INITIAL);

  return (
    <div className="cr-candidate-actions">
      <form action={publish}>
        <ScopeFields {...scope} />
        <input type="hidden" name="candidateId" value={candidateId} />
        <input type="hidden" name="resolveConflict" value={String(conflicting)} />
        <button
          type="submit"
          className="pk-btn pk-button-secondary"
          disabled={publishing || rejecting}
          aria-label={`${conflicting ? 'Remplacer la valeur publiée' : 'Publier'} : ${label}`}
        >
          {conflicting ? 'Remplacer la valeur publiée' : 'Publier'}
        </button>
      </form>
      <form action={reject}>
        <ScopeFields {...scope} />
        <input type="hidden" name="candidateId" value={candidateId} />
        <button
          type="submit"
          className="pk-btn pk-button-ghost"
          disabled={publishing || rejecting}
          aria-label={`Écarter : ${label}`}
        >
          Écarter
        </button>
      </form>
      <ActionError state={publishState} />
      <ActionError state={rejectState} />
    </div>
  );
}

export interface DocumentScope extends Scope {
  readonly editionId: string;
  readonly races: readonly { readonly id: string; readonly name: string }[];
}

function DocumentFields({ scope }: { readonly scope: DocumentScope }) {
  const id = useId();

  return (
    <>
      <ScopeFields organizationId={scope.organizationId} selection={scope.selection} />
      <input type="hidden" name="editionId" value={scope.editionId} />
      {scope.races.length < 2 ? (
        <input type="hidden" name="raceId" value="" />
      ) : (
        <div className="pk-field">
          <label className="pk-field-label" htmlFor={`${id}-race`}>
            Concerne
          </label>
          <select id={`${id}-race`} name="raceId" className="pk-input" defaultValue="">
            <option value="">Toutes les épreuves</option>
            {scope.races.map((race) => (
              <option key={race.id} value={race.id}>
                {race.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}

export function AddDocumentFileForm({ scope }: { readonly scope: DocumentScope }) {
  const [state, action, pending] = useActionState(addDocumentFileAction, INITIAL);
  const id = useId();

  return (
    <form action={action} className="cr-revise">
      <DocumentFields scope={scope} />
      <div className="pk-field">
        <label className="pk-field-label" htmlFor={`${id}-file`}>
          Fichier PDF
        </label>
        <input
          id={`${id}-file`}
          name="file"
          type="file"
          accept="application/pdf,.pdf"
          className="pk-input"
          disabled={pending}
          aria-describedby={`${id}-hint`}
          required
        />
        <p id={`${id}-hint`} className="pk-field-hint">
          Règlement, guide coureur… 25 Mo au plus.
        </p>
      </div>
      <div className="or-inline-form">
        <button type="submit" className="pk-btn pk-button-secondary" disabled={pending}>
          {pending ? 'Envoi…' : 'Déposer le PDF'}
        </button>
      </div>
      <ActionError state={state} />
    </form>
  );
}

export function AddDocumentLinkForm({ scope }: { readonly scope: DocumentScope }) {
  const [state, action, pending] = useActionState(addDocumentLinkAction, INITIAL);
  const id = useId();

  return (
    <form action={action} className="cr-revise" noValidate>
      <DocumentFields scope={scope} />
      <Input
        id={`${id}-url`}
        name="url"
        type="url"
        label="Page de votre site"
        placeholder="https://"
        hint="PLUKA lit cette page, et seulement elle."
        disabled={pending}
      />
      <div className="or-inline-form">
        <button type="submit" className="pk-btn pk-button-secondary" disabled={pending}>
          {pending ? 'Ajout…' : 'Ajouter la page'}
        </button>
      </div>
      <ActionError state={state} />
    </form>
  );
}
