'use client';

import { Button, Input, MicroLabel } from '@pluka/ui';
import { useActionState } from 'react';

import { generatePlanAction, type ActionState } from '@/app/actions';

const INITIAL: ActionState = {};

/**
 * Génération du Plan initial — PLAN_ENGINE §22.3, §41.
 *
 * « La génération initiale utilise de fait rebalance_to_target, puisque le
 * moteur doit produire un Plan terminant sur l'objectif utilisateur. » Le mode
 * n'est donc pas offert : il n'y a rien à choisir.
 *
 * 00_PRODUCT_SPEC §9.1 : « le coureur choisit l'objectif qu'il veut préparer,
 * en HH:MM. L'objectif reste la décision du coureur. » Aucune suggestion n'est
 * affichée ici — le Repère PLUKA n'est ni spécifié ni calibré (§46), et
 * proposer un chrono sans modèle validé serait exactement ce que §49 d'AGENTS
 * appelle une fausse confiance.
 */
export function GeneratePlanForm({ participantRaceId }: { readonly participantRaceId: string }) {
  const [state, generate] = useActionState(generatePlanAction, INITIAL);

  return (
    <section>
      <MicroLabel>Premier Plan</MicroLabel>
      <h2 className="pk-h2" style={{ margin: 'var(--space-2) 0 var(--space-3)' }}>
        Quel objectif préparez-vous ?
      </h2>

      <p className="pk-body" style={{ color: 'var(--pk-text-muted)', maxWidth: '62ch' }}>
        PLUKA construit le Plan autour de la durée que vous visez. Vous pourrez la changer à tout
        moment.
      </p>

      <form action={generate} style={{ marginTop: 'var(--space-5)' }}>
        <input type="hidden" name="participantRaceId" value={participantRaceId} />
        <Input
          id="plan-initial-target"
          name="target"
          label="Objectif"
          hint="Format HH:MM, arrêts compris."
          placeholder="13:30"
          {...(state.error === undefined ? {} : { error: state.error })}
        />
        <Button type="submit" variant="primary">
          Créer le Plan
        </Button>
      </form>
    </section>
  );
}
