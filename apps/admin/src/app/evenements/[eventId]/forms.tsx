'use client';

import type { EditionRecord, EventRecord } from '@pluka/db';
import type { EditionTransition, EventTransition } from '@pluka/domain';
import { Input } from '@pluka/ui';
import { useActionState } from 'react';

import {
  changeEditionStatusAction,
  changeEventStatusAction,
  createEditionAction,
  createRaceAction,
  type ActionState,
} from '@/app/actions';
import { StatusPanel } from '@/app/status-panel';

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
    />
  );
}

/**
 * Formulaires de création.
 *
 * Client Components pour la seule restitution du message d'erreur du domaine
 * (§6.2). Aucune validation locale : les schémas Zod du use case font foi, et
 * dupliquer une règle ici la ferait diverger.
 */
export function CreateEditionForm({ eventId }: { readonly eventId: string }) {
  const [state, action, pending] = useActionState(createEditionAction, INITIAL);

  return (
    <form action={action} style={{ display: 'grid', gap: 'var(--space-5)', maxWidth: '32rem' }}>
      <input type="hidden" name="eventId" value={eventId} />

      <Input
        id="edition-year"
        name="year"
        label="Année"
        type="number"
        required
        error={state.fieldErrors?.['year']}
      />
      <Input
        id="edition-slug"
        name="slug"
        label="Slug"
        required
        error={state.fieldErrors?.['slug']}
      />
      <Input
        id="edition-start"
        name="startDate"
        label="Date de début"
        type="date"
        required
        error={state.fieldErrors?.['startDate']}
      />
      <Input
        id="edition-end"
        name="endDate"
        label="Date de fin"
        type="date"
        error={state.fieldErrors?.['endDate']}
      />

      <div>
        <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
          Créer l’édition
        </button>
      </div>

      <ErrorMessage error={state.error} />
    </form>
  );
}

export function CreateRaceForm({
  editionId,
  eventId,
}: {
  readonly editionId: string;
  readonly eventId: string;
}) {
  const [state, action, pending] = useActionState(createRaceAction, INITIAL);

  return (
    <form action={action} style={{ display: 'grid', gap: 'var(--space-5)', maxWidth: '32rem' }}>
      <input type="hidden" name="editionId" value={editionId} />
      <input type="hidden" name="eventId" value={eventId} />

      <Input
        id={`race-name-${editionId}`}
        name="name"
        label="Nom"
        required
        error={state.fieldErrors?.['name']}
      />
      <Input
        id={`race-slug-${editionId}`}
        name="slug"
        label="Slug"
        required
        error={state.fieldErrors?.['slug']}
      />
      <Input
        id={`race-distance-${editionId}`}
        name="distanceKm"
        label="Distance (km)"
        type="number"
        step="0.01"
        required
        error={state.fieldErrors?.['distanceKm']}
      />
      <Input
        id={`race-start-${editionId}`}
        name="startDatetime"
        label="Départ (ISO 8601 avec décalage)"
        required
        hint="Exemple : 2026-06-20T04:00:00Z"
        error={state.fieldErrors?.['startDatetime']}
      />
      <Input
        id={`race-cutoff-${editionId}`}
        name="cutoffDatetime"
        label="Barrière finale"
        hint="Facultative. Doit suivre le départ."
        error={state.fieldErrors?.['cutoffDatetime']}
      />
      <Input
        id={`race-timezone-${editionId}`}
        name="timezone"
        label="Fuseau (IANA)"
        defaultValue="Europe/Paris"
        required
        hint="Structurant pour les heures de passage et les Conditions."
        error={state.fieldErrors?.['timezone']}
      />
      <Input
        id={`race-gain-${editionId}`}
        name="elevationGainM"
        label="D+ (m)"
        type="number"
        error={state.fieldErrors?.['elevationGainM']}
      />
      <Input
        id={`race-loss-${editionId}`}
        name="elevationLossM"
        label="D- (m)"
        type="number"
        error={state.fieldErrors?.['elevationLossM']}
      />

      <div>
        <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
          Créer l’épreuve
        </button>
      </div>

      <ErrorMessage error={state.error} />
    </form>
  );
}
