import type { NutritionStrategyView } from '@pluka/domain';
import Link from 'next/link';

import { disableNutritionAction } from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-actions';
import {
  NutritionDialog,
  type NutritionGoals,
} from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-dialog';
import { NutritionViews } from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-views';
import { strategyLines } from '@/lib/nutrition-format';

/**
 * La Nutrition sur le Plan — prototype `nutOff` / `nutOn`.
 *
 * Jamais activée par défaut : un bandeau la propose. L'activer ouvre la
 * modale des objectifs ; c'est la stratégie Nutrition complète, au Race Pass
 * (04 §44). Activée, une bande dit tes cibles et le nombre de prises, et ouvre
 * « Mes paramètres » ; dessous, « Ma stratégie » et « Par section ».
 */

const EMPTY: NutritionGoals = {
  carbsGPerHour: null,
  hydrationMlPerHour: null,
  sodiumMgPerHour: null,
  caffeineTotalMg: null,
  waterSharePercent: 50,
  density: 'auto',
  aidBuffer: true,
  placementMode: 'smart',
  intervalMinutes: null,
};

function goalsOf(view: NutritionStrategyView): NutritionGoals {
  const settings = view.settings;
  if (settings === null) return EMPTY;
  return {
    carbsGPerHour: settings.carbsGPerHour,
    hydrationMlPerHour: settings.hydrationMlPerHour,
    sodiumMgPerHour: settings.sodiumMgPerHour,
    caffeineTotalMg: settings.caffeineTotalMg,
    waterSharePercent: settings.waterSharePercent,
    density: settings.density,
    aidBuffer: settings.aidBuffer,
    placementMode: settings.placementMode,
    intervalMinutes: settings.intervalMinutes,
  };
}

export function NutritionBand({
  participantRaceId,
  view,
}: {
  readonly participantRaceId: string;
  readonly view: NutritionStrategyView;
}) {
  if (view.state === 'no_plan') return null;
  // « Mes produits », pour l'étape de choix de la modale.
  const pickable = view.products.map((product) => ({
    id: product.id,
    name: product.brand === null ? product.name : `${product.brand} ${product.name}`,
    category: product.category,
    carbsG: product.carbsG,
    sodiumMg: product.sodiumMg,
    caffeineMg: product.caffeineMg,
    hydrationMl: product.hydrationMl,
  }));

  if (view.state === 'off' || view.result === null || view.settings === null) {
    return (
      <section id="nutrition" className="nu-off" aria-labelledby="nu-off-title">
        <span className="nu-off-text">
          <span id="nu-off-title" className="nu-off-title">
            Nutrition — planifie tes prises directement sur ton plan
          </span>
          <span className="nu-off-body">
            Définis tes objectifs en glucides, hydratation, sodium et caféine : PLUKA place tes
            prises selon ton pacing, le terrain et les ravitaillements.
          </span>
        </span>
        {view.canEdit ? (
          <NutritionDialog
            participantRaceId={participantRaceId}
            initial={goalsOf(view)}
            triggerLabel="Activer la nutrition"
            triggerClassName="pk-btn pk-button-secondary"
            submitLabel="Générer ma stratégie"
            products={pickable}
            selectedIds={view.settings?.selectedProductIds ?? []}
          />
        ) : (
          <Link href={`/offre?course=${participantRaceId}`} className="pk-btn pk-button-secondary">
            Activer avec le Race Pass
          </Link>
        )}
      </section>
    );
  }

  const settings = view.settings;
  const lines = strategyLines(view.result, view.startAt, view.timezone);
  const intakes = view.result.milestones.filter((milestone) => milestone.kind === 'intake').length;
  const targets = `${String(settings.carbsGPerHour)} g/h · ${String(settings.hydrationMlPerHour)} ml/h · ${String(settings.sodiumMgPerHour)} mg/h${
    settings.caffeineTotalMg === null
      ? ' · sans objectif caféine'
      : ` · ${String(settings.caffeineTotalMg)} mg caféine`
  }`;

  return (
    <section id="nutrition" className="nu-on" aria-labelledby="nu-on-title">
      <div className="nu-on-head">
        <span className="nu-on-text">
          <span id="nu-on-title" className="nu-on-title">
            Nutrition
            {lines.summary.coverage === null ? null : (
              <span className="nu-on-coverage">{lines.summary.coverage}</span>
            )}
            <span className="nu-on-count">
              {intakes === 0
                ? 'aucune prise'
                : intakes === 1
                  ? '1 prise'
                  : `${String(intakes)} prises`}
            </span>
          </span>
          <span className="nu-meta">{targets}</span>
          {lines.summary.todo === null ? null : (
            <span className="nu-on-todo">{lines.summary.todo}</span>
          )}
        </span>
        {view.canEdit ? (
          <NutritionDialog
            participantRaceId={participantRaceId}
            initial={goalsOf(view)}
            products={pickable}
            selectedIds={settings.selectedProductIds}
            triggerLabel="Mes paramètres"
            triggerClassName="pk-btn pk-button-secondary"
            submitLabel="Recalculer ma stratégie"
          />
        ) : null}
      </div>

      {view.planChangedSinceSettings ? (
        <p className="nu-changed" role="status">
          Ton plan a changé : tes prises suivent le nouveau plan, avec les mêmes objectifs.
        </p>
      ) : null}

      {lines.summary.warnings.map((warning) => (
        <p key={warning} className="nu-changed" role="status">
          {warning}
        </p>
      ))}

      <NutritionViews milestones={lines.milestones} sections={lines.sections} />

      <form action={disableNutritionAction} className="nu-disable">
        <input type="hidden" name="participantRaceId" value={participantRaceId} />
        <button type="submit" className="pk-btn pk-button-ghost">
          Désactiver la nutrition
        </button>
      </form>
    </section>
  );
}
