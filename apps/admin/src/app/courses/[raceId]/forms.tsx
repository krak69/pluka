'use client';

import type { RaceRecord } from '@pluka/db';
import type { RaceTransition } from '@pluka/domain';
import { Input } from '@pluka/ui';
import { useActionState } from 'react';

import { changeRaceStatusAction, updateRaceAction, type ActionState } from '@/app/actions';
import { StatusPanel } from '@/app/status-panel';

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
    />
  );
}

/**
 * Édition des informations d'une épreuve.
 *
 * Ni le slug ni l'édition ne sont modifiables : le schéma de commande ne les
 * accepte pas, et les exposer ici laisserait croire le contraire.
 */
export function UpdateRaceForm({ race }: { readonly race: RaceRecord }) {
  const [state, action, pending] = useActionState(updateRaceAction, INITIAL);

  return (
    <form action={action} style={{ display: 'grid', gap: 'var(--space-5)', maxWidth: '32rem' }}>
      <input type="hidden" name="raceId" value={race.id} />

      <Input
        id="race-name"
        name="name"
        label="Nom"
        defaultValue={race.name}
        error={state.fieldErrors?.['name']}
      />
      <Input
        id="race-distance"
        name="distanceKm"
        label="Distance (km)"
        type="number"
        step="0.01"
        defaultValue={race.distanceKm}
        error={state.fieldErrors?.['distanceKm']}
      />
      <Input
        id="race-gain"
        name="elevationGainM"
        label="D+ (m)"
        type="number"
        defaultValue={race.elevationGainM ?? ''}
        error={state.fieldErrors?.['elevationGainM']}
      />
      <Input
        id="race-loss"
        name="elevationLossM"
        label="D- (m)"
        type="number"
        defaultValue={race.elevationLossM ?? ''}
        error={state.fieldErrors?.['elevationLossM']}
      />
      <Input
        id="race-start"
        name="startDatetime"
        label="Départ"
        defaultValue={race.startDatetime}
        error={state.fieldErrors?.['startDatetime']}
      />
      <Input
        id="race-cutoff"
        name="cutoffDatetime"
        label="Barrière finale"
        defaultValue={race.cutoffDatetime ?? ''}
        error={state.fieldErrors?.['cutoffDatetime']}
      />
      <Input
        id="race-timezone"
        name="timezone"
        label="Fuseau (IANA)"
        defaultValue={race.timezone}
        error={state.fieldErrors?.['timezone']}
      />
      <Input
        id="race-start-place"
        name="startLocationName"
        label="Lieu de départ"
        defaultValue={race.startLocationName ?? ''}
        error={state.fieldErrors?.['startLocationName']}
      />
      <Input
        id="race-finish-place"
        name="finishLocationName"
        label="Lieu d’arrivée"
        defaultValue={race.finishLocationName ?? ''}
        error={state.fieldErrors?.['finishLocationName']}
      />

      <div>
        <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
          Enregistrer
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
