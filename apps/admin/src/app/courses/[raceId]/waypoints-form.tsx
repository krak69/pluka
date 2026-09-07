'use client';

import { AUTHORED_WAYPOINT_TYPES, type RaceWaypointView } from '@pluka/domain';
import { Input } from '@pluka/ui';
import { useActionState, useState } from 'react';

import { setRaceWaypointsAction, type ActionState } from '@/app/actions';

const INITIAL: ActionState = {};

/** Libellés de saisie — le vocabulaire de l'organisation, pas celui de l'enum. */
const TYPE_LABEL: Readonly<Record<(typeof AUTHORED_WAYPOINT_TYPES)[number], string>> = {
  start: 'Départ',
  aid_station: 'Ravitaillement',
  assistance: 'Base de vie',
  checkpoint: 'Pointage',
  cutoff: 'Barrière',
  finish: 'Arrivée',
};

interface Row {
  readonly key: string;
  readonly id: string;
  readonly name: string;
  readonly waypointType: string;
  readonly distanceKm: string;
  readonly cutoffAt: string;
}

/** Une chaîne vide part d'un départ et d'une arrivée : le minimum qu'exige §7. */
function initialRows(waypoints: readonly RaceWaypointView[]): readonly Row[] {
  if (waypoints.length > 0) {
    return waypoints.map((waypoint, index) => ({
      key: `existing-${index}`,
      id: waypoint.id,
      name: waypoint.name,
      waypointType: waypoint.waypointType,
      distanceKm: String(waypoint.distanceKm),
      // `datetime-local` n'accepte ni fuseau ni secondes.
      cutoffAt: waypoint.cutoffAt === null ? '' : waypoint.cutoffAt.slice(0, 16),
    }));
  }

  return [
    { key: 'new-0', id: '', name: 'Départ', waypointType: 'start', distanceKm: '0', cutoffAt: '' },
    { key: 'new-1', id: '', name: 'Arrivée', waypointType: 'finish', distanceKm: '', cutoffAt: '' },
  ];
}

/**
 * Saisie du référentiel de parcours — PLAN_ENGINE §7, §8.1.
 *
 * Sans waypoints, le prétraitement s'arrête en `skipped` et aucun Plan n'est
 * calculable. C'est le seul écran qui les produit.
 *
 * La chaîne se poste d'un bloc, en champs répétés : `getAll('name')` rend les
 * valeurs dans l'ordre du document, et cet ordre *est* le rang. Personne ne
 * saisit un numéro — un rang saisi à la main serait une seconde façon
 * d'exprimer l'ordre, et les deux divergeraient au premier déplacement.
 *
 * Aucune règle de cohérence ici : `setRaceWaypoints` refuse une chaîne dont
 * les kilomètres ne croissent pas, ou qui ne commence pas par un départ. Les
 * redire ici ferait diverger deux listes de règles.
 */
export function WaypointsForm({
  raceId,
  waypoints,
}: {
  readonly raceId: string;
  readonly waypoints: readonly RaceWaypointView[];
}) {
  const [state, action, pending] = useActionState(setRaceWaypointsAction, INITIAL);
  const [rows, setRows] = useState<readonly Row[]>(() => initialRows(waypoints));

  const move = (index: number, by: number): void => {
    const target = index + by;
    if (target < 0 || target >= rows.length) return;

    const next = [...rows];
    const moved = next[index] as Row;
    next[index] = next[target] as Row;
    next[target] = moved;
    setRows(next);
  };

  return (
    <form action={action} style={{ display: 'grid', gap: 'var(--space-5)' }}>
      <input type="hidden" name="raceId" value={raceId} />

      {rows.map((row, index) => (
        <fieldset
          key={row.key}
          style={{
            border: '1px solid var(--pk-hairline)',
            padding: 'var(--space-4)',
            display: 'grid',
            gap: 'var(--space-4)',
          }}
        >
          <legend className="pk-label">Point {index + 1}</legend>

          {/* Vide pour un point ajouté : la base lui donnera son identité. */}
          <input type="hidden" name="waypointId" value={row.id} />

          <Input
            id={`waypoint-name-${row.key}`}
            name="name"
            label="Nom"
            required
            defaultValue={row.name}
            error={state.fieldErrors?.[`waypoints.${index}.name`]}
          />

          <div className="pk-field">
            <label className="pk-field-label" htmlFor={`waypoint-type-${row.key}`}>
              Type
            </label>
            <select
              id={`waypoint-type-${row.key}`}
              name="waypointType"
              className="pk-input"
              defaultValue={row.waypointType}
            >
              {AUTHORED_WAYPOINT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABEL[type]}
                </option>
              ))}
            </select>
          </div>

          <Input
            id={`waypoint-distance-${row.key}`}
            name="distanceKm"
            label="Kilomètre annoncé"
            type="number"
            step="0.01"
            min="0"
            required
            defaultValue={row.distanceKm}
            hint="Distance officielle. Le GPX mesuré peut en différer — l’écart est signalé, jamais corrigé."
            error={state.fieldErrors?.[`waypoints.${index}.distanceKm`]}
          />

          <Input
            id={`waypoint-cutoff-${row.key}`}
            name="cutoffAt"
            label="Barrière horaire"
            type="datetime-local"
            defaultValue={row.cutoffAt}
            hint="Facultative."
            error={state.fieldErrors?.[`waypoints.${index}.cutoffAt`]}
          />

          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button
              type="button"
              className="pk-btn pk-button-secondary"
              onClick={() => move(index, -1)}
              disabled={index === 0}
            >
              Monter
            </button>
            <button
              type="button"
              className="pk-btn pk-button-secondary"
              onClick={() => move(index, 1)}
              disabled={index === rows.length - 1}
            >
              Descendre
            </button>
            <button
              type="button"
              className="pk-btn pk-button-secondary"
              onClick={() => setRows(rows.filter((_, position) => position !== index))}
              disabled={rows.length <= 2}
            >
              Retirer
            </button>
          </div>
        </fieldset>
      ))}

      <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
        <button
          type="button"
          className="pk-btn pk-button-secondary"
          onClick={() =>
            setRows([
              ...rows,
              {
                key: `new-${String(Date.now())}`,
                id: '',
                name: '',
                waypointType: 'aid_station',
                distanceKm: '',
                cutoffAt: '',
              },
            ])
          }
        >
          Ajouter un point
        </button>

        <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
          {pending ? 'Enregistrement…' : 'Enregistrer le parcours'}
        </button>
      </div>

      {state.fieldErrors?.['waypoints'] === undefined ? null : (
        <p className="pk-field-error" role="alert">
          {state.fieldErrors['waypoints']}
        </p>
      )}

      {state.error === undefined ? null : (
        <p className="pk-field-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
