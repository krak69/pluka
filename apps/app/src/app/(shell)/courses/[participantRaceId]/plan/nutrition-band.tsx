import type { NutritionStrategyView } from '@pluka/domain';
import Link from 'next/link';

import { disableNutritionAction } from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-actions';
import {
  NutritionDialog,
  type NutritionGoals,
} from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-dialog';
import { PreparationDrawer } from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-prep';
import {
  NutritionReview,
  OrphanPanel,
} from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-review';
import { NutritionSendAlert } from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-send';
import {
  NutritionBarActions,
  NutritionViews,
} from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-views';
import { Icon } from '@/components/icon';
import { conditionsBand, conditionsDraft } from '@/lib/nutrition-conditions';
import {
  aidLines,
  flaskView,
  orphanLines,
  plannedIntake,
  preparationLines,
  reviewLines,
  sectionsWithFlasks,
  strategyLines,
} from '@/lib/nutrition-format';

/**
 * La Nutrition sur le Plan — prototype `nutOff` / `nutOn`.
 *
 * Jamais activée par défaut : un bandeau la propose. L'activer ouvre la
 * modale des objectifs ; c'est la stratégie Nutrition complète, au Race Pass
 * (04 §44). Activée, une bande blanche dit la couverture, ce qui reste à
 * compléter et tes cibles, avec « Masquer mes prises », « À préparer » (un
 * tiroir à droite) et « Mes paramètres ». Dessous, les onglets : « Ma
 * stratégie » est la frise du Plan elle-même, prises comprises.
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

/** « Mes produits », pour l'étape de choix de la modale. */
function pickableOf(view: NutritionStrategyView) {
  return view.products.map((product) => ({
    id: product.id,
    name: product.brand === null ? product.name : `${product.brand} ${product.name}`,
    category: product.category,
    carbsG: product.carbsG,
    sodiumMg: product.sodiumMg,
    caffeineMg: product.caffeineMg,
    hydrationMl: product.hydrationMl,
  }));
}

export function NutritionBand({
  participantRaceId,
  view,
}: {
  readonly participantRaceId: string;
  readonly view: NutritionStrategyView;
}) {
  if (view.state === 'no_plan') return null;
  const conditions = conditionsDraft(view);
  const pickable = pickableOf(view);

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
            conditions={conditions}
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
  const flasks =
    view.result.flasks === null
      ? null
      : flaskView(view.result.flasks, view.result, view.startAt, view.timezone);
  const preparation =
    view.preparation === null
      ? null
      : preparationLines(view.preparation, view.startAt, view.timezone);
  const orphans = orphanLines(view.toPlace, view.result, view.startAt, view.timezone);
  const band = conditionsBand(view);
  const aid = aidLines(view.aid);
  const intakes = view.result.milestones.filter((milestone) => milestone.kind === 'intake').length;
  const count =
    intakes === 0 ? 'aucune prise' : intakes === 1 ? '1 prise' : `${String(intakes)} prises`;
  const targets = `${String(settings.carbsGPerHour)} g/h · ${String(settings.hydrationMlPerHour)} ml/h · ${String(settings.sodiumMgPerHour)} mg/h${
    settings.caffeineTotalMg === null
      ? ' · sans objectif caféine'
      : ` · ${String(settings.caffeineTotalMg)} mg caféine`
  }`;

  return (
    <section id="nutrition" className="nu-on" aria-labelledby="nu-on-title">
      <div className="nu-bar">
        <div className="nu-bar-text">
          <p className="nu-bar-line">
            <span id="nu-on-title" className="nu-bar-label">
              Nutrition
            </span>
            <span className="nu-bar-coverage">{lines.summary.coverage ?? count}</span>
            {lines.summary.todo === null ? null : (
              <span className="nu-bar-todo">{lines.summary.todo}</span>
            )}
          </p>
          <p className="nu-meta">
            {targets} · {count}
          </p>
        </div>
        <div className="nu-bar-actions">
          <NutritionBarActions hasIntakes={intakes > 0} hasPreparation={preparation !== null} />
          {view.canEdit ? (
            <NutritionDialog
              participantRaceId={participantRaceId}
              initial={goalsOf(view)}
              products={pickable}
              selectedIds={settings.selectedProductIds}
              triggerLabel={
                <>
                  <Icon name="SlidersHorizontal" size={16} />
                  Mes paramètres
                </>
              }
              triggerClassName="pk-btn pk-button-secondary nu-bar-btn"
              submitLabel="Recalculer ma stratégie"
              conditions={conditions}
            />
          ) : null}
        </div>
      </div>

      {band === null ? null : (
        <div className="nu-conds">
          {band.periods.length === 0 ? null : (
            <ul className="nu-cond-periods" aria-label="Tes plages de conditions">
              {band.periods.map((period) => (
                <li key={period.key} className="nu-cond-period" data-type={period.type}>
                  <span className="nu-cond-dot" aria-hidden="true" />
                  {period.label}
                  {period.clock === null ? null : (
                    <span className="nu-meta"> ({period.clock})</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {band.profiles.map((line) => (
            <span key={line} className="nu-meta">
              {line}
            </span>
          ))}
          {band.caffeine === null ? null : <span className="nu-meta">{band.caffeine}</span>}
        </div>
      )}

      {(band?.warnings ?? []).map((warning) => (
        <p key={warning} className="nu-changed" role="status">
          {warning}
        </p>
      ))}

      {view.review === null ? null : (
        <NutritionReview
          participantRaceId={participantRaceId}
          review={reviewLines(view.review, view.startAt, view.timezone)}
        />
      )}

      <OrphanPanel
        participantRaceId={participantRaceId}
        lines={orphans.lines}
        targets={orphans.targets}
        canEdit={view.canEdit}
      />

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
        sections={sectionsWithFlasks(lines.sections, flasks)}
        flasks={flasks}
        aid={aid}
        canEdit={view.canEdit}
      />

      {preparation === null ? null : (
        <PreparationDrawer
          participantRaceId={participantRaceId}
          preparation={preparation}
          aid={aid}
          canEdit={view.canEdit}
        />
      )}
    </section>
  );
}

/**
 * Après la frise : ce que prévoit la stratégie, en moyenne et au total, et la
 * désactivation — volontairement discrète (§28 du Design System).
 */
export function NutritionFoot({
  participantRaceId,
  view,
}: {
  readonly participantRaceId: string;
  readonly view: NutritionStrategyView;
}) {
  if (view.state !== 'ready' || view.result === null || view.settings === null) return null;
  const planned = plannedIntake(view.result);

  return (
    <section className="nu-foot" aria-label="Ta stratégie Nutrition">
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
