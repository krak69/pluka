'use client';

import { Input } from '@pluka/ui';
import { useActionState } from 'react';

import { importRaceGpxAction, type ActionState } from '@/app/actions';

const INITIAL: ActionState = {};

/**
 * Dépôt d'un GPX — 01_ARCHITECTURE §15, PLAN_ENGINE §8.
 *
 * Client Component pour la seule restitution du refus, comme les autres
 * formulaires de cette application (§6.2). Aucune validation locale : la
 * taille, l'extension et la forme de l'empreinte sont jugées par
 * `importRaceGpx`, et les redire ici ferait diverger deux listes de règles.
 *
 * `accept` n'est pas une validation : c'est un filtre de sélecteur de
 * fichiers, que le navigateur applique par confort et qu'on peut contourner.
 * Le refus qui fait autorité vient du domaine, et s'affiche contre le champ.
 */
export function ImportGpxForm({ raceId }: { readonly raceId: string }) {
  const [state, action, pending] = useActionState(importRaceGpxAction, INITIAL);

  return (
    <form action={action} style={{ display: 'grid', gap: 'var(--space-5)', maxWidth: '32rem' }}>
      <input type="hidden" name="raceId" value={raceId} />

      <Input
        id="race-gpx"
        name="gpx"
        type="file"
        accept=".gpx,application/gpx+xml"
        label="Trace GPX"
        required
        hint="Le traitement est asynchrone : la géométrie et le prétraitement apparaissent une fois le job terminé."
        error={state.fieldErrors?.['content'] ?? state.fieldErrors?.['fileName']}
      />

      <div>
        <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
          {pending ? 'Dépôt en cours…' : 'Importer le GPX'}
        </button>
      </div>

      {state.error === undefined ? null : (
        <p className="pk-field-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
