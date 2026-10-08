'use client';

import { AUTHORED_WAYPOINT_TYPES, type RaceWaypointView } from '@pluka/domain';
import { Input } from '@pluka/ui';
import { useActionState, useState } from 'react';

import { setRaceWaypointsAction, type ActionState } from '@/app/actions';
import { localParts } from '@/lib/zoned';

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

/**
 * `datetime-local` n'accepte ni fuseau ni secondes : la barrière s'y lit à
 * l'heure murale du fuseau de l'épreuve — celle du règlement — et l'action la
 * reconvertit dans le fuseau de l'épreuve lu en base (`setRaceWaypointsAction`).
 */
function localDateTime(instant: string | null, timezone: string): string {
  const parts = localParts(instant, timezone);
  return parts === null ? '' : `${parts.date}T${parts.time}`;
}

/** Une chaîne vide part d'un départ et d'une arrivée : le minimum qu'exige §7. */
function initialRows(waypoints: readonly RaceWaypointView[], timezone: string): readonly Row[] {
  if (waypoints.length > 0) {
    return waypoints.map((waypoint) => ({
      // L'identité du point, pas son rang : après un enregistrement, les
      // champs se remontent avec les valeurs relues en base.
      key: `existing-${waypoint.id}`,
      id: waypoint.id,
      name: waypoint.name,
      waypointType: waypoint.waypointType,
      distanceKm: String(waypoint.distanceKm),
      cutoffAt: localDateTime(waypoint.cutoffAt, timezone),
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
  timezone,
}: {
  readonly raceId: string;
  readonly waypoints: readonly RaceWaypointView[];
  /** Fuseau de la ligne de départ : les barrières s'y saisissent. */
  readonly timezone: string;
}) {
  const [state, action, pending] = useActionState(setRaceWaypointsAction, INITIAL);
  const [rows, setRows] = useState<readonly Row[]>(() => initialRows(waypoints, timezone));

  // Après un enregistrement, la page relit la chaîne en base et la repasse
  // ici. L'état local doit la suivre : sinon, React remettant le formulaire à
  // zéro après l'action, l'écran retombait sur la chaîne d'ouverture — vide —
  // et l'enregistrement semblait perdu.
  const saved = waypoints
    .map((waypoint) => `${waypoint.id}:${waypoint.distanceKm}:${waypoint.cutoffAt ?? ''}`)
    .join('|');
  const [seen, setSeen] = useState(saved);
  if (seen !== saved) {
    setSeen(saved);
    setRows(initialRows(waypoints, timezone));
  }

  // Champs contrôlés : la saisie vit dans `rows`. React remet à zéro les
  // champs non contrôlés après une action de formulaire ; ceux-ci gardent ce
  // qui a été tapé, jusqu'à ce que la chaîne relue en base les remplace.
  const update = (
    index: number,
    field: 'name' | 'waypointType' | 'distanceKm' | 'cutoffAt',
    value: string,
  ): void => {
    setRows(rows.map((row, position) => (position === index ? { ...row, [field]: value } : row)));
  };

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
            value={row.name}
            onChange={(change) => update(index, 'name', change.target.value)}
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
              value={row.waypointType}
              onChange={(change) => update(index, 'waypointType', change.target.value)}
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
            value={row.distanceKm}
            onChange={(change) => update(index, 'distanceKm', change.target.value)}
            hint="Distance officielle. Le GPX mesuré peut en différer — l’écart est signalé, jamais corrigé."
            error={state.fieldErrors?.[`waypoints.${index}.distanceKm`]}
          />

          <Input
            id={`waypoint-cutoff-${row.key}`}
            name="cutoffAt"
            label="Barrière horaire"
            type="datetime-local"
            value={row.cutoffAt}
            onChange={(change) => update(index, 'cutoffAt', change.target.value)}
            hint={`Facultative. Heure locale de la course (${timezone}).`}
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

      {state.done === undefined || pending ? null : (
        <p className="ad-done" role="status">
          {state.done}
        </p>
      )}
    </form>
  );
}
