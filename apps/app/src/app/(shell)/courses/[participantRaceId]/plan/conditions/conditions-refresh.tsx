'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { requestConditionsRefreshAction } from '@/app/(shell)/courses/[participantRaceId]/plan/conditions/actions';

/** Toutes les 5 s, pendant une minute au plus : le worker prend le relais. */
const POLL_MS = 5000;
const POLL_TIMES = 12;

/**
 * WEATHER_CONDITIONS §31 : à l'ouverture, une prévision absente ou trop
 * ancienne est redemandée — une fois, jamais à chaque rendu. Le domaine
 * revérifie tout ; le worker appelle le fournisseur. L'écran se relit jusqu'à
 * l'arrivée de la nouvelle prévision, qui change `version`.
 */
export function ConditionsRefresh({
  participantRaceId,
  due,
  version,
}: {
  readonly participantRaceId: string;
  readonly due: boolean;
  /** L'heure de la prévision affichée : quand elle change, l'attente s'arrête. */
  readonly version: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!due) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    void requestConditionsRefreshAction(participantRaceId).then((outcome) => {
      if (cancelled) return;
      if (outcome.result !== 'queued' && outcome.result !== 'already_queued') return;
      setPending(true);
      let tries = 0;
      timer = setInterval(() => {
        tries += 1;
        router.refresh();
        if (tries >= POLL_TIMES) {
          clearInterval(timer);
          setPending(false);
        }
      }, POLL_MS);
    });
    return () => {
      cancelled = true;
      if (timer !== undefined) clearInterval(timer);
    };
  }, [due, version, participantRaceId, router]);

  if (!due || !pending) return null;
  return (
    <p className="cd-refreshing" role="status">
      Mise à jour de la prévision en cours…
    </p>
  );
}
