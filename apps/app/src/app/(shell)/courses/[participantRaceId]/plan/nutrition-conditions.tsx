'use client';

import { useId, useRef, useState } from 'react';

import { Icon, type IconName } from '@/components/icon';
import type {
  CaffeineSpread,
  ConditionDraft,
  ConditionsDraft,
  ConditionType,
} from '@/lib/nutrition-conditions';

/**
 * « Conditions particulières » — prototype `condBlocks`, NUTRITION_ENGINE §13
 * à §19, §24, §14 bis ; décisions du 2026-11-24.
 *
 * Une section repliée par défaut, dont l'en-tête dit ce qui est réglé. Ouverte,
 * chaque condition s'active d'une case, et ses réglages n'apparaissent qu'alors.
 * Chaud et froid montrent les cibles qui s'appliqueront : la proposition PLUKA
 * tant que le coureur n'ajuste rien. Tout reste monté et envoyé, replié ou
 * décoché : une condition désactivée garde ses plages. Les plages partent en
 * texte (« 4:10 ») : le serveur les lit, rien ne se calcule ici.
 */

const ICONS: Readonly<Record<ConditionType, IconName>> = {
  hot: 'Sun',
  cold: 'Snowflake',
  night: 'Moon',
};

const IMPACTS: Readonly<Record<ConditionType, string>> = {
  hot: 'Sur ces plages, PLUKA applique tes cibles par temps chaud : surtout plus d’eau et de sodium.',
  cold: 'Sur ces plages, PLUKA applique tes cibles par temps froid : un peu moins d’eau, un peu plus de glucides.',
  night:
    'La nuit ne change ni tes glucides, ni ton hydratation, ni ton sodium. Elle sert à placer ta caféine : choisis « Période nocturne » plus bas. Le total que tu as fixé ne bouge pas.',
};

/** La règle de la proposition — NUTRITION_ENGINE §14 bis, `conditions` dans la config du moteur. */
const WHY: Readonly<Record<'hot' | 'cold', string>> = {
  hot: 'Calcul PLUKA sur tes objectifs : 25 % d’eau en plus sans dépasser 750 ml/h, le sodium à la même concentration (au moins 300 mg/h, au plus 1 g par litre), les glucides inchangés. Repère : la position de l’International Society of Sports Nutrition sur l’ultra-marathon (2019).',
  cold: 'Calcul PLUKA sur tes objectifs : 15 % d’eau en moins sans descendre sous 450 ml/h, le sodium à la même concentration, 10 % de glucides en plus. C’est une estimation PLUKA : aucune étude ne chiffre précisément l’effet du froid.',
};

const TARGETS = [
  ['carbs', 'Glucides', 'g/h'],
  ['hydration', 'Hydratation', 'ml/h'],
  ['sodium', 'Sodium', 'mg/h'],
] as const;

type TargetField = (typeof TARGETS)[number][0];

interface RangeRow {
  readonly id: number;
  readonly from: string;
  readonly to: string;
  /** L'heure à l'horloge d'une plage enregistrée ; une plage modifiée la perd. */
  readonly clock: string | null;
}

interface BlockState {
  readonly enabled: boolean;
  readonly rows: readonly RangeRow[];
  readonly carbs: string;
  readonly hydration: string;
  readonly sodium: string;
}

type BlockStates = Readonly<Record<ConditionType, BlockState>>;

function filled(row: RangeRow): boolean {
  return row.from.trim() !== '' && row.to.trim() !== '';
}

function rangesCount(rows: readonly RangeRow[]): string {
  const count = rows.filter(filled).length;
  if (count === 0) return 'Aucune plage';
  return count === 1 ? '1 plage' : `${String(count)} plages`;
}

function TargetsPanel({
  draft,
  state,
  onChange,
}: {
  readonly draft: ConditionDraft;
  readonly state: BlockState;
  readonly onChange: (patch: Partial<BlockState>) => void;
}) {
  const type = draft.type === 'cold' ? 'cold' : 'hot';
  const custom = TARGETS.some(([field]) => state[field].trim() !== '');
  const [adjust, setAdjust] = useState(custom);
  const adjustId = useId();
  const prefix = `cond_${draft.type}`;

  const values = TARGETS.map(([field, , unit]) => {
    const typed = state[field].trim();
    const value = typed === '' ? draft.proposal?.[field] : typed;
    return value === undefined ? null : `${value} ${unit}`;
  });
  const known = values.filter((value) => value !== null);
  const source = !custom
    ? 'Proposition PLUKA'
    : known.length < TARGETS.length
      ? 'Ajustées par toi, le reste proposé par PLUKA à l’enregistrement'
      : 'Ajustées par toi';

  return (
    <div className="nu-cond-targets">
      <div className="nu-cond-targets-head">
        <div className="nu-cond-applied">
          <span className="pk-field-label">Tes cibles sur ces plages</span>
          {known.length === 0 ? (
            <span className="pk-field-hint">
              PLUKA les propose à l’enregistrement, à partir de tes objectifs.
            </span>
          ) : (
            <>
              <span className="nu-cond-values">{known.join(' · ')}</span>
              <span className="nu-cond-source">{source}</span>
            </>
          )}
        </div>
        <button
          type="button"
          className="nu-text-button nu-cond-adjust-toggle"
          aria-expanded={adjust}
          aria-controls={adjustId}
          onClick={() => setAdjust((open) => !open)}
        >
          {adjust ? 'Masquer' : 'Ajuster'}
        </button>
      </div>

      {/* Masqué mais envoyé : refermer ne retire aucune valeur saisie. */}
      <div id={adjustId} className="nu-cond-adjust" hidden={!adjust}>
        <div className="nu-fields">
          {TARGETS.map(([field, label, unit]) => (
            <label key={field} className="pk-field">
              <span className="pk-field-label">
                {label} ({unit})
              </span>
              <input
                name={`${prefix}_${field}`}
                className="pk-input"
                inputMode="decimal"
                value={state[field]}
                placeholder={
                  draft.proposal === null ? 'Proposition PLUKA' : `PLUKA : ${draft.proposal[field]}`
                }
                onChange={(event) =>
                  onChange({ [field]: event.target.value } as Partial<Record<TargetField, string>>)
                }
              />
            </label>
          ))}
        </div>
        <p className="pk-field-hint">
          Un champ laissé vide suit la proposition PLUKA, recalculée sur tes objectifs à chaque
          enregistrement.
        </p>
        <p className="nu-cond-why">
          {WHY[type]} Ce ne sont pas des recommandations médicales : ajuste-les à ce que tu as testé
          à l’entraînement.
        </p>
        {custom ? (
          <button
            type="button"
            className="nu-text-button nu-cond-reset"
            onClick={() => onChange({ carbs: '', hydration: '', sodium: '' })}
          >
            Revenir à la proposition PLUKA
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ConditionBlock({
  draft,
  state,
  focusRow,
  onChange,
  onEnable,
  onAddRow,
}: {
  readonly draft: ConditionDraft;
  readonly state: BlockState;
  /** La plage qui vient d'être ajoutée, à qui donner le focus. */
  readonly focusRow: number | null;
  readonly onChange: (patch: Partial<BlockState>) => void;
  readonly onEnable: (enabled: boolean) => void;
  readonly onAddRow: () => void;
}) {
  const bodyId = useId();
  const rangesId = useId();
  const prefix = `cond_${draft.type}`;

  const edit = (id: number, field: 'from' | 'to', value: string) =>
    onChange({
      rows: state.rows.map((row) =>
        row.id === id ? { ...row, [field]: value, clock: null } : row,
      ),
    });

  return (
    <div className="nu-cond" data-type={draft.type} data-enabled={state.enabled}>
      <label className="nu-cond-toggle">
        <input
          type="checkbox"
          name={`${prefix}_enabled`}
          checked={state.enabled}
          aria-controls={bodyId}
          onChange={(event) => onEnable(event.target.checked)}
        />
        <span className="nu-cond-icon" aria-hidden="true">
          <Icon name={ICONS[draft.type]} />
        </span>
        <span className="nu-cond-name">{draft.label}</span>
        {state.enabled ? <span className="nu-cond-count">{rangesCount(state.rows)}</span> : null}
      </label>

      {/* Masqué mais envoyé : une condition décochée garde ses plages. */}
      <div id={bodyId} className="nu-cond-body" hidden={!state.enabled}>
        <p className="pk-field-hint">{IMPACTS[draft.type]}</p>

        {draft.type === 'night' ? null : (
          <TargetsPanel draft={draft} state={state} onChange={onChange} />
        )}

        <div className="nu-cond-ranges-block">
          <span id={rangesId} className="pk-field-label">
            Plages, en temps de course
          </span>
          {state.rows.length === 0 ? null : (
            <ul className="nu-cond-ranges" aria-labelledby={rangesId}>
              {state.rows.map((row, index) => (
                <li key={row.id} className="nu-cond-range">
                  <input
                    name={`${prefix}_from`}
                    className="pk-input nu-cond-time"
                    inputMode="numeric"
                    placeholder="4:10"
                    aria-label={`${draft.label}, début de la plage ${String(index + 1)}`}
                    value={row.from}
                    autoFocus={row.id === focusRow}
                    onChange={(event) => edit(row.id, 'from', event.target.value)}
                  />
                  <span className="nu-cond-arrow" aria-hidden="true">
                    <Icon name="ArrowRight" size={16} />
                  </span>
                  <input
                    name={`${prefix}_to`}
                    className="pk-input nu-cond-time"
                    inputMode="numeric"
                    placeholder="9:00"
                    aria-label={`${draft.label}, fin de la plage ${String(index + 1)}`}
                    value={row.to}
                    onChange={(event) => edit(row.id, 'to', event.target.value)}
                  />
                  <button
                    type="button"
                    className="nu-text-button nu-cond-remove"
                    aria-label={`Retirer la plage ${String(index + 1)} (${draft.label})`}
                    onClick={() =>
                      onChange({ rows: state.rows.filter((entry) => entry.id !== row.id) })
                    }
                  >
                    Retirer
                  </button>
                  {row.clock === null ? null : <span className="nu-cond-clock">{row.clock}</span>}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="pk-btn pk-button-secondary nu-cond-add"
            onClick={onAddRow}
          >
            <Icon name="Plus" size={16} />
            Ajouter une plage
          </button>
        </div>
      </div>
    </div>
  );
}

function initialBlocks(draft: ConditionsDraft): BlockStates {
  let id = 0;
  return Object.fromEntries(
    draft.conditions.map((condition) => [
      condition.type,
      {
        enabled: condition.enabled,
        rows: condition.ranges.map((range) => {
          id += 1;
          return { id, ...range };
        }),
        carbs: condition.carbs,
        hydration: condition.hydration,
        sodium: condition.sodium,
      },
    ]),
  ) as unknown as BlockStates;
}

export function ConditionsFields({ draft }: { readonly draft: ConditionsDraft }) {
  const panelId = useId();
  const caffeineId = useId();
  // Les plages enregistrées portent les numéros 1 à n ; les nouvelles suivent.
  const lastRow = useRef(
    draft.conditions.reduce((count, condition) => count + condition.ranges.length, 0),
  );
  const newRow = (): RangeRow => {
    lastRow.current += 1;
    return { id: lastRow.current, from: '', to: '', clock: null };
  };

  const [open, setOpen] = useState(false);
  const [spread, setSpread] = useState<CaffeineSpread>(draft.caffeineSpread);
  const [focusRow, setFocusRow] = useState<number | null>(null);
  const [blocks, setBlocks] = useState<BlockStates>(() => initialBlocks(draft));

  const update = (type: ConditionType, patch: Partial<BlockState>) =>
    setBlocks((current) => ({ ...current, [type]: { ...current[type], ...patch } }));

  const caffeine = draft.caffeineOptions.find((option) => option.value === spread);
  // L'en-tête replié dit ce qui s'appliquera : les plages des conditions cochées.
  const tags = draft.conditions.flatMap((condition) => {
    const block = blocks[condition.type];
    if (!block.enabled) return [];
    return block.rows.filter(filled).map((row) => ({
      key: `${condition.type}-${String(row.id)}`,
      type: condition.type,
      text: `${condition.shortLabel} ${row.from.trim()} → ${row.to.trim()}`,
    }));
  });

  return (
    <fieldset className="nu-fieldset nu-conds-fieldset">
      <input type="hidden" name="conditionsStep" value="1" />
      <input type="hidden" name="caffeineSpread" value={spread} />
      <button
        type="button"
        className="nu-cond-open"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="nu-cond-open-icon" aria-hidden="true">
          <Icon name="ThermometerSimple" />
        </span>
        <span className="nu-cond-open-text">
          <span className="nu-cond-open-title">Conditions particulières</span>
          {tags.length === 0 && spread === 'auto' ? (
            <span className="pk-field-hint">
              Facultatif · chaleur, froid ou nuit sur une partie de ta course
            </span>
          ) : (
            <span className="nu-cond-open-tags">
              {tags.map((tag) => (
                <span key={tag.key} className="nu-cond-period" data-type={tag.type}>
                  <span className="nu-cond-dot" aria-hidden="true" />
                  {tag.text}
                </span>
              ))}
              {spread === 'auto' || caffeine === undefined ? null : (
                <span className="nu-cond-period">Caféine : {caffeine.label.toLowerCase()}</span>
              )}
            </span>
          )}
        </span>
        <span className="nu-cond-caret" aria-hidden="true">
          <Icon name="CaretDown" size={16} />
        </span>
      </button>

      {/* Masqué mais envoyé : refermer la section ne retire rien. */}
      <div id={panelId} className="nu-cond-panel" hidden={!open}>
        <p className="pk-field-hint">
          {draft.reference === null ? '' : `${draft.reference}. `}
          Les plages se comptent en temps écoulé depuis le départ, par exemple 4:10 → 9:00.
        </p>

        {draft.conditions.map((condition) => (
          <ConditionBlock
            key={condition.type}
            draft={condition}
            state={blocks[condition.type]}
            focusRow={focusRow}
            onChange={(patch) => update(condition.type, patch)}
            onEnable={(enabled) =>
              // Cocher une condition sans plage en ouvre une, prête à remplir.
              update(condition.type, {
                enabled,
                ...(enabled && blocks[condition.type].rows.length === 0
                  ? { rows: [newRow()] }
                  : {}),
              })
            }
            onAddRow={() => {
              const row = newRow();
              setFocusRow(row.id);
              update(condition.type, { rows: [...blocks[condition.type].rows, row] });
            }}
          />
        ))}

        <div className="nu-cond nu-cond-caffeine">
          <span id={caffeineId} className="pk-field-label">
            Répartition de la caféine
          </span>
          <div className="nu-chips" role="group" aria-labelledby={caffeineId}>
            {draft.caffeineOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className="nu-chip"
                aria-pressed={spread === option.value}
                onClick={() => setSpread(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="pk-field-hint">
            {caffeine?.note ?? ''} Le total que tu as fixé ne change jamais.
          </p>
        </div>
      </div>
    </fieldset>
  );
}
