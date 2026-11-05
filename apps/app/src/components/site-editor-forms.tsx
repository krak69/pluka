'use client';

import { Input } from '@pluka/ui';
import { useActionState, useId, useState, type ReactNode } from 'react';

import {
  addSitePhotoAction,
  removeSiteImageAction,
  removeSitePhotoAction,
  saveSiteAction,
  setDocumentPublicAction,
  setSiteStatusAction,
  uploadSiteImageAction,
  type SiteActionState,
} from '@/app/site-actions';
import { WorkspaceTabs } from '@/components/workspace-tabs';

/**
 * L'éditeur du site d'un événement — EVENT_SITE §4, §5.
 *
 * Client pour trois raisons : `useActionState` rend le refus à côté du geste,
 * les blocs de texte s'ajoutent et se réordonnent sans aller-retour, et les
 * onglets montrent une partie du formulaire sans en démonter le reste : tout
 * reste dans le même formulaire, et un champ modifié survit à un changement
 * d'onglet.
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

const TABS = [
  { key: 'identite', label: 'Identité' },
  { key: 'presentation', label: 'Présentation' },
  { key: 'infos', label: 'Infos pratiques' },
  { key: 'galerie', label: 'Galerie et vidéo' },
  { key: 'documents', label: 'Documents' },
  { key: 'liens', label: 'Inscription et liens' },
  { key: 'contact', label: 'Contact' },
] as const;

type SiteTab = (typeof TABS)[number]['key'];

/** L'onglet qui porte un champ refusé : l'erreur ne reste pas cachée. */
function tabOfField(field: string): SiteTab {
  if (field === 'accentColor' || field === 'headingFont') return 'identite';
  if (field === 'contactEmail') return 'contact';
  if (field.startsWith('sections')) return 'infos';
  if (field.startsWith('registration') || field.startsWith('content.links')) return 'liens';
  if (field === 'content.video') return 'galerie';
  return 'presentation';
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
  readonly moment: string;
}

interface Topic {
  readonly key: string;
  readonly moment: string;
  readonly title: string;
  readonly hint: string;
  readonly factCategory: string | null;
}

interface ProgramRow {
  readonly key: number;
  readonly day: string;
  readonly time: string;
  readonly title: string;
  readonly location: string;
}

const MAX_PROGRAM_ROWS = 40;

/** La limite de la base, moins les rubriques proposées. */
const MAX_ADDED_SECTIONS = 9;
const FIGURE_SLOTS = [0, 1, 2, 3] as const;

const LINK_FIELDS = [
  { name: 'linkResults', key: 'results', label: 'Résultats' },
  { name: 'linkLive', key: 'live', label: 'Suivi en direct' },
  { name: 'linkVolunteers', key: 'volunteers', label: 'Devenir bénévole' },
  { name: 'linkNewsletter', key: 'newsletter', label: 'Newsletter' },
  { name: 'linkFacebook', key: 'facebook', label: 'Facebook' },
  { name: 'linkInstagram', key: 'instagram', label: 'Instagram' },
  { name: 'linkStrava', key: 'strava', label: 'Strava' },
] as const;

type SiteLinks = Readonly<Record<(typeof LINK_FIELDS)[number]['key'], string | null>>;

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
  moments,
  topics,
  presentation,
  venue,
  figures,
  links,
  program,
  showProgram,
  video,
  edition,
  races,
  checklist,
  initialTab,
  imagesPanel,
  galleryPanel,
  documentsPanel,
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
  readonly sections: readonly {
    readonly title: string;
    readonly body: string;
    readonly moment: string;
    readonly topicKey: string | null;
  }[];
  readonly moments: readonly { readonly value: string; readonly label: string }[];
  readonly topics: readonly Topic[];
  readonly presentation: string | null;
  readonly venue: string | null;
  readonly figures: readonly { readonly value: string; readonly label: string }[];
  readonly links: SiteLinks | null;
  readonly program: readonly {
    readonly day: string;
    readonly time: string;
    readonly title: string;
    readonly location: string | null;
  }[];
  readonly showProgram: boolean;
  readonly video: string | null;
  readonly edition: {
    readonly id: string;
    readonly year: number;
    readonly startDate: string;
    readonly registrationUrl: string | null;
  } | null;
  readonly races: readonly { readonly id: string; readonly name: string; readonly registrationUrl: string | null }[];
  readonly checklist: readonly {
    readonly tab: SiteTab;
    readonly label: string;
    readonly done: boolean;
  }[];
  /** La rubrique demandée par l'adresse, depuis l'accueil. */
  readonly initialTab: string | undefined;
  /* Ces trois panneaux portent leurs propres formulaires : ils restent hors du formulaire du site. */
  readonly imagesPanel: ReactNode;
  readonly galleryPanel: ReactNode;
  readonly documentsPanel: ReactNode;
}) {
  const [state, action, pending] = useActionState(saveSiteAction, INITIAL);
  const id = useId();
  const [tab, setTab] = useState<SiteTab>(
    () => TABS.find((item) => item.key === initialTab)?.key ?? 'identite',
  );
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    const firstField = Object.keys(state.fieldErrors ?? {})[0];
    if (firstField !== undefined) setTab(tabOfField(firstField));
  }
  const [accent, setAccent] = useState(accentColor ?? '');
  const [font, setFont] = useState(headingFont ?? '');
  const [topicBodies, setTopicBodies] = useState<Readonly<Record<string, string>>>(() =>
    Object.fromEntries(
      initialSections.flatMap((section) =>
        section.topicKey === null ? [] : [[section.topicKey, section.body]],
      ),
    ),
  );
  const [sections, setSections] = useState<readonly Section[]>(() =>
    initialSections
      .filter((section) => section.topicKey === null)
      .map((section, index) => ({
        key: index,
        title: section.title,
        body: section.body,
        moment: section.moment,
      })),
  );
  const [programRows, setProgramRows] = useState<readonly ProgramRow[]>(() =>
    program.map((item, index) => ({ key: index, ...item, location: item.location ?? '' })),
  );
  const [nextKey, setNextKey] = useState(initialSections.length + program.length);
  const errors = state.fieldErrors ?? {};
  // L'erreur d'une rubrique porte sa place parmi celles envoyées : les rubriques
  // proposées et remplies, puis les rubriques ajoutées.
  const filledTopics = topics.filter((topic) => (topicBodies[topic.key] ?? '').trim() !== '');

  // Même calcul pour le programme : une ligne vide n'est pas envoyée.
  const sentProgramRows = programRows.filter(
    (row) => `${row.time}${row.title}${row.location}`.trim() !== '',
  );
  const updateProgramRow = (key: number, patch: Partial<Omit<ProgramRow, 'key'>>) =>
    setProgramRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

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

  const tabsInError = new Set(Object.keys(errors).map(tabOfField));
  const doneCount = checklist.filter((item) => item.done).length;

  return (
    <div className="st-workspace">
      <div className="st-rail">
        <WorkspaceTabs
          label="Rubriques du site"
          current={tab}
          onSelect={setTab}
          tabs={TABS.map((item) => ({ ...item, alert: tabsInError.has(item.key) }))}
        />

        {doneCount === checklist.length ? null : (
          <div className="st-checklist">
            <p className="pk-label">
              À compléter · {String(doneCount)} sur {String(checklist.length)}
            </p>
            <ul>
              {checklist.map((item) => (
                <li key={item.label} data-done={item.done}>
                  <button type="button" onClick={() => setTab(item.tab)}>
                    <span aria-hidden="true">{item.done ? '✓' : '○'}</span> {item.label}
                    <span className="or-visually-hidden">{item.done ? ' : fait' : ' : à faire'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="st-panels">
        <div hidden={tab !== 'identite'}>{imagesPanel}</div>
        <div hidden={tab !== 'galerie'}>{galleryPanel}</div>
        <div hidden={tab !== 'documents'}>{documentsPanel}</div>

    {/* `noValidate` : un champ refusé par le navigateur dans un onglet caché bloquerait
        l'envoi sans rien dire. Le serveur valide, et l'erreur rouvre son onglet. */}
    <form action={action} className="st-form" hidden={tab === 'documents'} noValidate>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="eventSlug" value={eventSlug} />

      <fieldset className="st-fieldset" disabled={!canEdit || pending} hidden={tab !== 'identite'}>
        <legend className="pk-h2">Couleur et police</legend>

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

      <fieldset className="st-fieldset" disabled={!canEdit || pending} hidden={tab !== 'presentation'}>
        <legend className="pk-h2">Présentation</legend>
        <div className="pk-field">
          <label className="pk-field-label" htmlFor={`${id}-presentation`}>
            L’événement en quelques lignes
          </label>
          <textarea
            id={`${id}-presentation`}
            name="presentation"
            className="pk-input st-textarea"
            rows={6}
            maxLength={4000}
            defaultValue={presentation ?? ''}
            aria-describedby={`${id}-presentation-hint`}
          />
          <p id={`${id}-presentation-hint`} className="pk-field-hint">
            L’histoire de la course, son esprit, ce qui la rend unique.
          </p>
        </div>
        <Input
          id={`${id}-venue`}
          name="venue"
          label="Lieu du rendez-vous"
          maxLength={120}
          placeholder="Salle des fêtes, Lucenay"
          defaultValue={venue ?? ''}
          error={errors['content.venue']}
        />
        <div className="st-figures">
          <p className="pk-field-label">Chiffres clés, quatre au plus</p>
          {FIGURE_SLOTS.map((index) => (
            <div key={index} className="st-figure">
              <Input
                id={`${id}-figure-${String(index)}-value`}
                name="figureValue"
                label={`Chiffre ${String(index + 1)}`}
                maxLength={20}
                placeholder="600"
                defaultValue={figures[index]?.value ?? ''}
                error={errors[`content.figures.${String(index)}.value`]}
              />
              <Input
                id={`${id}-figure-${String(index)}-label`}
                name="figureLabel"
                label="Libellé"
                maxLength={60}
                placeholder="coureurs en 2026"
                defaultValue={figures[index]?.label ?? ''}
                error={errors[`content.figures.${String(index)}.label`]}
              />
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="st-fieldset" disabled={!canEdit || pending} hidden={tab !== 'galerie'}>
        <legend className="pk-h2">Vidéo</legend>
        <Input
          id={`${id}-video`}
          name="video"
          type="url"
          label="Vidéo YouTube ou Vimeo"
          placeholder="https://www.youtube.com/watch?v=…"
          hint="Elle s’affiche dans la galerie du site, et se charge quand le visiteur clique."
          defaultValue={video ?? ''}
          error={errors['content.video']}
        />
      </fieldset>

      <fieldset className="st-fieldset" disabled={!canEdit || pending} hidden={tab !== 'liens'}>
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

      <fieldset className="st-fieldset" disabled={!canEdit || pending} hidden={tab !== 'infos'}>
        <legend className="pk-h2">Infos pratiques</legend>
        <p className="pk-body">
          Remplissez ce qui vous concerne : une rubrique vide n’apparaît pas sur le site.
        </p>
        {moments.map((moment) => (
          <div key={moment.value} className="st-moment">
            <h3 className="pk-label">{moment.label}</h3>
            {topics
              .filter((topic) => topic.moment === moment.value)
              .map((topic) => {
                const body = topicBodies[topic.key] ?? '';
                const fieldId = `${id}-topic-${topic.key}`;
                const error =
                  errors[`sections.${String(filledTopics.indexOf(topic))}.body`];
                return (
                  <details key={topic.key} className="st-details" open={body.trim() !== ''}>
                    <summary>
                      {topic.title}
                      {body.trim() === '' ? null : <span className="st-filled"> · rempli</span>}
                    </summary>
                    <input type="hidden" name="topicKey" value={topic.key} />
                    <div className="pk-field">
                      <label className="pk-field-label" htmlFor={fieldId}>
                        {topic.title}
                      </label>
                      <textarea
                        id={fieldId}
                        name="topicBody"
                        className="pk-input st-textarea"
                        rows={3}
                        maxLength={4000}
                        value={body}
                        onChange={(event) =>
                          setTopicBodies((current) => ({ ...current, [topic.key]: event.target.value }))
                        }
                        aria-describedby={`${fieldId}-hint`}
                      />
                      <p id={`${fieldId}-hint`} className="pk-field-hint">
                        {topic.hint}
                        {topic.factCategory === null
                          ? null
                          : ' Ce qui est publié pour vos épreuves s’y affiche déjà : écrivez seulement le complément.'}
                      </p>
                      {error === undefined ? null : <p className="pk-field-error">{error}</p>}
                    </div>
                  </details>
                );
              })}
          </div>
        ))}
        <h3 className="pk-label">Vos rubriques</h3>
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
                    aria-label={`Monter la rubrique ${String(index + 1)}`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="pk-btn pk-button-ghost"
                    onClick={() => move(index, 1)}
                    disabled={index === sections.length - 1}
                    aria-label={`Descendre la rubrique ${String(index + 1)}`}
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
                error={errors[`sections.${String(filledTopics.length + index)}.title`]}
              />
              <div className="pk-field">
                <label className="pk-field-label" htmlFor={`${id}-section-${String(section.key)}-moment`}>
                  Moment
                </label>
                <select
                  id={`${id}-section-${String(section.key)}-moment`}
                  name="sectionMoment"
                  className="pk-input"
                  value={section.moment}
                  onChange={(event) => update(section.key, { moment: event.target.value })}
                >
                  {moments.map((moment) => (
                    <option key={moment.value} value={moment.value}>
                      {moment.label}
                    </option>
                  ))}
                </select>
              </div>
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
                {errors[`sections.${String(filledTopics.length + index)}.body`] === undefined ? null : (
                  <p className="pk-field-error">
                    {errors[`sections.${String(filledTopics.length + index)}.body`]}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
        {sections.length >= MAX_ADDED_SECTIONS ? (
          <p className="pk-field-hint">9 rubriques ajoutées au plus.</p>
        ) : (
          <div>
            <button
              type="button"
              className="pk-btn pk-button-secondary"
              onClick={() => {
                setSections((current) => [
                  ...current,
                  { key: nextKey, title: '', body: '', moment: 'before' },
                ]);
                setNextKey((key) => key + 1);
              }}
            >
              Ajouter une rubrique
            </button>
          </div>
        )}
      </fieldset>

      {edition === null || !showProgram ? null : (
        <fieldset className="st-fieldset" disabled={!canEdit || pending} hidden={tab !== 'presentation'}>
          <legend className="pk-h2">{`Programme ${String(edition.year)}`}</legend>
          <p className="pk-body">
            Retrait des dossards, briefing, remise des prix… Les départs de vos épreuves s’y ajoutent
            d’eux-mêmes : inutile de les écrire.
          </p>
          <ol className="st-sections">
            {programRows.map((row) => {
              const sent = sentProgramRows.indexOf(row);
              const fieldId = `${id}-program-${String(row.key)}`;
              const errorOf = (field: string) => errors[`program.${String(sent)}.${field}`];
              return (
                <li key={row.key} className="st-section">
                  <div className="st-program-row">
                    <Input
                      id={`${fieldId}-day`}
                      name="programDay"
                      type="date"
                      label="Jour"
                      value={row.day}
                      onChange={(event) => updateProgramRow(row.key, { day: event.target.value })}
                      error={errorOf('day')}
                    />
                    <Input
                      id={`${fieldId}-time`}
                      name="programTime"
                      type="time"
                      label="Heure"
                      value={row.time}
                      onChange={(event) => updateProgramRow(row.key, { time: event.target.value })}
                      error={errorOf('time')}
                    />
                    <Input
                      id={`${fieldId}-title`}
                      name="programTitle"
                      label="Intitulé"
                      maxLength={120}
                      value={row.title}
                      onChange={(event) => updateProgramRow(row.key, { title: event.target.value })}
                      error={errorOf('title')}
                    />
                    <Input
                      id={`${fieldId}-location`}
                      name="programLocation"
                      label="Lieu (facultatif)"
                      maxLength={120}
                      value={row.location}
                      onChange={(event) => updateProgramRow(row.key, { location: event.target.value })}
                      error={errorOf('location')}
                    />
                  </div>
                  <div>
                    <button
                      type="button"
                      className="pk-btn pk-button-ghost"
                      onClick={() =>
                        setProgramRows((current) => current.filter((item) => item.key !== row.key))
                      }
                      aria-label={`Retirer la ligne ${row.title === '' ? 'sans intitulé' : row.title}`}
                    >
                      Retirer
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          {programRows.length >= MAX_PROGRAM_ROWS ? (
            <p className="pk-field-hint">40 lignes au plus.</p>
          ) : (
            <div>
              <button
                type="button"
                className="pk-btn pk-button-secondary"
                onClick={() => {
                  setProgramRows((current) => [
                    ...current,
                    {
                      key: nextKey,
                      day: current.at(-1)?.day ?? edition.startDate,
                      time: '',
                      title: '',
                      location: '',
                    },
                  ]);
                  setNextKey((key) => key + 1);
                }}
              >
                Ajouter une ligne
              </button>
            </div>
          )}
        </fieldset>
      )}

      <fieldset className="st-fieldset" disabled={!canEdit || pending} hidden={tab !== 'liens'}>
        <legend className="pk-h2">Liens utiles</legend>
        <p className="pk-body">
          PLUKA ne remplace ni le chronométrage, ni le suivi en direct, ni votre newsletter : ces
          liens y mènent. Sans lien, rien n’apparaît.
        </p>
        <div className="st-links">
          {LINK_FIELDS.map((field) => (
            <Input
              key={field.name}
              id={`${id}-${field.name}`}
              name={field.name}
              type="url"
              label={field.label}
              placeholder="https://"
              defaultValue={links?.[field.key] ?? ''}
              error={errors[`content.links.${field.key}`]}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="st-fieldset" disabled={!canEdit || pending} hidden={tab !== 'contact'}>
        <legend className="pk-h2">Contact</legend>
        <Input
          id={`${id}-contact`}
          name="contactEmail"
          type="email"
          label="Adresse qui reçoit les messages du site"
          defaultValue={contactEmail ?? ''}
          hint="Elle n’est jamais affichée sur le site. Sans adresse, le site n’a pas de formulaire de contact."
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
      </div>
    </div>
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
        className={`pk-btn ${primary ? 'pk-button-primary' : 'pk-button-ghost-dark'}`}
        disabled={pending}
      >
        {pending ? 'Un instant…' : label}
      </button>
      <FormError state={state} />
    </form>
  );
}

export function SiteDocumentForm({
  organizationId,
  eventId,
  eventSlug,
  sourceId,
  title,
  isPublic,
}: {
  readonly organizationId: string;
  readonly eventId: string;
  readonly eventSlug: string;
  readonly sourceId: string;
  readonly title: string;
  readonly isPublic: boolean;
}) {
  const [state, action, pending] = useActionState(setDocumentPublicAction, INITIAL);

  return (
    <form action={action} className="or-inline-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <input type="hidden" name="sourceId" value={sourceId} />
      <input type="hidden" name="public" value={isPublic ? 'false' : 'true'} />
      <button
        type="submit"
        className={`pk-btn ${isPublic ? 'pk-button-ghost' : 'pk-button-secondary'}`}
        disabled={pending}
        aria-label={`${isPublic ? 'Retirer du site' : 'Diffuser sur le site'} : ${title}`}
      >
        {isPublic ? 'Retirer du site' : 'Diffuser'}
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
            // Choisir le fichier suffit : il n'y a pas d'autre décision à prendre ici.
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
            required
          />
          <p id={`${id}-hint`} className="pk-field-hint">
            {pending ? 'Envoi en cours…' : hint}
          </p>
        </div>
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

export function SiteGalleryPhotoForm({
  organizationId,
  eventId,
  eventSlug,
}: {
  readonly organizationId: string;
  readonly eventId: string;
  readonly eventSlug: string;
}) {
  const [state, action, pending] = useActionState(addSitePhotoAction, INITIAL);
  const id = useId();

  return (
    <form action={action} className="st-image-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <div className="pk-field">
        <label className="pk-field-label" htmlFor={`${id}-file`}>
          Ajouter une photo
        </label>
        <input
          id={`${id}-file`}
          name="file"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="pk-input"
          disabled={pending}
          aria-describedby={`${id}-hint`}
          required
        />
        <p id={`${id}-hint`} className="pk-field-hint">
          PNG, JPEG ou WebP, 8 Mo au plus.
        </p>
      </div>
      <Input
        id={`${id}-alt`}
        name="alt"
        label="Description (facultatif)"
        hint="Lue par les personnes qui ne voient pas l’image."
        maxLength={200}
      />
      <div className="or-inline-form">
        <button type="submit" className="pk-btn pk-button-secondary" disabled={pending}>
          {pending ? 'Envoi…' : 'Ajouter'}
        </button>
      </div>
      <FormError state={state} />
    </form>
  );
}

export function SiteGalleryRemoveForm({
  organizationId,
  eventId,
  eventSlug,
  photoId,
  label,
}: {
  readonly organizationId: string;
  readonly eventId: string;
  readonly eventSlug: string;
  readonly photoId: string;
  readonly label: string;
}) {
  const [state, action, pending] = useActionState(removeSitePhotoAction, INITIAL);

  return (
    <form action={action}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <input type="hidden" name="photoId" value={photoId} />
      <button
        type="submit"
        className="pk-btn pk-button-ghost"
        disabled={pending}
        aria-label={`Retirer ${label}`}
      >
        Retirer
      </button>
      <FormError state={state} />
    </form>
  );
}
