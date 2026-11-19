'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';

import type { ActionState } from '@/app/actions';
import {
  saveNutritionAction,
  type PickableProduct,
} from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-actions';
import { ProductsStep } from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-products-step';

const INITIAL: ActionState = {};

export interface NutritionGoals {
  readonly carbsGPerHour: number | null;
  readonly hydrationMlPerHour: number | null;
  readonly sodiumMgPerHour: number | null;
  readonly caffeineTotalMg: number | null;
  readonly waterSharePercent: number;
  readonly density: 'frequent' | 'auto' | 'sparse';
  readonly aidBuffer: boolean;
  readonly placementMode: 'smart' | 'interval';
  readonly intervalMinutes: number | null;
}

const INTERVALS = [15, 20, 30, 45, 60] as const;

type Split = 'water' | 'half' | 'custom';

function splitOf(percent: number): Split {
  if (percent === 100) return 'water';
  if (percent === 50) return 'half';
  return 'custom';
}

/**
 * « Tes objectifs nutritionnels » — prototype, `nutStepConfig`.
 *
 * Une modale ouverte depuis le Plan : tes cibles horaires, la répartition de
 * ton hydratation, le placement des prises (Intelligent, ou un rythme imposé
 * en option avancée). Aucune valeur proposée : ce sont tes objectifs
 * (NUTRITION_ENGINE §1). Enregistrer active la Nutrition.
 */
export function NutritionDialog({
  participantRaceId,
  initial,
  triggerLabel,
  triggerClassName,
  submitLabel,
  products,
  selectedIds,
}: {
  readonly participantRaceId: string;
  readonly initial: NutritionGoals;
  readonly triggerLabel: string;
  readonly triggerClassName: string;
  readonly submitLabel: string;
  readonly products: readonly PickableProduct[];
  readonly selectedIds: readonly string[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [state, save, pending] = useActionState(saveNutritionAction, INITIAL);
  const answered = useRef(state);
  const id = useId();

  const [hydration, setHydration] = useState(initial.hydrationMlPerHour ?? 0);
  const [split, setSplit] = useState<Split>(splitOf(initial.waterSharePercent));
  const [waterPercent, setWaterPercent] = useState(initial.waterSharePercent);
  const [mode, setMode] = useState(initial.placementMode);
  const [interval, setInterval] = useState(initial.intervalMinutes ?? 30);
  const [advanced, setAdvanced] = useState(initial.placementMode === 'interval');

  const share = split === 'water' ? 100 : split === 'half' ? 50 : waterPercent;
  const waterMl = Math.round((hydration * share) / 100);

  // Enregistré sans refus : la modale se referme sur la stratégie calculée.
  useEffect(() => {
    if (state === answered.current) return;
    answered.current = state;
    if (state.error === undefined) {
      dialog.current?.close();
      setStep(1);
    }
  }, [state]);

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        onClick={() => dialog.current?.showModal()}
      >
        {triggerLabel}
      </button>
      <dialog ref={dialog} className="nu-dialog" aria-labelledby={`${id}-title`}>
        <form
          ref={form}
          action={save}
          className="nu-dialog-form"
          aria-busy={pending}
          onKeyDown={(event) => {
            // Entrée dans un champ ne soumet jamais la modale : elle enregistrerait
            // la stratégie et se refermerait au milieu d'un ajout de produit.
            // Chaque champ qui a une action à lui (recherche, création, volume)
            // la déclenche lui-même ; à l'étape 1, Entrée passe aux produits.
            if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return;
            event.preventDefault();
            if (step === 1 && form.current?.reportValidity() !== false) setStep(2);
          }}
        >
          <input type="hidden" name="participantRaceId" value={participantRaceId} />
          <input type="hidden" name="waterSharePercent" value={share} />
          <input type="hidden" name="placementMode" value={mode} />
          <input type="hidden" name="intervalMinutes" value={interval} />
          <input type="hidden" name="density" value={initial.density} />

          <div className="nu-step" hidden={step !== 1}>
            <h2 id={`${id}-title`} className="nu-dialog-title">
              Tes objectifs nutritionnels
            </h2>
            <p className="nu-dialog-body">
              Tu choisis tes cibles horaires, PLUKA les répartit sur ton plan de course. Tu pourras
              les modifier à tout moment.
            </p>

            <div className="nu-fields">
              <label className="pk-field">
                <span className="pk-field-label">Glucides (g/h)</span>
                <input
                  name="carbsGPerHour"
                  className="pk-input"
                  inputMode="decimal"
                  required
                  defaultValue={initial.carbsGPerHour ?? ''}
                />
              </label>
              <label className="pk-field">
                <span className="pk-field-label">Hydratation (ml/h)</span>
                <input
                  name="hydrationMlPerHour"
                  className="pk-input"
                  inputMode="numeric"
                  required
                  value={hydration === 0 && initial.hydrationMlPerHour === null ? '' : hydration}
                  onChange={(event) => setHydration(Number(event.target.value) || 0)}
                />
              </label>
              <label className="pk-field">
                <span className="pk-field-label">Sodium (mg/h)</span>
                <input
                  name="sodiumMgPerHour"
                  className="pk-input"
                  inputMode="numeric"
                  required
                  defaultValue={initial.sodiumMgPerHour ?? ''}
                />
              </label>
              <label className="pk-field">
                <span className="pk-field-label">Caféine (mg au total)</span>
                <input
                  name="caffeineTotalMg"
                  className="pk-input"
                  inputMode="numeric"
                  placeholder="Facultatif"
                  defaultValue={initial.caffeineTotalMg ?? ''}
                />
              </label>
            </div>

            <fieldset className="nu-fieldset">
              <legend className="pk-field-label">Comment veux-tu répartir ton hydratation ?</legend>
              <div className="nu-chips">
                {(
                  [
                    ['water', '100 % eau'],
                    ['half', '50 % eau / 50 % boisson'],
                    ['custom', 'Personnaliser'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className="nu-chip"
                    aria-pressed={split === value}
                    onClick={() => setSplit(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {split === 'custom' ? (
                <label className="nu-range-label">
                  <span>
                    Eau {String(waterPercent)} % · boisson d’effort {String(100 - waterPercent)} %
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={waterPercent}
                    onChange={(event) => setWaterPercent(Number(event.target.value))}
                    className="nu-range"
                  />
                </label>
              ) : null}
              <p className="pk-field-hint">
                {hydration > 0
                  ? `${String(waterMl)} ml/h d’eau + ${String(hydration - waterMl)} ml/h de boisson d’effort`
                  : 'Indique ton hydratation horaire pour voir la répartition.'}
              </p>
            </fieldset>

            <fieldset className="nu-fieldset">
              <legend className="pk-field-label">Placement des prises</legend>
              <p className="nu-place">
                <strong>
                  {mode === 'interval'
                    ? `Rythme imposé — toutes les ${String(interval)} min`
                    : 'Intelligent'}
                </strong>
                <span>
                  PLUKA place les prises selon ton plan, les ravitaillements et le terrain : en
                  montée ou sur le plat plutôt qu’en pleine descente.
                </span>
              </p>
              <button
                type="button"
                className="pk-btn pk-button-ghost nu-advanced"
                aria-expanded={advanced}
                onClick={() => setAdvanced((open) => !open)}
              >
                {advanced ? 'Masquer les options avancées' : 'Options avancées'}
              </button>
              {advanced ? (
                <div className="nu-advanced-body">
                  <span className="pk-field-label">Rythme</span>
                  <div className="nu-chips">
                    <button
                      type="button"
                      className="nu-chip"
                      aria-pressed={mode === 'smart'}
                      onClick={() => setMode('smart')}
                    >
                      Intelligent
                    </button>
                    {INTERVALS.map((minutes) => (
                      <button
                        key={minutes}
                        type="button"
                        className="nu-chip"
                        aria-pressed={mode === 'interval' && interval === minutes}
                        onClick={() => {
                          setMode('interval');
                          setInterval(minutes);
                        }}
                      >
                        {minutes} min
                      </button>
                    ))}
                  </div>
                  <label className="as-check">
                    <input type="checkbox" name="aidBuffer" defaultChecked={initial.aidBuffer} />
                    <span>Éviter une prise juste avant un ravitaillement</span>
                  </label>
                </div>
              ) : (
                <input type="hidden" name="aidBuffer" value={initial.aidBuffer ? 'on' : ''} />
              )}
            </fieldset>

            <p className="nu-dialog-note">
              Ce sont tes objectifs personnels, pas une recommandation médicale.
            </p>
          </div>

          {/* Rendue tant que la modale est ouverte : la sélection part avec le formulaire. */}
          <div className="nu-step" hidden={step !== 2}>
            <ProductsStep
              participantRaceId={participantRaceId}
              products={products}
              selectedIds={selectedIds}
            />
          </div>
          {state.error === undefined ? null : (
            <p className="pk-field-error" role="alert">
              {state.error}
            </p>
          )}
          {/* Une clé par bouton : sans elle, React réutiliserait le bouton
              « Choisir mes produits » pour « Recalculer », qui deviendrait
              type="submit" pendant le clic et enverrait le formulaire. */}
          <div className="nu-dialog-actions">
            {step === 1 ? (
              <>
                <button
                  key="cancel"
                  type="button"
                  className="pk-btn pk-button-secondary"
                  onClick={() => dialog.current?.close()}
                >
                  Annuler
                </button>
                <button
                  key="next"
                  type="button"
                  className="pk-btn pk-button-primary"
                  onClick={(event) => {
                    event.preventDefault();
                    if (form.current?.reportValidity() !== false) setStep(2);
                  }}
                >
                  Choisir mes produits →
                </button>
              </>
            ) : (
              <>
                <button
                  key="back"
                  type="button"
                  className="pk-btn pk-button-secondary"
                  onClick={() => setStep(1)}
                >
                  ← Mes objectifs
                </button>
                <button
                  key="submit"
                  type="submit"
                  className="pk-btn pk-button-primary"
                  disabled={pending}
                >
                  {pending ? 'Calcul…' : submitLabel}
                </button>
              </>
            )}
          </div>
        </form>
      </dialog>
    </>
  );
}
