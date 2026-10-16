'use client';

import { Input } from '@pluka/ui';
import { useActionState, useId, useState } from 'react';

import {
  removeSiteImageAction,
  saveSiteAction,
  setSiteStatusAction,
  uploadSiteImageAction,
  type SiteActionState,
} from '@/app/site-actions';

/**
 * L'éditeur du site d'un événement — EVENT_SITE §4, §5.
 *
 * Client pour deux raisons : `useActionState` rend le refus à côté du geste,
 * et les blocs de texte s'ajoutent et se réordonnent sans aller-retour.
 * Aucune règle ici : contraste, formats, rôles sont tranchés côté serveur.
 */

const INITIAL: SiteActionState = {};

function FormError({ state }: { readonly state: SiteActionState }) {
  if (state.error === undefined) return null;
  return (
    <p className="pk-field-error" role="alert">
      {state.error}
    </p>
  );
}

export interface SiteFontOption {
  readonly value: string;
  readonly label: string;
  readonly family: string;
  readonly uppercase: boolean;
}

interface Section {
  readonly key: number;
  readonly title: string;
  readonly body: string;
}

const MAX_SECTIONS = 20;

export function SiteEditorForm({
  organizationId,
  eventId,
  eventSlug,
  eventName,
  canEdit,
  accentColor,
  defaultAccent,
  headingFont,
  fonts,
  contactEmail,
  sections: initialSections,
  edition,
  races,
}: {
  readonly organizationId: string;
  readonly eventId: string;
  readonly eventSlug: string;
  readonly eventName: string;
  readonly canEdit: boolean;
  readonly accentColor: string | null;
  readonly defaultAccent: string;
  readonly headingFont: string | null;
  readonly fonts: readonly SiteFontOption[];
  readonly contactEmail: string | null;
  readonly sections: readonly { readonly title: string; readonly body: string }[];
  readonly edition: { readonly id: string; readonly year: number; readonly registrationUrl: string | null } | null;
  readonly races: readonly { readonly id: string; readonly name: string; readonly registrationUrl: string | null }[];
}) {
  const [state, action, pending] = useActionState(saveSiteAction, INITIAL);
  const id = useId();
  const [accent, setAccent] = useState(accentColor ?? '');
  const [font, setFont] = useState(headingFont ?? '');
  const [sections, setSections] = useState<readonly Section[]>(() =>
    initialSections.map((section, index) => ({ key: index, ...section })),
  );
  const [nextKey, setNextKey] = useState(initialSections.length);
  const errors = state.fieldErrors ?? {};

  const previewFont = fonts.find((option) => option.value === font) ?? fonts[0];
  const shownAccent = /^#[0-9a-fA-F]{6}$/u.test(accent) ? accent : defaultAccent;

  const update = (key: number, patch: Partial<Omit<Section, 'key'>>) =>
    setSections((current) => current.map((section) => (section.key === key ? { ...section, ...patch } : section)));
  const move = (index: number, offset: number) =>
    setSections((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (moved !== undefined) next.splice(target, 0, moved);
      return next;
    });

  return (
    <form action={action} className="st-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="eventSlug" value={eventSlug} />

      <fieldset className="st-fieldset" disabled={!canEdit || pending}>
        <legend className="pk-h2">Identité</legend>

        <div className="st-identity">
          <div className="pk-field">
            <label className="pk-field-label" htmlFor={`${id}-accent`}>
              Couleur d’accent
            </label>
            <div className="st-color">
              <input
                type="color"
                aria-label="Choisir la couleur"
                value={shownAccent.toLowerCase()}
                onChange={(event) => setAccent(event.target.value)}
                className="st-color-picker"
              />
              <input
                id={`${id}-accent`}
                name="accentColor"
                className="pk-input st-color-text"
                value={accent}
                placeholder={`${defaultAccent} (PLUKA)`}
                onChange={(event) => setAccent(event.target.value)}
                aria-describedby={`${id}-accent-hint`}
                aria-invalid={errors['accentColor'] === undefined ? undefined : true}
                spellCheck={false}
              />
              {accent === '' ? null : (
                <button type="button" className="pk-btn pk-button-ghost" onClick={() => setAccent('')}>
                  Couleur PLUKA
                </button>
              )}
            </div>
            <p id={`${id}-accent-hint`} className="pk-field-hint">
              Elle colore le filet de l’en-tête et les boutons « S’inscrire ». Une couleur trop pâle
              ou trop proche du fond est refusée, pour que tout reste lisible.
            </p>
            {errors['accentColor'] === undefined ? null : (
              <p className="pk-field-error">{errors['accentColor']}</p>
            )}
          </div>

          <div className="pk-field">
            <label className="pk-field-label" htmlFor={`${id}-font`}>
              Police des titres
            </label>
            <select
              id={`${id}-font`}
              name="headingFont"
              className="pk-input"
              value={font}
              onChange={(event) => setFont(event.target.value)}
            >
              {fonts.map((option, index) => (
                <option key={option.value} value={index === 0 ? '' : option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="st-preview" aria-hidden="true" style={{ borderTopColor: shownAccent }}>
            <span
              className="st-preview-title"
              style={{
                fontFamily: previewFont?.family,
                textTransform: previewFont?.uppercase === true ? 'uppercase' : 'none',
              }}
            >
              {eventName}
            </span>
            <span className="st-preview-button" style={{ background: shownAccent }}>
              S’inscrire ↗
            </span>
          </div>
        </div>
      </fieldset>

      <fieldset className="st-fieldset" disabled={!canEdit || pending}>
        <legend className="pk-h2">Inscription</legend>
        {edition === null ? (
          <p className="pk-body">
            Aucune édition à venir ni passée : le lien d’inscription se règle une fois l’édition créée.
          </p>
        ) : (
          <>
            <input type="hidden" name="editionId" value={edition.id} />
            <p className="pk-body">
              PLUKA ne gère pas les inscriptions : le bouton « S’inscrire » mène à votre plateforme.
              Sans lien, il n’apparaît pas.
            </p>
            <Input
              id={`${id}-edition-url`}
              name="editionRegistrationUrl"
              type="url"
              label={`Lien d’inscription — édition ${String(edition.year)}`}
              placeholder="https://"
              defaultValue={edition.registrationUrl ?? ''}
              error={errors['registration.editionUrl']}
            />
            {races.length === 0 ? null : (
              <details className="st-details" open={races.some((race) => race.registrationUrl !== null)}>
                <summary>Un lien propre à une épreuve</summary>
                <p className="pk-field-hint">Laissé vide, l’épreuve prend le lien de l’édition.</p>
                {races.map((race, index) => (
                  <div key={race.id}>
                    <input type="hidden" name="raceId" value={race.id} />
                    <Input
                      id={`${id}-race-${race.id}`}
                      name="raceRegistrationUrl"
                      type="url"
                      label={race.name}
                      placeholder="Comme l’édition"
                      defaultValue={race.registrationUrl ?? ''}
                      error={errors[`registration.races.${String(index)}.url`]}
                    />
                  </div>
                ))}
              </details>
            )}
          </>
        )}
      </fieldset>

      <fieldset className="st-fieldset" disabled={!canEdit || pending}>
        <legend className="pk-h2">Infos pratiques</legend>
        <p className="pk-body">
          Dossards, transport et horaires de départ viennent déjà du règlement, avec leur source.
          Écrivez ici le reste : hébergement, stationnement, accueil des accompagnateurs.
        </p>
        <ol className="st-sections">
          {sections.map((section, index) => (
            <li key={section.key} className="st-section">
              <div className="st-section-head">
                <span className="st-section-index">{index + 1}</span>
                <div className="st-section-actions">
                  <button
                    type="button"
                    className="pk-btn pk-button-ghost"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={`Monter le bloc ${String(index + 1)}`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="pk-btn pk-button-ghost"
                    onClick={() => move(index, 1)}
                    disabled={index === sections.length - 1}
                    aria-label={`Descendre le bloc ${String(index + 1)}`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="pk-btn pk-button-ghost"
                    onClick={() => setSections((current) => current.filter((item) => item.key !== section.key))}
                  >
                    Retirer
                  </button>
                </div>
              </div>
              <Input
                id={`${id}-section-${String(section.key)}-title`}
                name="sectionTitle"
                label="Titre"
                maxLength={80}
                value={section.title}
                onChange={(event) => update(section.key, { title: event.target.value })}
                error={errors[`sections.${String(index)}.title`]}
              />
              <div className="pk-field">
                <label className="pk-field-label" htmlFor={`${id}-section-${String(section.key)}-body`}>
                  Texte
                </label>
                <textarea
                  id={`${id}-section-${String(section.key)}-body`}
                  name="sectionBody"
                  className="pk-input st-textarea"
                  rows={4}
                  maxLength={4000}
                  value={section.body}
                  onChange={(event) => update(section.key, { body: event.target.value })}
                />
                {errors[`sections.${String(index)}.body`] === undefined ? null : (
                  <p className="pk-field-error">{errors[`sections.${String(index)}.body`]}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
        {sections.length >= MAX_SECTIONS ? (
          <p className="pk-field-hint">20 blocs au plus.</p>
        ) : (
          <div>
            <button
              type="button"
              className="pk-btn pk-button-secondary"
              onClick={() => {
                setSections((current) => [...current, { key: nextKey, title: '', body: '' }]);
                setNextKey((key) => key + 1);
              }}
            >
              Ajouter un bloc
            </button>
          </div>
        )}
      </fieldset>

      <fieldset className="st-fieldset" disabled={!canEdit || pending}>
        <legend className="pk-h2">Contact</legend>
        <Input
          id={`${id}-contact`}
          name="contactEmail"
          type="email"
          label="Adresse qui reçoit les messages du site"
          defaultValue={contactEmail ?? ''}
          hint="Elle n’est jamais affichée sur le site. Le formulaire de contact arrive bientôt."
          error={errors['contactEmail']}
        />
      </fieldset>

      {canEdit ? (
        <div className="st-save">
          <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
            {pending ? 'Enregistrement…' : 'Enregistrer le site'}
          </button>
          <FormError state={state} />
        </div>
      ) : null}
    </form>
  );
}

export function SiteStatusForm({
  organizationId,
  eventId,
  eventSlug,
  status,
  label,
  primary,
}: {
  readonly organizationId: string;
  readonly eventId: string;
  readonly eventSlug: string;
  readonly status: 'published' | 'draft';
  readonly label: string;
  readonly primary: boolean;
}) {
  const [state, action, pending] = useActionState(setSiteStatusAction, INITIAL);

  return (
    <form action={action} className="or-inline-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <input type="hidden" name="status" value={status} />
      <button
        type="submit"
        className={`pk-btn ${primary ? 'pk-button-primary' : 'pk-button-secondary'}`}
        disabled={pending}
      >
        {label}
      </button>
      <FormError state={state} />
    </form>
  );
}

export function SiteImageForm({
  organizationId,
  eventId,
  eventSlug,
  kind,
  label,
  hint,
  currentUrl,
  canEdit,
}: {
  readonly organizationId: string;
  readonly eventId: string;
  readonly eventSlug: string;
  readonly kind: 'logo' | 'cover';
  readonly label: string;
  readonly hint: string;
  readonly currentUrl: string | null;
  readonly canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(uploadSiteImageAction, INITIAL);
  const [removeState, remove, removing] = useActionState(removeSiteImageAction, INITIAL);
  const id = useId();

  return (
    <div className="st-image" data-kind={kind}>
      <div className="st-image-preview">
        {currentUrl === null ? (
          <span className="st-image-empty">Aucune image</span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={currentUrl} alt={`${label} actuel`} />
        )}
      </div>
      <form action={action} className="st-image-form">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="eventSlug" value={eventSlug} />
        <input type="hidden" name="kind" value={kind} />
        <div className="pk-field">
          <label className="pk-field-label" htmlFor={`${id}-file`}>
            {label}
          </label>
          <input
            id={`${id}-file`}
            name="file"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="pk-input"
            disabled={!canEdit || pending}
            aria-describedby={`${id}-hint`}
            required
          />
          <p id={`${id}-hint`} className="pk-field-hint">
            {hint}
          </p>
        </div>
        {canEdit ? (
          <div className="or-inline-form">
            <button type="submit" className="pk-btn pk-button-secondary" disabled={pending}>
              {pending ? 'Envoi…' : 'Envoyer'}
            </button>
          </div>
        ) : null}
        <FormError state={state} />
      </form>
      {canEdit && currentUrl !== null ? (
        <form action={remove}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="eventSlug" value={eventSlug} />
          <input type="hidden" name="kind" value={kind} />
          <button type="submit" className="pk-btn pk-button-ghost" disabled={removing}>
            Retirer l’image
          </button>
          <FormError state={removeState} />
        </form>
      ) : null}
    </div>
  );
}
