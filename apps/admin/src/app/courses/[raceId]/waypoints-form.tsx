'use client';

import { AUTHORED_WAYPOINT_TYPES, type RaceWaypointView } from '@pluka/domain';
import { useActionState, useEffect, useRef, useState } from 'react';

import { setRaceWaypointsAction, type ActionState } from '@/app/actions';
import {
  cutoffValue,
  dayLabel,
  elapsedMinutes,
  fingerprint,
  formatDuration,
  formatKm,
  gapsOf,
  parseKm,
  rowsOf,
  sortByKm,
  type LocalStart,
  type WaypointRow,
} from '@/app/courses/[raceId]/waypoints-draft';
import { AdminIcon, type AdminIconName } from '@/components/admin-icon';

const INITIAL: ActionState = {};

type WaypointType = (typeof AUTHORED_WAYPOINT_TYPES)[number];

/** Le vocabulaire de l'organisation, pas celui de l'enum — et un picto par type. */
const TYPES: Readonly<
  Record<WaypointType, { readonly label: string; readonly icon: AdminIconName }>
> = {
  start: { label: 'Départ', icon: 'Flag' },
  aid_station: { label: 'Ravitaillement', icon: 'ForkKnife' },
  assistance: { label: 'Base de vie', icon: 'Tent' },
  checkpoint: { label: 'Pointage', icon: 'Stamp' },
  cutoff: { label: 'Barrière', icon: 'Timer' },
  finish: { label: 'Arrivée', icon: 'FlagCheckered' },
};

function typeOf(value: string): { readonly label: string; readonly icon: AdminIconName } {
  return TYPES[value as WaypointType] ?? { label: value, icon: 'MapPin' };
}

/** Jusqu'à J+6 : un ultra de plusieurs jours reste saisissable. */
const DAYS = [0, 1, 2, 3, 4, 5, 6];

/**
 * La frise du parcours : les points à leur kilomètre, du départ à l'arrivée.
 * Elle suit la saisie, et dit d'un regard ce qu'une liste cache — un trou de
 * 30 km sans ravitaillement, deux points confondus.
 */
function CourseStrip({ rows }: { readonly rows: readonly WaypointRow[] }) {
  const placed = rows
    .map((row) => ({ row, km: parseKm(row.distanceKm) }))
    .filter((entry): entry is { row: WaypointRow; km: number } => entry.km !== null);
  const total = Math.max(1, ...placed.map((entry) => entry.km));
  const aid = placed.filter((entry) => entry.row.waypointType === 'aid_station').length;

  return (
    <figure
      className="ad-wp-strip"
      role="img"
      aria-label={`Parcours de ${formatKm(total)} : ${placed.length} points, dont ${aid} ravitaillement${
        aid > 1 ? 's' : ''
      }.`}
    >
      <div className="ad-wp-strip-track" aria-hidden="true">
        {placed.map(({ row, km }, index) => (
          <span
            key={row.key}
            className="ad-wp-strip-point"
            data-type={row.waypointType}
            data-side={index % 2 === 0 ? 'top' : 'bottom'}
            style={{ left: `${String((km / total) * 100)}%` }}
            title={`${row.name || 'Point'} · ${formatKm(km)}`}
          >
            <span className="ad-wp-strip-mark">
              <AdminIcon name={typeOf(row.waypointType).icon} size={12} />
            </span>
            {row.cutoffTime === '' ? null : <span className="ad-wp-strip-cutoff" />}
            <span className="ad-wp-strip-name">
              {row.name.length > 16 ? `${row.name.slice(0, 15)}…` : row.name}
            </span>
          </span>
        ))}
      </div>
      <figcaption className="ad-wp-strip-scale" aria-hidden="true">
        <span>0 km</span>
        <span>{formatKm(total)}</span>
      </figcaption>
    </figure>
  );
}

/**
 * Saisie des points de passage et ravitaillements — PLAN_ENGINE §7, §8.1.
 *
 * Sans eux, le prétraitement s'arrête en `skipped` et aucun Plan n'est
 * calculable : c'est le seul écran qui les produit.
 *
 * La chaîne se poste d'un bloc, en champs répétés dans l'ordre du document ;
 * cet ordre est le rang. Il suit le kilomètre : un point se range de lui-même
 * à sa distance quand on quitte son champ. La barrière se saisit comme le
 * règlement l'écrit, un jour de course et une heure.
 *
 * Aucune règle de cohérence ici : `setRaceWaypoints` refuse une chaîne dont
 * les kilomètres ne croissent pas, ou qui ne commence pas par un départ.
 */
export function WaypointsForm({
  raceId,
  waypoints,
  timezone,
  start,
  officialDistanceKm,
}: {
  readonly raceId: string;
  readonly waypoints: readonly RaceWaypointView[];
  /** Fuseau de la ligne de départ : les barrières s'y saisissent. */
  readonly timezone: string;
  /** Le départ à l'heure murale ; `null` s'il est illisible. */
  readonly start: LocalStart | null;
  /** La distance de la fiche, pour signaler une arrivée qui ne la rejoint pas. */
  readonly officialDistanceKm: number | null;
}) {
  const [state, action, pending] = useActionState(setRaceWaypointsAction, INITIAL);
  const [rows, setRows] = useState<readonly WaypointRow[]>(() =>
    rowsOf(waypoints, timezone, start),
  );
  const counter = useRef(0);

  // Après un enregistrement, la page relit la chaîne en base et la repasse
  // ici : l'état local la suit, sinon l'écran retomberait sur la chaîne
  // d'ouverture et l'enregistrement semblerait perdu.
  const saved = waypoints
    .map((waypoint) => `${waypoint.id}:${waypoint.distanceKm}:${waypoint.cutoffAt ?? ''}:${waypoint.name}`)
    .join('|');
  const [seen, setSeen] = useState(saved);
  if (seen !== saved) {
    setSeen(saved);
    setRows(rowsOf(waypoints, timezone, start));
  }

  const initial = fingerprint(rowsOf(waypoints, timezone, start), start);
  const dirty = waypoints.length === 0 || fingerprint(rows, start) !== initial;

  // Quitter la page avec une saisie non enregistrée se demande.
  useEffect(() => {
    if (!dirty || waypoints.length === 0) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, waypoints.length]);

  const update = (key: string, change: Partial<WaypointRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));

  const insertAfter = (index: number) => {
    counter.current += 1;
    const key = `new-${String(counter.current)}`;
    setRows((current) => [
      ...current.slice(0, index + 1),
      {
        key,
        id: '',
        name: '',
        waypointType: 'aid_station',
        distanceKm: '',
        cutoffDay: '',
        cutoffTime: '',
      },
      ...current.slice(index + 1),
    ]);
    // Le nouveau point prend le focus : on tape son nom aussitôt.
    requestAnimationFrame(() => document.getElementById(`waypoint-name-${key}`)?.focus());
  };

  const gaps = gapsOf(rows);
  const counts = (type: string) => rows.filter((row) => row.waypointType === type).length;
  const cutoffs = rows.filter((row) => row.cutoffTime !== '').length;
  const finishKm = parseKm(rows.at(-1)?.distanceKm ?? '');
  const finishGap =
    officialDistanceKm === null || finishKm === null ? null : finishKm - officialDistanceKm;

  return (
    <form action={action} className="ad-wp">
      <input type="hidden" name="raceId" value={raceId} />

      <ul className="ad-wp-summary" aria-label="Résumé du parcours">
        <li>
          <strong>{rows.length}</strong> points
        </li>
        <li>
          <AdminIcon name="ForkKnife" size={14} /> <strong>{counts('aid_station')}</strong>{' '}
          ravitaillement{counts('aid_station') > 1 ? 's' : ''}
        </li>
        <li>
          <AdminIcon name="Tent" size={14} /> <strong>{counts('assistance')}</strong> base
          {counts('assistance') > 1 ? 's' : ''} de vie
        </li>
        <li>
          <AdminIcon name="Timer" size={14} /> <strong>{cutoffs}</strong> barrière
          {cutoffs > 1 ? 's' : ''}
        </li>
        {finishGap === null || Math.abs(finishGap) < 0.5 ? null : (
          <li className="ad-wp-summary-warn">
            Arrivée au km {formatKm(finishKm ?? 0)} — la fiche annonce{' '}
            {formatKm(officialDistanceKm ?? 0)}
          </li>
        )}
      </ul>

      <CourseStrip rows={rows} />

      <div className="ad-wp-table" role="table" aria-label="Points de passage">
        <div className="ad-wp-head" role="row">
          <span role="columnheader">Point</span>
          <span role="columnheader">Kilomètre</span>
          <span role="columnheader">Barrière horaire</span>
          <span role="columnheader">
            <span className="pk-visually-hidden">Actions</span>
          </span>
        </div>

        {rows.map((row, index) => {
          const type = typeOf(row.waypointType);
          const gap = gaps[index] ?? null;
          const elapsed = elapsedMinutes(row, start);
          const nameError = state.fieldErrors?.[`waypoints.${index}.name`];
          const kmError = state.fieldErrors?.[`waypoints.${index}.distanceKm`];
          const cutoffError = state.fieldErrors?.[`waypoints.${index}.cutoffAt`];

          return (
            <div key={row.key} className="ad-wp-row" role="row" data-type={row.waypointType}>
              <input type="hidden" name="waypointId" value={row.id} />
              <input type="hidden" name="cutoffAt" value={cutoffValue(row, start)} />

              <div className="ad-wp-point" role="cell">
                <span className="ad-wp-icon" aria-hidden="true">
                  <AdminIcon name={type.icon} size={18} />
                </span>
                <div className="ad-wp-point-fields">
                  <label className="pk-visually-hidden" htmlFor={`waypoint-name-${row.key}`}>
                    Nom du point {index + 1}
                  </label>
                  <input
                    id={`waypoint-name-${row.key}`}
                    name="name"
                    className="pk-input ad-wp-name"
                    placeholder="Nom du point"
                    required
                    autoComplete="off"
                    value={row.name}
                    aria-invalid={nameError !== undefined}
                    onChange={(event) => update(row.key, { name: event.target.value })}
                  />
                  <label className="pk-visually-hidden" htmlFor={`waypoint-type-${row.key}`}>
                    Type du point {index + 1}
                  </label>
                  <select
                    id={`waypoint-type-${row.key}`}
                    name="waypointType"
                    className="ad-wp-type"
                    value={row.waypointType}
                    onChange={(event) => update(row.key, { waypointType: event.target.value })}
                  >
                    {AUTHORED_WAYPOINT_TYPES.map((value) => (
                      <option key={value} value={value}>
                        {TYPES[value].label}
                      </option>
                    ))}
                  </select>
                  {nameError === undefined ? null : <p className="pk-field-error">{nameError}</p>}
                </div>
              </div>

              <div className="ad-wp-km" role="cell">
                <label className="pk-visually-hidden" htmlFor={`waypoint-distance-${row.key}`}>
                  Kilomètre annoncé du point {index + 1}
                </label>
                <span className="ad-wp-km-field">
                  <input
                    id={`waypoint-distance-${row.key}`}
                    name="distanceKm"
                    className="pk-input ad-wp-km-input"
                    inputMode="decimal"
                    autoComplete="off"
                    required
                    value={row.distanceKm}
                    aria-invalid={kmError !== undefined}
                    onChange={(event) => update(row.key, { distanceKm: event.target.value })}
                    // Le point se range à sa distance quand on quitte son champ.
                    onBlur={() => setRows((current) => sortByKm(current))}
                  />
                  <span aria-hidden="true">km</span>
                </span>
                <span className="ad-wp-meta">
                  {gap === null ? ' ' : `+${formatKm(gap)}`}
                </span>
                {kmError === undefined ? null : <p className="pk-field-error">{kmError}</p>}
              </div>

              <div className="ad-wp-cutoff" role="cell">
                {start === null ? (
                  <span className="ad-wp-meta">Départ de l’épreuve à renseigner d’abord.</span>
                ) : (
                  <>
                    <span className="ad-wp-cutoff-fields">
                      <label className="pk-visually-hidden" htmlFor={`waypoint-day-${row.key}`}>
                        Jour de la barrière du point {index + 1}
                      </label>
                      <select
                        id={`waypoint-day-${row.key}`}
                        className="pk-input ad-wp-day"
                        value={row.cutoffDay}
                        onChange={(event) =>
                          update(row.key, {
                            cutoffDay: event.target.value,
                            cutoffTime: event.target.value === '' ? '' : row.cutoffTime,
                          })
                        }
                      >
                        <option value="">Aucune</option>
                        {DAYS.map((day) => (
                          <option key={day} value={String(day)}>
                            {dayLabel(start, day)}
                          </option>
                        ))}
                      </select>
                      <label className="pk-visually-hidden" htmlFor={`waypoint-time-${row.key}`}>
                        Heure de la barrière du point {index + 1}
                      </label>
                      <input
                        id={`waypoint-time-${row.key}`}
                        type="time"
                        className="pk-input ad-wp-time"
                        value={row.cutoffTime}
                        disabled={row.cutoffDay === ''}
                        onChange={(event) => update(row.key, { cutoffTime: event.target.value })}
                      />
                    </span>
                    <span className="ad-wp-meta">
                      {elapsed === null
                        ? row.cutoffDay === ''
                          ? ' '
                          : 'Heure à préciser'
                        : `${formatDuration(elapsed)} après le départ`}
                    </span>
                  </>
                )}
                {cutoffError === undefined ? null : (
                  <p className="pk-field-error">{cutoffError}</p>
                )}
              </div>

              <div className="ad-wp-actions" role="cell">
                <button
                  type="button"
                  className="ad-wp-action"
                  onClick={() => insertAfter(index)}
                  title="Insérer un point après celui-ci"
                >
                  <AdminIcon name="Plus" size={16} />
                  <span className="pk-visually-hidden">Insérer un point après {row.name}</span>
                </button>
                <button
                  type="button"
                  className="ad-wp-action"
                  onClick={() => setRows((current) => current.filter((entry) => entry.key !== row.key))}
                  disabled={rows.length <= 2}
                  title="Retirer ce point"
                >
                  <AdminIcon name="Trash" size={16} />
                  <span className="pk-visually-hidden">Retirer {row.name}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="pk-btn pk-button-secondary ad-wp-add"
        onClick={() => insertAfter(rows.length - 2)}
      >
        <AdminIcon name="Plus" size={16} /> Ajouter un point avant l’arrivée
      </button>

      <p className="ad-wp-hint">
        Kilomètres officiels, tels que le règlement les annonce : le GPX mesuré peut en différer —
        l’écart est signalé, jamais corrigé. Barrières à l’heure locale de la course ({timezone}).
      </p>

      {state.fieldErrors?.['waypoints'] === undefined && state.error === undefined ? null : (
        <p className="pk-field-error" role="alert">
          {state.fieldErrors?.['waypoints'] ?? state.error}
        </p>
      )}

      {state.done === undefined || pending || dirty ? null : (
        <p className="ad-done" role="status">
          {state.done}
        </p>
      )}

      {dirty ? (
        <div className="ad-wp-save">
          <p className="ad-wp-save-text">
            {waypoints.length === 0 ? 'Parcours à enregistrer' : 'Modifications non enregistrées'}
          </p>
          {waypoints.length === 0 ? null : (
            <button
              type="button"
              className="pk-btn pk-button-secondary"
              onClick={() => setRows(rowsOf(waypoints, timezone, start))}
            >
              Annuler
            </button>
          )}
          <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
            {pending ? 'Enregistrement…' : 'Enregistrer le parcours'}
          </button>
        </div>
      ) : null}
    </form>
  );
}
