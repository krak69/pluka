'use client';

import { useActionState } from 'react';

import type { ActionState } from '@/app/actions';
import {
  acknowledgeStartChangesAction,
  shiftPlanToNewStartAction,
} from '@/app/start-change-actions';

const INITIAL: ActionState = {};

export interface StartChangeView {
  /** « départ de l'épreuve » ou « vague Élite » ; nul quand seule l'heure a bougé. */
  readonly before: string | null;
  readonly after: string | null;
  readonly beforeAt: string;
  readonly afterAt: string;
}

/**
 * « Ton heure de départ a changé » — migration 0082.
 *
 * Le changement le plus récent, avec l'avant et l'après. Le coureur décale son
 * Plan sur la nouvelle heure, en gardant ses durées, ou referme l'alerte : rien
 * ne se recalcule sans lui (AGENTS §15). Aube marque l'action qui l'attend.
 */
export function StartChangeAlert({
  participantRaceId,
  change,
  count,
  canShift,
  canDismiss,
}: {
  readonly participantRaceId: string;
  readonly change: StartChangeView;
  readonly count: number;
  /** Le Plan est encore calé sur l'ancienne heure. */
  readonly canShift: boolean;
  /** Une alerte écrite par la base se referme ; un simple écart d'heure, non. */
  readonly canDismiss: boolean;
}) {
  const [shiftState, shift, shifting] = useActionState(shiftPlanToNewStartAction, INITIAL);
  const [ackState, acknowledge, acknowledging] = useActionState(
    acknowledgeStartChangesAction,
    INITIAL,
  );
  const error = shiftState.error ?? ackState.error;

  return (
    <section className="rp-start-alert" role="status" aria-labelledby="start-alert-title">
      <h2 id="start-alert-title" className="pk-label">
        Ton heure de départ a changé
      </h2>
      <p className="pk-body">
        Avant : {change.before === null ? '' : `${change.before}, `}
        {change.beforeAt}.
        <br />
        Désormais :{' '}
        <strong>
          {change.after === null ? '' : `${change.after}, `}
          {change.afterAt}
        </strong>
        .
      </p>
      {count > 1 ? (
        <p className="rp-hint">
          {count} changements depuis ta dernière visite : voici le plus récent.
        </p>
      ) : null}
      <p className="rp-hint">
        {canShift
          ? 'Ton Plan est encore calé sur l’ancienne heure. Le décaler garde tes durées et tes arrêts ; seuls les horaires bougent.'
          : 'Ton Plan suit déjà cette heure.'}
      </p>

      <div className="rp-start-alert-actions">
        {canShift ? (
          <form action={shift}>
            <input type="hidden" name="participantRaceId" value={participantRaceId} />
            <button
              type="submit"
              className="pk-btn pk-button-primary"
              disabled={shifting || acknowledging}
            >
              Décaler mon Plan sur la nouvelle heure
            </button>
          </form>
        ) : null}
        {canDismiss ? (
          <form action={acknowledge}>
            <input type="hidden" name="participantRaceId" value={participantRaceId} />
            <button
              type="submit"
              className="pk-btn pk-button-secondary"
              disabled={shifting || acknowledging}
            >
              {canShift ? 'Refermer sans décaler' : 'J’ai compris'}
            </button>
          </form>
        ) : null}
      </div>

      {error === undefined ? null : (
        <p className="pk-field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
