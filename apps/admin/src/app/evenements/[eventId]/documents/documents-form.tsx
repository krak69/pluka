'use client';

import { useActionState } from 'react';

import type { ActionState } from '@/app/actions';
import { analyzeDocumentsAction } from '@/app/discovery-actions';
import { AdminIcon } from '@/components/admin-icon';

/**
 * Documents de course — étape 4 de la création (0040, 0042).
 *
 * Les pages et documents relevés sur le site sont proposés, ceux de course cochés d'office ;
 * un fichier du poste s'ajoute dans le même envoi. Chaque document peut
 * concerner une épreuve, ou toute l'édition. Aucune règle ici : la commande
 * est validée par le domaine, la garde est en base.
 */

export interface FoundDocument {
  readonly url: string;
  readonly title: string;
  readonly kind: 'pdf' | 'page';
  readonly checked: boolean;
}

export interface RaceOption {
  readonly id: string;
  readonly name: string;
}

const INITIAL: ActionState = {};

function RaceScope({
  id,
  name,
  races,
  label,
}: {
  readonly id: string;
  readonly name: string;
  readonly races: readonly RaceOption[];
  readonly label: string;
}) {
  if (races.length < 2) return null;

  return (
    <span className="ad-doc-scope">
      <label htmlFor={id} className="ad-visually-hidden">
        {label}
      </label>
      <select id={id} name={name} className="pk-input" defaultValue="">
        <option value="">Toutes les épreuves</option>
        {races.map((race) => (
          <option key={race.id} value={race.id}>
            {race.name}
          </option>
        ))}
      </select>
    </span>
  );
}

export function DocumentsForm({
  eventId,
  editionId,
  found,
  races,
}: {
  readonly eventId: string;
  readonly editionId: string;
  readonly found: readonly FoundDocument[];
  readonly races: readonly RaceOption[];
}) {
  const [state, action, pending] = useActionState(analyzeDocumentsAction, INITIAL);

  return (
    <form action={action} className="ad-org-panel" aria-labelledby="documents-title">
      <h2 id="documents-title" className="ad-org-panel-title">
        Pages et documents à analyser
      </h2>
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="editionId" value={editionId} />

      {found.length === 0 ? null : (
        <ul className="ad-docs">
          {found.map((document, index) => (
            <li key={document.url} className="ad-doc">
              <label className="ad-doc-choice">
                <input
                  type="checkbox"
                  name="documents"
                  value={`${document.kind}|${document.url}|${document.title}`}
                  defaultChecked={document.checked}
                />
                <AdminIcon name={document.kind === 'pdf' ? 'FilePdf' : 'Globe'} size={18} />
                <span className="ad-doc-title">{document.title}</span>
                <span className="ad-row-meta">
                  {document.kind === 'pdf'
                    ? `PDF · ${new URL(document.url).hostname}`
                    : 'Page du site'}
                </span>
              </label>
              <RaceScope
                id={`scope-${index}`}
                name={`scope.${document.url}`}
                races={races}
                label={`Épreuve concernée par ${document.title}`}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="ad-doc-upload">
        <label htmlFor="documents-files" className="pk-field-label">
          <AdminIcon name="UploadSimple" size={16} /> Ajouter un fichier — règlement, guide coureur,
          programme (PDF)
        </label>
        <input
          id="documents-files"
          name="files"
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="pk-input"
        />
        <RaceScope
          id="files-scope"
          name="filesScope"
          races={races}
          label="Épreuve concernée par les fichiers déposés"
        />
        {state.fieldErrors?.['file'] === undefined ? null : (
          <p className="pk-field-error">{state.fieldErrors['file']}</p>
        )}
      </div>

      <div className="ad-form-actions">
        <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
          {pending ? 'Envoi…' : 'Analyser les documents'}
        </button>
      </div>

      {state.error === undefined ? null : (
        <p className="pk-field-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
