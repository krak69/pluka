'use client';

import { Button, MicroLabel } from '@pluka/ui';
import { useActionState } from 'react';

import { attachToRaceAction, type AttachState } from '@/app/epreuves/actions';

const INITIAL: AttachState = {};

/**
 * « Je prépare cette course » — `05_ROUTES_FLOWS.md` §1.7.
 *
 * Le bouton existe toujours. S'il n'y a pas de session, l'action emmène à la
 * connexion en conservant la fiche comme destination ; si l'épreuve n'accepte
 * pas de rattachement, le refus s'affiche ici, à côté du bouton.
 *
 * PLAN_ENGINE §45 : « la sécurité ne doit jamais être un bouton masqué côté UI
 * seulement ». Un coureur apprend ce qui bloque plutôt que de chercher un
 * bouton absent.
 */
export function AttachToRace({
  raceId,
  returnTo,
  raceName,
}: {
  readonly raceId: string;
  readonly returnTo: string;
  readonly raceName: string;
}) {
  const [state, attach] = useActionState(attachToRaceAction, INITIAL);

  return (
    <section className="rp-attach">
      <MicroLabel>Préparer cette course</MicroLabel>

      <h2 className="pk-h2" style={{ margin: 'var(--space-2) 0 var(--space-3)' }}>
        Tu prépares {raceName} ?
      </h2>

      <p className="pk-body rp-measure">
        PLUKA construit ton plan à partir du parcours réel et des informations officielles de cette
        épreuve. Tu fixes ton objectif juste après.
      </p>

      <form action={attach} className="rp-attach-form">
        <input type="hidden" name="raceId" value={raceId} />
        <input type="hidden" name="returnTo" value={returnTo} />

        <Button type="submit" variant="primary">
          Je prépare cette course
        </Button>
      </form>

      {state.error === undefined ? null : (
        <p className="rp-refusal" role="alert">
          {state.error}
        </p>
      )}
    </section>
  );
}
