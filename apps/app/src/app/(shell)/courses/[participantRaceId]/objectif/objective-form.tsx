'use client';

import { Button, Input, MicroLabel } from '@pluka/ui';
import { useActionState } from 'react';

import { generatePlanAction, type ActionState } from '@/app/actions';
import { setObjectiveAction } from '@/app/profile-actions';

const INITIAL: ActionState = {};

/** Secondes → `HH:MM`. */
function toClock(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  return `${String(hours)}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Saisie de l'objectif.
 *
 * Deux actions derrière un même champ, selon qu'un Plan existe : la génération
 * initiale le crée, `changePlanTarget` le recale. PLAN_ENGINE §22.3 note que la
 * génération initiale « utilise de fait rebalance_to_target » — le mode n'est
 * donc pas offert, il n'y a rien à choisir.
 *
 * Le refus s'affiche sous le bouton. §45 : « la sécurité ne doit jamais être un
 * bouton masqué côté UI seulement » — l'édition d'objectif demande un Race Pass
 * (04_ENTITLEMENTS §6), le bouton reste, et le domaine répond pourquoi.
 */
export function ObjectiveForm({
  participantRaceId,
  currentTargetSeconds,
  hasPlan,
}: {
  readonly participantRaceId: string;
  readonly currentTargetSeconds: number | null;
  readonly hasPlan: boolean;
}) {
  const [state, submit] = useActionState(
    hasPlan ? setObjectiveAction : generatePlanAction,
    INITIAL,
  );

  return (
    <section>
      <MicroLabel>{hasPlan ? 'Changer d’objectif' : 'Premier objectif'}</MicroLabel>

      <h2 className="pk-h2" style={{ margin: 'var(--space-2) 0 var(--space-3)' }}>
        Quel chrono prépares-tu ?
      </h2>

      <form action={submit} className="rp-form">
        <input type="hidden" name="participantRaceId" value={participantRaceId} />

        <Input
          id="objective-target"
          name="target"
          label="Objectif"
          hint="Format HH:MM, arrêts compris."
          placeholder="12:30"
          defaultValue={currentTargetSeconds === null ? '' : toClock(currentTargetSeconds)}
          {...(state.error === undefined ? {} : { error: state.error })}
        />

        <div className="rp-form-actions">
          <Button type="submit" variant="primary">
            {hasPlan ? 'Recaler mon plan' : 'Créer mon plan'}
          </Button>
        </div>
      </form>

      <p className="rp-hint">
        {hasPlan
          ? 'Ton plan est recalculé pour finir sur ce chrono. Tes arrêts et tes passages verrouillés sont conservés.'
          : 'PLUKA construit un premier plan, que tu pourras ajuster point par point ensuite.'}
      </p>
    </section>
  );
}
