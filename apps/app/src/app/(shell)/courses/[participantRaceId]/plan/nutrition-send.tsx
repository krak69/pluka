'use client';

import { useState, useTransition } from 'react';

import { sendNutritionAction } from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-actions';
import type { SendLine } from '@/lib/nutrition-format';

/**
 * « Envoyer à mon accompagnant » — 0109, NUTRITION_ENGINE §55. La page privée
 * de l'accompagnant montre une copie figée de ce qu'il doit donner ; quand la
 * stratégie change, la copie est périmée et l'écran le dit fort, là où le
 * coureur règle sa stratégie comme là où il prépare son Assistance.
 */

function SendButton({
  participantRaceId,
  line,
  primary,
}: {
  readonly participantRaceId: string;
  readonly line: SendLine;
  readonly primary: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (line.action === null) return null;

  return (
    <>
      <button
        type="button"
        className={`pk-btn ${primary ? 'pk-button-primary' : 'pk-button-secondary'} nu-send-button`}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const outcome = await sendNutritionAction(participantRaceId, line.rendezvousId);
            setError(outcome.error ?? null);
          })
        }
      >
        {pending ? 'Envoi…' : line.action}
      </button>
      {error === null ? null : (
        <p className="pk-field-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** La liste d'un accompagnant n'est plus à jour : une alerte qui ne se rate pas. */
export function NutritionSendAlert({
  participantRaceId,
  line,
  canSend,
}: {
  readonly participantRaceId: string;
  readonly line: SendLine;
  readonly canSend: boolean;
}) {
  return (
    <div className="nu-send-alert" role="alert">
      <p className="nu-send-alert-title">{line.title}</p>
      <p className="nu-send-alert-text">{line.text}</p>
      {line.seen.length === 0 ? null : (
        <div className="nu-send-alert-seen">
          <span className="pk-label">Sur sa page en ce moment</span>
          <ul>
            {line.seen.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </div>
      )}
      {canSend ? <SendButton participantRaceId={participantRaceId} line={line} primary /> : null}
    </div>
  );
}

/**
 * « Prévenir Alice » : le message part du téléphone du coureur (menu de
 * partage : SMS, WhatsApp…), ou se copie. PLUKA n'écrit à personne et ne
 * stocke rien de plus.
 */
function NotifyButton({ notify }: { readonly notify: NonNullable<SendLine['notify']> }) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');

  const share = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text: notify.message });
        return;
      } catch (error) {
        // Le coureur a fermé le menu de partage : rien à faire.
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(notify.message);
      setState('copied');
    } catch {
      setState('manual');
    }
  };

  return (
    <div className="nu-notify">
      <button
        type="button"
        className="pk-btn pk-button-secondary nu-send-button"
        onClick={() => void share()}
      >
        {notify.label}
      </button>
      {state === 'copied' ? (
        <p className="nu-meta" role="status">
          Message copié : colle-le dans ta conversation.
        </p>
      ) : null}
      {state === 'manual' ? (
        <textarea
          className="pk-input nu-notify-text"
          readOnly
          rows={notify.message.split('\n').length + 1}
          value={notify.message}
          aria-label="Message à envoyer"
          onFocus={(event) =>
            event.currentTarget.setSelectionRange(0, event.currentTarget.value.length)
          }
        />
      ) : null}
    </div>
  );
}

/** Où en est l'envoi d'un rendez-vous : à envoyer, à jour, ou périmé. */
export function NutritionSendStatus({
  participantRaceId,
  line,
  canSend,
}: {
  readonly participantRaceId: string;
  readonly line: SendLine;
  readonly canSend: boolean;
}) {
  if (line.status === 'stale') {
    return (
      <NutritionSendAlert participantRaceId={participantRaceId} line={line} canSend={canSend} />
    );
  }
  return (
    <div className={line.status === 'sent' ? 'nu-send nu-send-ok' : 'nu-send'}>
      <p className="nu-send-text">{line.text}</p>
      {canSend ? (
        <SendButton participantRaceId={participantRaceId} line={line} primary={false} />
      ) : null}
      {line.notify === null ? null : <NotifyButton notify={line.notify} />}
    </div>
  );
}
