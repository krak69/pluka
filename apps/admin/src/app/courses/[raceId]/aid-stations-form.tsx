'use client';

import { AID_KIND_LABELS, ANNOUNCED_AID_KINDS } from '@pluka/domain';
import { useActionState, useId } from 'react';

import { saveAidStationAction, type ActionState } from '@/app/actions';

/**
 * Contenu des ravitaillements — NUTRITION_ENGINE §32, migration 0110. L'équipe
 * PLUKA le saisit d'après les sources officielles, pour une course dont
 * l'organisation ne le fait pas elle-même. Rien n'est supposé : un point sans
 * contenu n'annonce rien.
 */

export interface AdminAidPoint {
  readonly id: string;
  readonly name: string;
  readonly distanceKm: number;
  readonly kinds: readonly string[];
  readonly others: string;
}

const INITIAL: ActionState = {};
const km = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

function AidPointForm({
  raceId,
  point,
}: {
  readonly raceId: string;
  readonly point: AdminAidPoint;
}) {
  const [state, action, pending] = useActionState(saveAidStationAction, INITIAL);
  const othersId = useId();

  return (
    <form action={action} className="ad-aid">
      <input type="hidden" name="raceId" value={raceId} />
      <input type="hidden" name="waypointId" value={point.id} />
      <fieldset className="ad-aid-fieldset">
        <legend className="ad-aid-name">
          {point.name} <span className="ad-aid-km">km {km.format(point.distanceKm)}</span>
        </legend>
        <div className="ad-aid-kinds">
          {ANNOUNCED_AID_KINDS.map((kind) => (
            <label key={kind} className="ad-wp-drop-bag">
              <input
                type="checkbox"
                name="kind"
                value={kind}
                defaultChecked={point.kinds.includes(kind)}
              />
              <span>{AID_KIND_LABELS[kind]}</span>
            </label>
          ))}
        </div>
        <label className="pk-field" htmlFor={othersId}>
          <span className="pk-field-label">Autres, séparés par des virgules</span>
          <input
            id={othersId}
            name="others"
            className="pk-input"
            defaultValue={point.others}
            placeholder="Fromage, pain d’épices…"
            maxLength={400}
          />
        </label>
      </fieldset>
      <div>
        <button type="submit" className="pk-btn pk-button-secondary" disabled={pending}>
          {pending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
      {state.error === undefined ? null : (
        <p className="pk-field-error" role="alert">
          {state.error}
        </p>
      )}
      {state.done === undefined ? null : (
        <p className="ad-aid-done" role="status">
          {state.done}
        </p>
      )}
    </form>
  );
}

export function AidStationsForm({
  raceId,
  points,
}: {
  readonly raceId: string;
  readonly points: readonly AdminAidPoint[];
}) {
  if (points.length === 0) {
    return (
      <p className="ad-org-panel-lede">
        Ajoutez d’abord les ravitaillements dans les points de passage.
      </p>
    );
  }
  return (
    <div className="ad-aid-list">
      {points.map((point) => (
        <AidPointForm key={point.id} raceId={raceId} point={point} />
      ))}
    </div>
  );
}
