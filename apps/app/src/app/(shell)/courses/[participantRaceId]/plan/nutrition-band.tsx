import type { NutritionStrategyView } from '@pluka/domain';
import Link from 'next/link';

import { disableNutritionAction } from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-actions';
import {
  NutritionDialog,
  type NutritionGoals,
} from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-dialog';
import { NutritionSendAlert } from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-send';
import { NutritionViews } from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-views';
import {
  aidLines,
  flaskView,
  plannedIntake,
  preparationLines,
  sectionsWithFlasks,
  strategyLines,
} from '@/lib/nutrition-format';

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
  flaskCount: 2,
  flaskCapacityMl: 500,
  bladderMl: null,
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
    flaskCount: settings.flaskCount,
    flaskCapacityMl: settings.flaskCapacityMl,
    bladderMl: settings.bladderMl,
  };
}

function productMeta(product: {
  readonly carbsG: number;
  readonly sodiumMg: number;
  readonly caffeineMg: number;
}): string {
  const parts = [`${String(Math.round(product.carbsG))} g glucides`];
  if (product.sodiumMg > 0) parts.push(`${String(product.sodiumMg)} mg sodium`);
  if (product.caffeineMg > 0) parts.push(`${String(product.caffeineMg)} mg caféine`);
  return parts.join(' · ');
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
  const planned = plannedIntake(view.result);
  const flasks =
    view.result.flasks === null
      ? null
      : flaskView(view.result.flasks, view.result, view.startAt, view.timezone);
  const preparation =
    view.preparation === null
      ? null
      : preparationLines(view.preparation, view.startAt, view.timezone);
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

      {preparation === null
        ? null
        : preparation.stale.map((line) => (
            <NutritionSendAlert
              key={line.rendezvousId}
              participantRaceId={participantRaceId}
              line={line}
              canSend={view.canEdit}
            />
          ))}

      {lines.summary.warnings.map((warning) => (
        <p key={warning} className="nu-changed" role="status">
          {warning}
        </p>
      ))}

      <NutritionViews
        participantRaceId={participantRaceId}
        milestones={lines.milestones}
        sections={sectionsWithFlasks(lines.sections, flasks)}
        flasks={flasks}
        preparation={preparation}
        aid={aidLines(view.aid)}
        canEdit={view.canEdit}
        products={pickable
          .filter((product) => settings.selectedProductIds.includes(product.id))
          .map((product) => ({ id: product.id, name: product.name, meta: productMeta(product) }))}
      />

      {planned === null ? null : (
        <section className="nu-planned" aria-labelledby="nu-planned-title">
          <h3 id="nu-planned-title" className="nu-planned-title">
            Ce que prévoit ta stratégie
          </h3>
          <p className="nu-meta">Moyenne par heure de course, et total sur la course.</p>
          <dl className="nu-planned-grid">
            {planned.map((row) => (
              <div key={row.label} className="nu-planned-row">
                <dt className="pk-label">{row.label}</dt>
                <dd className="nu-planned-value">
                  {row.perHour} <span className="nu-planned-total">({row.total})</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <form action={disableNutritionAction} className="nu-disable">
        <input type="hidden" name="participantRaceId" value={participantRaceId} />
        <button type="submit" className="pk-btn pk-button-ghost">
          Désactiver la nutrition
        </button>
      </form>
    </section>
  );
}
