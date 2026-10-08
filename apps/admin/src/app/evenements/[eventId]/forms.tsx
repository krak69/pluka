'use client';

import type { EditionRecord, EventRecord } from '@pluka/db';
import type { EditionTransition, EventTransition } from '@pluka/domain';
import { Input } from '@pluka/ui';
import { useActionState, useState } from 'react';

import {
  changeEditionStatusAction,
  changeEventStatusAction,
  createEditionAction,
  createRaceAction,
  type ActionState,
} from '@/app/actions';
import { StatusPanel } from '@/app/status-panel';
import { slugify } from '@/lib/slug';

const INITIAL: ActionState = {};

function ErrorMessage({ error }: { readonly error: string | undefined }) {
  if (error === undefined) return null;

  return (
    <p className="pk-field-error" role="alert">
      {error}
    </p>
  );
}

/**
 * Transitions de statut d'un événement et d'une édition — §4.1.
 *
 * Elles manquaient : l'écran Race en avait, les deux niveaux au-dessus non, et
 * la chaîne était donc impossible à publier depuis l'interface — publier une
 * épreuve exige une édition diffusée, elle-même sous un événement publié.
 *
 * Comme pour la Race, la liste des transitions vient de la table pure du
 * domaine et l'autorité affichée est celle qu'elle déclare : l'écran propose,
 * `changeEventStatus` et `changeEditionStatus` disposent.
 */
export function EventStatusPanel({
  eventId,
  status,
  transitions,
}: {
  readonly eventId: string;
  readonly status: EventRecord['status'];
  readonly transitions: readonly EventTransition[];
}) {
  return (
    <StatusPanel
      action={changeEventStatusAction}
      idField="eventId"
      id={eventId}
      status={status}
      transitions={transitions}
      subject="cet événement"
      domain="event"
    />
  );
}

/**
 * L'édition n'a pas de page à elle : ses transitions vivent sous l'écran de
 * son événement, et c'est cet écran que l'action rafraîchit. Le formulaire ne
 * transmet pourtant que l'édition — `changeEditionStatus` rend le
 * `eventId`, et le demander au navigateur n'ajouterait qu'une valeur de plus
 * à ne pas croire.
 */
export function EditionStatusPanel({
  editionId,
  status,
  transitions,
}: {
  readonly editionId: string;
  readonly status: EditionRecord['status'];
  readonly transitions: readonly EditionTransition[];
}) {
  return (
    <StatusPanel
      action={changeEditionStatusAction}
      idField="editionId"
      id={editionId}
      status={status}
      transitions={transitions}
      subject="cette édition"
      domain="edition"
    />
  );
}

/**
 * Formulaires de création — sous l'événement existant.
 *
 * Même grammaire que le parcours de création (0042) : l'essentiel visible, le
 * slug proposé et replié dans « Réglages avancés », le départ saisi en date et
 * heure locales. Aucune validation locale : les schémas Zod du use case font
 * foi, et dupliquer une règle ici la ferait diverger.
 */
export function CreateEditionForm({
  eventId,
  defaultYear,
}: {
  readonly eventId: string;
  readonly defaultYear: number;
}) {
  const [state, action, pending] = useActionState(createEditionAction, INITIAL);
  const [slug, setSlug] = useState(String(defaultYear));
  const [touched, setTouched] = useState(false);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="ad-event-form">
      <input type="hidden" name="eventId" value={eventId} />

      <div className="ad-form-grid">
        <Input
          id="edition-year"
          name="year"
          label="Année"
          type="number"
          required
          defaultValue={defaultYear}
          onChange={(change) => {
            if (!touched) setSlug(change.target.value.trim());
          }}
          error={errors['year']}
        />
        <Input
          id="edition-start"
          name="startDate"
          label="Date de début"
          type="date"
          required
          error={errors['startDate']}
        />
        <Input
          id="edition-end"
          name="endDate"
          label="Date de fin (facultative)"
          type="date"
          hint="Pour un événement sur plusieurs jours."
          error={errors['endDate']}
        />
      </div>

      <details className="ad-advanced" open={errors['slug'] !== undefined}>
        <summary>Réglages avancés — slug</summary>
        <div className="ad-form-grid">
          <Input
            id="edition-slug"
            name="slug"
            label="Slug de l’édition"
            required
            autoComplete="off"
            spellCheck={false}
            hint="Proposé depuis l’année."
            value={slug}
            onChange={(change) => {
              setTouched(true);
              setSlug(change.target.value);
            }}
            error={errors['slug']}
          />
        </div>
      </details>

      <div className="ad-form-actions">
        <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
          {pending ? 'Création…' : 'Créer l’édition'}
        </button>
      </div>

      <ErrorMessage error={state.error} />
    </form>
  );
}

export function CreateRaceForm({
  editionId,
  eventId,
  defaultDate,
}: {
  readonly editionId: string;
  readonly eventId: string;
  /** Le premier jour de l'édition : le départ de la plupart des épreuves. */
  readonly defaultDate: string;
}) {
  const [state, action, pending] = useActionState(createRaceAction, INITIAL);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState(false);
  const errors = state.fieldErrors ?? {};
  const id = (field: string) => `race-${field}-${editionId}`;

  return (
    <form action={action} className="ad-event-form">
      <input type="hidden" name="editionId" value={editionId} />
      <input type="hidden" name="eventId" value={eventId} />

      <div className="ad-form-grid">
        <Input
          id={id('name')}
          name="name"
          label="Nom"
          placeholder="Ex. Grand Trail"
          required
          autoComplete="off"
          value={name}
          onChange={(change) => {
            setName(change.target.value);
            if (!touched) setSlug(slugify(change.target.value));
          }}
          error={errors['name']}
        />
        <Input
          id={id('distance')}
          name="distanceKm"
          label="Distance (km)"
          inputMode="decimal"
          required
          autoComplete="off"
          error={errors['distanceKm']}
        />
        <Input
          id={id('gain')}
          name="elevationGainM"
          label="D+ (m, facultatif)"
          inputMode="numeric"
          autoComplete="off"
          error={errors['elevationGainM']}
        />
        <Input
          id={id('loss')}
          name="elevationLossM"
          label="D- (m, facultatif)"
          inputMode="numeric"
          autoComplete="off"
          error={errors['elevationLossM']}
        />
        <Input
          id={id('start-date')}
          name="startDate"
          type="date"
          label="Date de départ"
          required
          defaultValue={defaultDate}
          error={errors['startDatetime']}
        />
        <Input
          id={id('start-time')}
          name="startTime"
          type="time"
          label="Heure de départ"
          required
        />
        <Input
          id={id('cutoff-date')}
          name="cutoffDate"
          type="date"
          label="Barrière finale — date (facultative)"
          error={errors['cutoffDatetime']}
        />
        <Input
          id={id('cutoff-time')}
          name="cutoffTime"
          type="time"
          label="Barrière finale — heure"
          hint="Doit suivre le départ."
        />
      </div>

      <details
        className="ad-advanced"
        open={errors['slug'] !== undefined || errors['timezone'] !== undefined}
      >
        <summary>Réglages avancés — slug, fuseau horaire</summary>
        <div className="ad-form-grid">
          <Input
            id={id('slug')}
            name="slug"
            label="Slug de l’épreuve"
            required
            autoComplete="off"
            spellCheck={false}
            hint="Proposé depuis le nom."
            value={slug}
            onChange={(change) => {
              setTouched(true);
              setSlug(change.target.value);
            }}
            error={errors['slug']}
          />
          <Input
            id={id('timezone')}
            name="timezone"
            label="Fuseau horaire"
            required
            autoComplete="off"
            defaultValue="Europe/Paris"
            hint="Fuseau IANA de la ligne de départ : les heures saisies s’y lisent."
            error={errors['timezone']}
          />
        </div>
      </details>

      <div className="ad-form-actions">
        <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
          {pending ? 'Création…' : 'Créer l’épreuve'}
        </button>
      </div>

      <ErrorMessage error={state.error} />
    </form>
  );
}
