'use client';

import { AUTHORED_WAYPOINT_TYPES, type RaceEquipmentItem } from '@pluka/domain';
import { Input } from '@pluka/ui';
import { useActionState, useId, useRef, useState } from 'react';

import {
  addEquipmentAction,
  cancelRaceAction,
  reinstateRaceAction,
  importGpxAction,
  reviseEquipmentAction,
  saveWaypointsAction,
  type CourseActionState,
} from '@/app/course-actions';

/**
 * Le parcours d'une épreuve, côté organisation — PLAN_ENGINE §7, §8.1.
 *
 * Trace, points de passage, barrières, matériel, annulation. Aucune règle ici :
 * la cohérence de la chaîne, le rôle et les exigences se tranchent côté serveur.
 */

const INITIAL: CourseActionState = {};

export interface RaceScope {
  readonly organizationId: string;
  readonly selection: string;
  readonly raceId: string;
}

function ScopeFields({ scope }: { readonly scope: RaceScope }) {
  return (
    <>
      <input type="hidden" name="organizationId" value={scope.organizationId} />
      <input type="hidden" name="selection" value={scope.selection} />
      <input type="hidden" name="raceId" value={scope.raceId} />
    </>
  );
}

function ActionError({ state }: { readonly state: CourseActionState }) {
  if (state.error === undefined) return null;
  return (
    <p className="pk-field-error" role="alert">
      {state.error}
    </p>
  );
}

export function ImportGpxForm({
  scope,
  hasTrace,
}: {
  readonly scope: RaceScope;
  readonly hasTrace: boolean;
}) {
  const [state, action, pending] = useActionState(importGpxAction, INITIAL);
  const id = useId();

  return (
    <form action={action} className="cr-revise">
      <ScopeFields scope={scope} />
      <div className="pk-field">
        <label className="pk-field-label" htmlFor={`${id}-gpx`}>
          {hasTrace ? 'Remplacer la trace' : 'Fichier GPX'}
        </label>
        <input
          id={`${id}-gpx`}
          name="gpx"
          type="file"
          accept=".gpx,application/gpx+xml"
          className="pk-input"
          disabled={pending}
          aria-describedby={`${id}-hint`}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
          required
        />
        <p id={`${id}-hint`} className="pk-field-hint">
          {pending ? 'Envoi en cours…' : '25 Mo au plus. L’envoi part dès le fichier choisi.'}
        </p>
      </div>
      <ActionError state={state} />
    </form>
  );
}

const TYPE_LABELS: Readonly<Record<(typeof AUTHORED_WAYPOINT_TYPES)[number], string>> = {
  start: 'Départ',
  aid_station: 'Ravitaillement',
  assistance: 'Base de vie',
  checkpoint: 'Pointage',
  cutoff: 'Barrière',
  finish: 'Arrivée',
};

/** Jusqu'à J+6 : un ultra de plusieurs jours reste saisissable. */
const DAYS = [0, 1, 2, 3, 4, 5, 6];

export interface WaypointInput {
  readonly id: string;
  readonly name: string;
  readonly waypointType: string;
  readonly distanceKm: number;
  /** Jour de course de la barrière (0 = jour du départ) et heure locale. */
  readonly cutoffDay: number | null;
  readonly cutoffTime: string | null;
}

interface Row {
  readonly key: string;
  readonly id: string;
  readonly name: string;
  readonly waypointType: string;
  readonly distanceKm: string;
  readonly cutoffDay: string;
  readonly cutoffTime: string;
}

function rowsOf(waypoints: readonly WaypointInput[]): readonly Row[] {
  if (waypoints.length === 0) {
    return [
      { key: 'new-0', id: '', name: 'Départ', waypointType: 'start', distanceKm: '0', cutoffDay: '', cutoffTime: '' },
      { key: 'new-1', id: '', name: 'Arrivée', waypointType: 'finish', distanceKm: '', cutoffDay: '', cutoffTime: '' },
    ];
  }

  return waypoints.map((waypoint) => ({
    key: waypoint.id,
    id: waypoint.id,
    name: waypoint.name,
    waypointType: waypoint.waypointType,
    distanceKm: String(waypoint.distanceKm).replace('.', ','),
    cutoffDay: waypoint.cutoffDay === null ? '' : String(waypoint.cutoffDay),
    cutoffTime: waypoint.cutoffTime ?? '',
  }));
}

function kilometers(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Un point se range à sa distance ; sans distance, il attend en fin de liste. */
function sortByKm(rows: readonly Row[]): readonly Row[] {
  const placed = rows
    .map((row, index) => ({ row, index, km: kilometers(row.distanceKm) }))
    .filter((entry) => entry.km !== null)
    .sort((left, right) => (left.km ?? 0) - (right.km ?? 0) || left.index - right.index)
    .map((entry) => entry.row);
  return [...placed, ...rows.filter((row) => kilometers(row.distanceKm) === null)];
}

function cutoffDate(startDay: string, offset: string): string {
  return new Date(Date.parse(`${startDay}T00:00:00Z`) + Number(offset) * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function dayLabel(startDay: string, offset: number): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${cutoffDate(startDay, String(offset))}T12:00:00Z`));
}

export function WaypointsForm({
  scope,
  waypoints,
  startDay,
}: {
  readonly scope: RaceScope;
  readonly waypoints: readonly WaypointInput[];
  /** Le jour du départ, dans le fuseau de l'épreuve. */
  readonly startDay: string;
}) {
  const [state, action, pending] = useActionState(saveWaypointsAction, INITIAL);
  const [rows, setRows] = useState<readonly Row[]>(() => rowsOf(waypoints));
  const counter = useRef(0);
  const errors = state.fieldErrors ?? {};

  const update = (key: string, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const insertBeforeFinish = () => {
    counter.current += 1;
    const key = `added-${String(counter.current)}`;
    setRows((current) => [
      ...current.slice(0, -1),
      { key, id: '', name: '', waypointType: 'aid_station', distanceKm: '', cutoffDay: '', cutoffTime: '' },
      ...current.slice(-1),
    ]);
    requestAnimationFrame(() => document.getElementById(`wp-name-${key}`)?.focus());
  };

  return (
    <form action={action} className="wp-form" noValidate>
      <ScopeFields scope={scope} />
      <ol className="wp-list">
        {rows.map((row, index) => (
          <li key={row.key} className="wp-row">
            <input type="hidden" name="waypointId" value={row.id} />
            <input
              type="hidden"
              name="cutoffAt"
              value={
                row.cutoffDay === '' || row.cutoffTime === ''
                  ? ''
                  : `${cutoffDate(startDay, row.cutoffDay)}T${row.cutoffTime}`
              }
            />
            <div className="pk-field">
              <label className="pk-field-label" htmlFor={`wp-name-${row.key}`}>
                Point {index + 1}
              </label>
              <input
                id={`wp-name-${row.key}`}
                name="name"
                className="pk-input"
                autoComplete="off"
                value={row.name}
                onChange={(event) => update(row.key, { name: event.target.value })}
              />
              {errors[`waypoints.${String(index)}.name`] === undefined ? null : (
                <p className="pk-field-error">{errors[`waypoints.${String(index)}.name`]}</p>
              )}
            </div>
            <div className="pk-field">
              <label className="pk-field-label" htmlFor={`wp-type-${row.key}`}>
                Type
              </label>
              <select
                id={`wp-type-${row.key}`}
                name="waypointType"
                className="pk-input"
                value={row.waypointType}
                onChange={(event) => update(row.key, { waypointType: event.target.value })}
              >
                {AUTHORED_WAYPOINT_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {TYPE_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div className="pk-field">
              <label className="pk-field-label" htmlFor={`wp-km-${row.key}`}>
                Kilomètre
              </label>
              <input
                id={`wp-km-${row.key}`}
                name="distanceKm"
                className="pk-input"
                inputMode="decimal"
                autoComplete="off"
                value={row.distanceKm}
                onChange={(event) => update(row.key, { distanceKm: event.target.value })}
                // Le point se range à sa distance quand on quitte son champ.
                onBlur={() => setRows((current) => sortByKm(current))}
              />
              {errors[`waypoints.${String(index)}.distanceKm`] === undefined ? null : (
                <p className="pk-field-error">{errors[`waypoints.${String(index)}.distanceKm`]}</p>
              )}
            </div>
            <div className="pk-field">
              <label className="pk-field-label" htmlFor={`wp-day-${row.key}`}>
                Barrière
              </label>
              <select
                id={`wp-day-${row.key}`}
                className="pk-input"
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
                    {dayLabel(startDay, day)}
                  </option>
                ))}
              </select>
            </div>
            <div className="pk-field">
              <label className="pk-field-label" htmlFor={`wp-time-${row.key}`}>
                Heure
              </label>
              <input
                id={`wp-time-${row.key}`}
                type="time"
                className="pk-input"
                value={row.cutoffTime}
                disabled={row.cutoffDay === ''}
                onChange={(event) => update(row.key, { cutoffTime: event.target.value })}
              />
            </div>
            <button
              type="button"
              className="pk-btn pk-button-ghost"
              disabled={rows.length <= 2}
              aria-label={`Retirer ${row.name === '' ? `le point ${String(index + 1)}` : row.name}`}
              onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
            >
              Retirer
            </button>
          </li>
        ))}
      </ol>

      <div className="or-inline-form">
        <button type="button" className="pk-btn pk-button-secondary" onClick={insertBeforeFinish}>
          Ajouter un point
        </button>
        <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
          {pending ? 'Enregistrement…' : 'Enregistrer les points'}
        </button>
      </div>
      <p className="pk-field-hint">
        Les kilomètres du règlement. La trace mesurée peut en différer : l’écart est signalé, jamais
        corrigé.
      </p>
      <ActionError state={state} />
    </form>
  );
}

const REQUIREMENTS = [
  { value: 'mandatory', label: 'Obligatoire' },
  { value: 'conditional', label: 'Conditionnel' },
  { value: 'recommended', label: 'Recommandé' },
] as const;

function EquipmentFields({
  initial,
  errors,
}: {
  readonly initial?: Pick<RaceEquipmentItem, 'label' | 'requirement' | 'condition' | 'detail'>;
  readonly errors: Readonly<Record<string, string>>;
}) {
  const id = useId();
  const [requirement, setRequirement] = useState<string>(initial?.requirement ?? 'mandatory');

  return (
    <>
      <Input
        id={`${id}-label`}
        name="label"
        label="Nom, tel que le règlement l’écrit"
        placeholder="Veste imperméable avec capuche"
        maxLength={200}
        defaultValue={initial?.label ?? ''}
        error={errors['label']}
      />
      <div className="pk-field">
        <label className="pk-field-label" htmlFor={`${id}-requirement`}>
          Exigence
        </label>
        <select
          id={`${id}-requirement`}
          name="requirement"
          className="pk-input"
          value={requirement}
          onChange={(event) => setRequirement(event.target.value)}
        >
          {REQUIREMENTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {requirement === 'conditional' ? (
        <Input
          id={`${id}-condition`}
          name="condition"
          label="Condition"
          placeholder="Si la température prévue est sous 5 °C"
          maxLength={300}
          defaultValue={initial?.condition ?? ''}
          error={errors['condition']}
        />
      ) : (
        <input type="hidden" name="condition" value="" />
      )}
      <Input
        id={`${id}-detail`}
        name="detail"
        label="Précision (facultative)"
        maxLength={500}
        defaultValue={initial?.detail ?? ''}
        error={errors['detail']}
      />
    </>
  );
}

export function AddEquipmentForm({ scope }: { readonly scope: RaceScope }) {
  const [state, action, pending] = useActionState(addEquipmentAction, INITIAL);

  return (
    <form action={action} className="cr-revise" noValidate>
      <ScopeFields scope={scope} />
      <EquipmentFields errors={state.fieldErrors ?? {}} />
      <div className="or-inline-form">
        <button type="submit" className="pk-btn pk-button-secondary" disabled={pending}>
          {pending ? 'Ajout…' : 'Ajouter ce matériel'}
        </button>
      </div>
      <ActionError state={state} />
    </form>
  );
}

export function ReviseEquipmentForm({
  scope,
  item,
}: {
  readonly scope: RaceScope;
  readonly item: RaceEquipmentItem;
}) {
  const [state, action, pending] = useActionState(reviseEquipmentAction, INITIAL);

  return (
    <form action={action} className="cr-revise" noValidate>
      <ScopeFields scope={scope} />
      <input type="hidden" name="factId" value={item.factId} />
      <EquipmentFields initial={item} errors={state.fieldErrors ?? {}} />
      <div className="or-inline-form">
        <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
          {pending ? 'Publication…' : 'Publier la correction'}
        </button>
      </div>
      <ActionError state={state} />
    </form>
  );
}

export function CancelRaceForm({
  scope,
  raceName,
}: {
  readonly scope: RaceScope;
  readonly raceName: string;
}) {
  const [state, action, pending] = useActionState(cancelRaceAction, INITIAL);

  return (
    <form action={action} className="cr-revise">
      <ScopeFields scope={scope} />
      <p className="pk-field-hint">
        L’annulation est visible des coureurs, et les participants qui ont activé leur compte
        reçoivent un e-mail. Vous pourrez la lever depuis cet écran : ils en seront avertis de la
        même façon.
      </p>
      <div className="or-inline-form">
        <button
          type="submit"
          className="pk-btn pk-button-secondary"
          disabled={pending}
          aria-label={`Confirmer l’annulation de ${raceName}`}
        >
          {pending ? 'Annulation…' : `Annuler ${raceName} et avertir les participants`}
        </button>
      </div>
      <ActionError state={state} />
    </form>
  );
}

export function ReinstateRaceForm({
  scope,
  raceName,
}: {
  readonly scope: RaceScope;
  readonly raceName: string;
}) {
  const [state, action, pending] = useActionState(reinstateRaceAction, INITIAL);

  return (
    <form action={action} className="cr-revise">
      <ScopeFields scope={scope} />
      <p className="pk-field-hint">
        L’épreuve redevient publiée, et les participants qui ont activé leur compte reçoivent un
        e-mail.
      </p>
      <div className="or-inline-form">
        <button type="submit" className="pk-btn pk-button-secondary" disabled={pending}>
          {pending ? 'Rétablissement…' : `Rétablir ${raceName} et avertir les participants`}
        </button>
      </div>
      <ActionError state={state} />
    </form>
  );
}
