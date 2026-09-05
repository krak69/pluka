'use client';

import type { RaceRecord } from '@pluka/db';
import type { RaceTransition, TransitionAuthority } from '@pluka/domain';
import { Input } from '@pluka/ui';
import { useActionState } from 'react';

import { changeRaceStatusAction, updateRaceAction, type ActionState } from '@/app/actions';

const INITIAL: ActionState = {};

/**
 * Libellés d'autorité — 00_PRODUCT_SPEC §4.1, colonne « Autorisé ».
 *
 * Affichage seulement. La règle est portée par la table du domaine et
 * appliquée par `changeRaceStatus` ; ce libellé dit à l'administrateur ce
 * qu'il faut être, il ne le vérifie pas.
 */
const AUTHORITY_LABEL: Readonly<Record<TransitionAuthority, string>> = {
  organization_editor: 'éditeur de l’organisation, ou pluka_admin',
  organization_admin: 'admin de l’organisation, ou pluka_admin',
  platform_admin: 'pluka_admin uniquement',
};

export function RaceStatusPanel({
  raceId,
  status,
  transitions,
}: {
  readonly raceId: string;
  readonly status: RaceRecord['status'];
  readonly transitions: readonly RaceTransition[];
}) {
  const [state, action, pending] = useActionState(changeRaceStatusAction, INITIAL);

  if (transitions.length === 0) {
    return (
      <p className="pk-body" style={{ color: 'var(--pk-text-muted)' }}>
        Aucune transition possible depuis <strong>{status}</strong>.
      </p>
    );
  }

  return (
    <>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {transitions.map((transition) => (
          <li
            key={transition.to}
            style={{
              display: 'flex',
              gap: 'var(--space-4)',
              alignItems: 'center',
              padding: 'var(--space-3) 0',
              borderTop: '1px solid var(--pk-hairline)',
            }}
          >
            <form action={action}>
              <input type="hidden" name="raceId" value={raceId} />
              <input type="hidden" name="status" value={transition.to} />
              <button
                type="submit"
                className="pk-btn pk-button-secondary"
                disabled={pending}
                style={{ minHeight: '44px' }}
              >
                Passer en {transition.to}
              </button>
            </form>

            <span className="pk-label">{AUTHORITY_LABEL[transition.authority]}</span>
          </li>
        ))}
      </ul>

      {state.error === undefined ? null : (
        <p className="pk-field-error" role="alert" style={{ marginTop: 'var(--space-4)' }}>
          {state.error}
        </p>
      )}
    </>
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

      <Input id="race-name" name="name" label="Nom" defaultValue={race.name} />
      <Input
        id="race-distance"
        name="distanceKm"
        label="Distance (km)"
        type="number"
        step="0.01"
        defaultValue={race.distanceKm}
      />
      <Input
        id="race-gain"
        name="elevationGainM"
        label="D+ (m)"
        type="number"
        defaultValue={race.elevationGainM ?? ''}
      />
      <Input
        id="race-loss"
        name="elevationLossM"
        label="D- (m)"
        type="number"
        defaultValue={race.elevationLossM ?? ''}
      />
      <Input
        id="race-start"
        name="startDatetime"
        label="Départ"
        defaultValue={race.startDatetime}
      />
      <Input
        id="race-cutoff"
        name="cutoffDatetime"
        label="Barrière finale"
        defaultValue={race.cutoffDatetime ?? ''}
      />
      <Input
        id="race-timezone"
        name="timezone"
        label="Fuseau (IANA)"
        defaultValue={race.timezone}
      />
      <Input
        id="race-start-place"
        name="startLocationName"
        label="Lieu de départ"
        defaultValue={race.startLocationName ?? ''}
      />
      <Input
        id="race-finish-place"
        name="finishLocationName"
        label="Lieu d’arrivée"
        defaultValue={race.finishLocationName ?? ''}
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
