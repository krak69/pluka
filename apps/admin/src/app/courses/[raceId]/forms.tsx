'use client';

import type { RaceRecord } from '@pluka/db';
import type { RaceTransition } from '@pluka/domain';
import { Input } from '@pluka/ui';
import { useActionState, useId } from 'react';

import {
  changeRaceStatusAction,
  setRaceVisibilityAction,
  updateRaceAction,
  type ActionState,
} from '@/app/actions';
import { StatusPanel } from '@/app/status-panel';
import { RACE_VISIBILITY_OPTIONS } from '@/components/admin-status';
import { localParts } from '@/lib/zoned';

const INITIAL: ActionState = {};

/**
 * Transitions de statut d'une épreuve — §4.1.
 *
 * Enveloppe nommée autour de `StatusPanel`, qui porte le rendu commun aux
 * trois niveaux de la chaîne. Ce qui reste ici est ce qui distingue
 * l'épreuve : son action et le champ qui porte son identifiant.
 */
export function RaceStatusPanel({
  raceId,
  status,
  transitions,
}: {
  readonly raceId: string;
  readonly status: RaceRecord['status'];
  readonly transitions: readonly RaceTransition[];
}) {
  return (
    <StatusPanel
      action={changeRaceStatusAction}
      idField="raceId"
      id={raceId}
      status={status}
      transitions={transitions}
      subject="cette épreuve"
      domain="race"
    />
  );
}

/**
 * Visibilité d'une épreuve — 03_PRIVACY_RLS §17.
 *
 * Trois choix décrits plutôt qu'un menu : la différence entre « non listée »
 * et « privée » ne se devine pas au mot. Une épreuve naît privée (0001) ;
 * sans ce choix, elle ne devenait jamais visible, même publiée.
 */
export function RaceVisibilityForm({
  raceId,
  visibility,
}: {
  readonly raceId: string;
  readonly visibility: RaceRecord['publicVisibility'];
}) {
  const [state, action, pending] = useActionState(setRaceVisibilityAction, INITIAL);
  const id = useId();

  return (
    <form action={action} className="ad-race-visibility">
      <input type="hidden" name="raceId" value={raceId} />
      <fieldset className="ad-role-choices">
        <legend className="pk-field-label">Visibilité</legend>
        {RACE_VISIBILITY_OPTIONS.map((option) => (
          <label key={option.value} className="ad-role-choice" htmlFor={`${id}-${option.value}`}>
            <input
              id={`${id}-${option.value}`}
              type="radio"
              name="visibility"
              value={option.value}
              defaultChecked={option.value === visibility}
            />
            <span className="ad-role-choice-text">
              <span className="ad-role-choice-label">{option.label}</span>
              <span className="ad-role-choice-description">{option.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div>
        <button type="submit" className="pk-btn pk-button-secondary" disabled={pending}>
          {pending ? 'Enregistrement…' : 'Enregistrer la visibilité'}
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

/**
 * Édition des informations d'une épreuve.
 *
 * Ni le slug ni l'édition ne sont modifiables : le schéma de commande ne les
 * accepte pas, et les exposer ici laisserait croire le contraire. Départ et
 * barrière finale se lisent et se saisissent à l'heure de la ligne de départ,
 * comme à la création ; la conversion en instant est faite par l'action.
 */
/** Les refus d'horaires du domaine (`checkRaceSchedule`), dits contre le bon champ. */
const SCHEDULE_REFUSALS: Readonly<Record<string, { field: string; message: string }>> = {
  start_invalid: { field: 'startDatetime', message: 'Date ou heure de départ illisible.' },
  cutoff_invalid: { field: 'cutoffDatetime', message: 'Date ou heure de barrière illisible.' },
  cutoff_before_start: {
    field: 'cutoffDatetime',
    message: 'La barrière finale doit suivre le départ.',
  },
  timezone_unknown: { field: 'timezone', message: 'Fuseau horaire inconnu.' },
};

export function UpdateRaceForm({ race }: { readonly race: RaceRecord }) {
  const [state, action, pending] = useActionState(updateRaceAction, INITIAL);
  const refusal = SCHEDULE_REFUSALS[state.fieldErrors?.['raison'] ?? ''];
  const errors: Readonly<Record<string, string>> = {
    ...state.fieldErrors,
    ...(refusal === undefined ? {} : { [refusal.field]: refusal.message }),
  };
  const start = localParts(race.startDatetime, race.timezone);
  const cutoff = localParts(race.cutoffDatetime, race.timezone);

  return (
    <form action={action} className="ad-race-edit">
      <input type="hidden" name="raceId" value={race.id} />

      <div className="ad-form-grid">
        <Input
          id="race-name"
          name="name"
          label="Nom"
          defaultValue={race.name}
          error={errors['name']}
        />
        <Input
          id="race-distance"
          name="distanceKm"
          label="Distance (km)"
          inputMode="decimal"
          defaultValue={race.distanceKm}
          error={errors['distanceKm']}
        />
        <Input
          id="race-gain"
          name="elevationGainM"
          label="D+ (m)"
          inputMode="numeric"
          defaultValue={race.elevationGainM ?? ''}
          error={errors['elevationGainM']}
        />
        <Input
          id="race-loss"
          name="elevationLossM"
          label="D- (m)"
          inputMode="numeric"
          defaultValue={race.elevationLossM ?? ''}
          error={errors['elevationLossM']}
        />
        <Input
          id="race-start-date"
          name="startDate"
          type="date"
          label="Date de départ"
          defaultValue={start?.date ?? ''}
          error={errors['startDatetime']}
        />
        <Input
          id="race-start-time"
          name="startTime"
          type="time"
          label="Heure de départ"
          defaultValue={start?.time ?? ''}
        />
        <Input
          id="race-cutoff-date"
          name="cutoffDate"
          type="date"
          label="Barrière finale — date (facultative)"
          defaultValue={cutoff?.date ?? ''}
          error={errors['cutoffDatetime']}
        />
        <Input
          id="race-cutoff-time"
          name="cutoffTime"
          type="time"
          label="Barrière finale — heure"
          defaultValue={cutoff?.time ?? ''}
          hint="Vide les deux champs pour retirer la barrière."
        />
        <Input
          id="race-start-place"
          name="startLocationName"
          label="Lieu de départ"
          defaultValue={race.startLocationName ?? ''}
          error={errors['startLocationName']}
        />
        <Input
          id="race-finish-place"
          name="finishLocationName"
          label="Lieu d’arrivée"
          defaultValue={race.finishLocationName ?? ''}
          error={errors['finishLocationName']}
        />
        <Input
          id="race-timezone"
          name="timezone"
          label="Fuseau horaire"
          defaultValue={race.timezone}
          hint="Fuseau IANA de la ligne de départ : les heures ci-dessus s’y lisent."
          error={errors['timezone']}
        />
      </div>

      <div className="ad-form-actions">
        <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
          {pending ? 'Enregistrement…' : 'Enregistrer'}
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
