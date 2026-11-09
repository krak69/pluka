'use client';

import { Button, Input } from '@pluka/ui';
import { useActionState, useState } from 'react';

import { estimateRepereAction, type RepereActionState } from '@/app/repere-actions';

const INITIAL: RepereActionState = {};

/** Secondes → `5h40`. */
function label(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return `${String(hours)}h${String(minutes).padStart(2, '0')}`;
}

/** Secondes → `5:40`, la forme du champ objectif. */
function clock(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return `${String(hours)}:${String(minutes).padStart(2, '0')}`;
}

export interface RepereDefaults {
  readonly distanceKm: number | null;
  readonly elevationGainM: number | null;
  readonly durationSeconds: number | null;
  readonly date: string | null;
  readonly paceSecondsPerKm: number | null;
}

/**
 * « Estime-le pour moi » — docs/engines/REPERE_PLUKA.md §1.
 *
 * Un formulaire à part, sous celui de l'objectif : une plage ne doit jamais
 * partir avec l'objectif sans que le coureur l'ait reprise. « Partir de ce
 * repère » remplit le champ, il ne valide rien.
 */
export function RepereHelper({
  participantRaceId,
  targetInputId,
  defaults,
}: {
  readonly participantRaceId: string;
  readonly targetInputId: string;
  readonly defaults: RepereDefaults;
}) {
  const [state, submit, pending] = useActionState(estimateRepereAction, INITIAL);
  const hasEffort = defaults.distanceKm !== null || defaults.paceSecondsPerKm === null;
  const [kind, setKind] = useState<'effort' | 'pace'>(hasEffort ? 'effort' : 'pace');

  function applyRange(seconds: number) {
    const input = document.getElementById(targetInputId);
    if (input instanceof HTMLInputElement) {
      input.value = clock(seconds);
      input.focus();
    }
  }

  return (
    <details className="st-details rp-repere">
      <summary>
        Estime-le pour moi <span className="rp-beta">Bêta</span>
      </summary>

      <p className="pk-body">
        Donne une course ou une sortie longue récente : PLUKA la transpose sur ce parcours et propose
        une plage indicative. Ce n’est pas une prédiction, et c’est toi qui choisis ton objectif.
      </p>

      <form action={submit} className="rp-form">
        <input type="hidden" name="participantRaceId" value={participantRaceId} />
        <input type="hidden" name="kind" value={kind} />

        <div className="rp-repere-kinds" role="radiogroup" aria-label="Ma référence">
          <label>
            <input
              type="radio"
              checked={kind === 'effort'}
              onChange={() => setKind('effort')}
            />{' '}
            Une sortie récente
          </label>
          <label>
            <input type="radio" checked={kind === 'pace'} onChange={() => setKind('pace')} /> Mon
            allure trail habituelle
          </label>
        </div>

        {kind === 'effort' ? (
          <>
            <Input
              id="repere-distance"
              name="distance"
              label="Distance (km)"
              inputMode="decimal"
              defaultValue={defaults.distanceKm === null ? '' : String(defaults.distanceKm)}
            />
            <Input
              id="repere-elevation"
              name="elevation"
              label="D+ (m)"
              inputMode="numeric"
              defaultValue={defaults.elevationGainM === null ? '' : String(defaults.elevationGainM)}
            />
            <Input
              id="repere-duration"
              name="duration"
              label="Temps"
              hint="Format H:MM, arrêts compris."
              placeholder="2:30"
              defaultValue={defaults.durationSeconds === null ? '' : clock(defaults.durationSeconds)}
            />
            <Input
              id="repere-date"
              name="date"
              type="date"
              label="Date (facultatif)"
              defaultValue={defaults.date ?? ''}
            />
          </>
        ) : (
          <Input
            id="repere-pace"
            name="pace"
            label="Allure (min/km)"
            hint="Ton allure moyenne sur une sortie trail ordinaire, au format M:SS."
            placeholder="9:30"
            defaultValue={
              defaults.paceSecondsPerKm === null
                ? ''
                : `${String(Math.floor(defaults.paceSecondsPerKm / 60))}:${String(defaults.paceSecondsPerKm % 60).padStart(2, '0')}`
            }
          />
        )}

        <div className="rp-form-actions">
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? 'Calcul…' : 'Estimer'}
          </Button>
        </div>
      </form>

      {state.error === undefined ? null : (
        <p className="pk-field-error" role="alert">
          {state.error}
        </p>
      )}
      {state.refusal === undefined ? null : (
        <p className="pk-body" role="status">
          {state.refusal}
        </p>
      )}
      {state.range === undefined ? null : (
        <div className="rp-repere-result" role="status">
          <p className="pk-h2">
            Repère PLUKA : {label(state.range.lowSeconds)}–{label(state.range.highSeconds)}
          </p>
          <p className="rp-hint">
            {state.range.approximate
              ? 'Repère approximatif : tiré d’une allure, pas d’une sortie réelle.'
              : 'Une plage indicative, tirée de ta sortie : pas une garantie.'}
            {state.range.exceedsCutoff
              ? ' Attention : le haut de la plage dépasse la barrière d’arrivée.'
              : ''}
          </p>
          <p className="rp-hint">
            Tu as couru une course après une sortie de ce genre ?{' '}
            <a href="/profil/repere" className="pk-link">
              Aide à calibrer le Repère
            </a>
            .
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => applyRange(state.range?.centralSeconds ?? 0)}
          >
            Partir de ce repère ({label(state.range.centralSeconds)})
          </Button>
        </div>
      )}
    </details>
  );
}
