'use client';

import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import type { ActionState } from '@/app/actions';
import {
  saveNutritionAction,
  type PickableProduct,
} from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-actions';
import { ConditionsFields } from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-conditions';
import { ProductsStep } from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-products-step';
import { Icon } from '@/components/icon';
import type { ConditionsDraft } from '@/lib/nutrition-conditions';

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
  readonly flaskCount: number;
  readonly flaskCapacityMl: number;
  readonly bladderMl: number | null;
}

const FLASK_COUNTS = [0, 1, 2, 3, 4] as const;
const FLASK_CAPACITIES = [250, 300, 350, 400, 450, 500, 550, 600, 750] as const;
const BLADDERS = [1000, 1500, 2000, 2500, 3000] as const;

const INTERVALS = [15, 20, 30, 45, 60] as const;

const STEP_TITLES = {
  1: 'Tes objectifs nutritionnels',
  2: 'Quels produits veux-tu utiliser ?',
} as const;

type Split = 'water' | 'half' | 'custom';

function splitOf(percent: number): Split {
  if (percent === 100) return 'water';
  if (percent === 50) return 'half';
  return 'custom';
}

interface DialogProps {
  readonly participantRaceId: string;
  readonly initial: NutritionGoals;
  /** Temps chaud, froid, nuit et répartition de la caféine (0112), mis en forme côté serveur. */
  readonly conditions: ConditionsDraft;
  readonly triggerLabel: string;
  readonly triggerClassName: string;
  readonly submitLabel: string;
  readonly products: readonly PickableProduct[];
  readonly selectedIds: readonly string[];
}

/**
 * « Tes objectifs nutritionnels » — prototype, `nutStepConfig`.
 *
 * Une modale ouverte depuis le Plan : tes cibles horaires, la répartition de
 * ton hydratation, tes contenants, le placement des prises, les conditions
 * particulières, puis tes produits. Aucune valeur proposée : ce sont tes
 * objectifs (NUTRITION_ENGINE §1). Enregistrer active la Nutrition.
 *
 * En-tête et actions restent visibles, seul le contenu défile. Fermer — la
 * croix, « Annuler » ou Échap — n'enregistre rien et abandonne ce qui a été
 * saisi : à la réouverture, la modale repart des réglages enregistrés.
 */
export function NutritionDialog(props: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  // Chaque fermeture remonte le formulaire : ses champs repartent des réglages enregistrés.
  const [session, setSession] = useState(0);
  // « Mes produits » survit aux fermetures : un produit ajouté est déjà enregistré.
  const [library, setLibrary] = useState<readonly PickableProduct[]>(props.products);
  const titleId = useId();

  return (
    <>
      <button
        type="button"
        className={props.triggerClassName}
        onClick={() => {
          dialog.current?.showModal();
          // Le focus va au titre, pas à la croix : la modale s'annonce par son nom.
          document.getElementById(titleId)?.focus();
        }}
      >
        {props.triggerLabel}
      </button>
      <dialog
        ref={dialog}
        className="nu-dialog"
        aria-labelledby={titleId}
        onClose={() => setSession((current) => current + 1)}
      >
        <NutritionForm
          key={session}
          {...props}
          titleId={titleId}
          library={library}
          onLibrary={setLibrary}
          onClose={() => dialog.current?.close()}
        />
      </dialog>
    </>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  const id = useId();
  return (
    <div className="nu-part" role="group" aria-labelledby={id}>
      <h3 id={id} className="nu-part-title">
        {title}
      </h3>
      {children}
    </div>
  );
}

function NutritionForm({
  participantRaceId,
  initial,
  submitLabel,
  selectedIds,
  conditions,
  titleId,
  library,
  onLibrary,
  onClose,
}: DialogProps & {
  readonly titleId: string;
  readonly library: readonly PickableProduct[];
  readonly onLibrary: Dispatch<SetStateAction<readonly PickableProduct[]>>;
  readonly onClose: () => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [state, save, pending] = useActionState(saveNutritionAction, INITIAL);
  const answered = useRef(state);

  const [hydration, setHydration] = useState(initial.hydrationMlPerHour ?? 0);
  const [split, setSplit] = useState<Split>(splitOf(initial.waterSharePercent));
  const [waterPercent, setWaterPercent] = useState(initial.waterSharePercent);
  const [mode, setMode] = useState(initial.placementMode);
  const [interval, setInterval] = useState(initial.intervalMinutes ?? 30);
  const [advanced, setAdvanced] = useState(initial.placementMode === 'interval');
  const [flaskCount, setFlaskCount] = useState(initial.flaskCount);
  const [bladder, setBladder] = useState(initial.bladderMl !== null);

  const share = split === 'water' ? 100 : split === 'half' ? 50 : waterPercent;
  const waterMl = Math.round((hydration * share) / 100);

  // Chaque étape s'ouvre en haut, pas là où la précédente avait défilé.
  const goTo = (next: 1 | 2) => {
    setStep(next);
    if (scroll.current !== null) scroll.current.scrollTop = 0;
  };

  // Enregistré sans refus : la modale se referme sur la stratégie calculée.
  useEffect(() => {
    if (state === answered.current) return;
    answered.current = state;
    if (state.error === undefined) onClose();
  }, [state, onClose]);

  return (
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
        if (step === 1 && form.current?.reportValidity() !== false) goTo(2);
      }}
    >
      <input type="hidden" name="participantRaceId" value={participantRaceId} />
      <input type="hidden" name="waterSharePercent" value={share} />
      <input type="hidden" name="placementMode" value={mode} />
      <input type="hidden" name="intervalMinutes" value={interval} />
      <input type="hidden" name="density" value={initial.density} />
      <input type="hidden" name="flaskCount" value={flaskCount} />

      <header className="nu-dialog-head">
        <div className="nu-dialog-heading">
          <p className="nu-dialog-eyebrow">Étape {step} sur 2</p>
          <h2 id={titleId} className="nu-dialog-title" tabIndex={-1}>
            {STEP_TITLES[step]}
          </h2>
        </div>
        <button
          type="button"
          className="ap-drawer-close nu-dialog-close"
          aria-label="Fermer sans enregistrer"
          onClick={onClose}
        >
          <Icon name="X" size={18} />
        </button>
      </header>

      <div ref={scroll} className="nu-dialog-scroll">
        <div className="nu-step" hidden={step !== 1}>
          <p className="nu-dialog-body">
            Tu choisis tes cibles horaires, PLUKA les répartit sur ton plan de course. Tu pourras
            les modifier à tout moment.
          </p>

          <Section title="Tes cibles">
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
          </Section>

          <Section title="Eau et boisson d’effort">
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
          </Section>

          <Section title="Tes contenants">
            <p className="pk-field-hint">
              PLUKA te dit quoi mettre dans chaque flasque, et quoi faire à chaque ravito.
            </p>
            <div className="nu-chips" role="group" aria-label="Nombre de flasques">
              {FLASK_COUNTS.map((count) => (
                <button
                  key={count}
                  type="button"
                  className="nu-chip"
                  aria-pressed={flaskCount === count}
                  onClick={() => setFlaskCount(count)}
                >
                  {count === 0
                    ? 'Aucune flasque'
                    : count === 1
                      ? '1 flasque'
                      : `${String(count)} flasques`}
                </button>
              ))}
            </div>
            <div className="nu-fields">
              {flaskCount === 0 ? (
                <input type="hidden" name="flaskCapacityMl" value={initial.flaskCapacityMl} />
              ) : (
                <label className="pk-field">
                  <span className="pk-field-label">Contenance d’une flasque</span>
                  <select
                    name="flaskCapacityMl"
                    className="pk-input"
                    defaultValue={initial.flaskCapacityMl}
                  >
                    {FLASK_CAPACITIES.map((capacity) => (
                      <option key={capacity} value={capacity}>
                        {capacity} ml
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="pk-field">
                <label className="as-check">
                  <input
                    type="checkbox"
                    name="bladder"
                    checked={bladder}
                    onChange={(event) => setBladder(event.target.checked)}
                  />
                  <span>Je porte aussi une poche à eau</span>
                </label>
                {bladder ? (
                  <select
                    name="bladderMl"
                    className="pk-input"
                    aria-label="Contenance de la poche à eau"
                    defaultValue={initial.bladderMl ?? 1500}
                  >
                    {BLADDERS.map((capacity) => (
                      <option key={capacity} value={capacity}>
                        {String(capacity / 1000).replace('.', ',')} l
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            </div>
          </Section>

          <Section title="Placement des prises">
            <p className="nu-place">
              <strong>
                {mode === 'interval'
                  ? `Rythme imposé — toutes les ${String(interval)} min`
                  : 'Intelligent'}
              </strong>
              <span>
                PLUKA place les prises selon ton plan, les ravitaillements et le terrain : en montée
                ou sur le plat plutôt qu’en pleine descente.
              </span>
            </p>
            <button
              type="button"
              className="pk-btn pk-button-ghost nu-advanced"
              aria-expanded={advanced}
              onClick={() => setAdvanced((open) => !open)}
            >
              {advanced ? 'Masquer les options avancées' : 'Options avancées'}
              <span className="nu-cond-caret" aria-hidden="true">
                <Icon name="CaretDown" size={14} />
              </span>
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
          </Section>

          <div className="nu-part">
            <ConditionsFields draft={conditions} />
          </div>

          <p className="nu-dialog-note">
            Ce sont tes objectifs personnels, pas une recommandation médicale.
          </p>
        </div>

        {/* Rendue tant que la modale est ouverte : la sélection part avec le formulaire. */}
        <div className="nu-step" hidden={step !== 2}>
          <ProductsStep
            participantRaceId={participantRaceId}
            products={library}
            onProducts={onLibrary}
            selectedIds={selectedIds}
          />
        </div>
      </div>

      {/* Une clé par bouton : sans elle, React réutiliserait le bouton
          « Choisir mes produits » pour « Recalculer », qui deviendrait
          type="submit" pendant le clic et enverrait le formulaire. */}
      <footer className="nu-dialog-foot">
        {state.error === undefined ? null : (
          <p className="pk-field-error" role="alert">
            {state.error}
          </p>
        )}
        <div className="nu-dialog-actions">
          {step === 1 ? (
            <>
              <button
                key="cancel"
                type="button"
                className="pk-btn pk-button-secondary"
                onClick={onClose}
              >
                Annuler
              </button>
              <button
                key="next"
                type="button"
                className="pk-btn pk-button-primary"
                onClick={(event) => {
                  event.preventDefault();
                  if (form.current?.reportValidity() !== false) goTo(2);
                }}
              >
                Choisir mes produits
                <Icon name="ArrowRight" size={18} />
              </button>
            </>
          ) : (
            <>
              <button
                key="back"
                type="button"
                className="pk-btn pk-button-secondary"
                onClick={() => goTo(1)}
              >
                <Icon name="ArrowLeft" size={18} />
                Mes objectifs
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
      </footer>
    </form>
  );
}
