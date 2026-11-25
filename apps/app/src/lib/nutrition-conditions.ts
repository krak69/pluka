import type { NutritionStrategyView } from '@pluka/domain';

import { formatClock } from '@/lib/plan-format';

/**
 * Temps chaud, froid, nuit — NUTRITION_ENGINE §13 à §19, §24, §14 bis ;
 * décisions du 2026-11-24. Côté serveur : les plages se lisent et s'écrivent
 * ici en heures:minutes depuis le départ, et leur heure à l'horloge vient du
 * départ du Plan. Le navigateur ne fait que montrer et renvoyer du texte.
 */

export type ConditionType = 'hot' | 'cold' | 'night';
export type CaffeineSpread = 'auto' | 'late' | 'night' | 'manual';

export const CONDITION_TYPES: readonly ConditionType[] = ['hot', 'cold', 'night'];

export const CONDITION_LABELS: Readonly<Record<ConditionType, string>> = {
  hot: 'Temps chaud',
  cold: 'Temps froid',
  night: 'Nuit',
};

const SHORT_LABELS: Readonly<Record<ConditionType, string>> = {
  hot: 'Chaud',
  cold: 'Froid',
  night: 'Nuit',
};

export const CAFFEINE_SPREADS: readonly {
  readonly value: CaffeineSpread;
  readonly label: string;
  readonly note: string;
}[] = [
  {
    value: 'auto',
    label: 'Automatique',
    note: 'Ta caféine est répartie régulièrement sur toute la course.',
  },
  {
    value: 'late',
    label: 'Deuxième partie',
    note: 'Ta caféine est placée à partir de la mi-course.',
  },
  {
    value: 'night',
    label: 'Période nocturne',
    note: 'Ta caféine est placée sur tes plages de nuit ; sans plage de nuit, sur la deuxième partie.',
  },
  {
    value: 'manual',
    label: 'Manuel',
    note: 'PLUKA ne place pas de caféine : tu la poses toi-même avec « Modifier » sur tes prises.',
  },
];

/** « 4:10 », « 26:05 » : heures et minutes écoulées depuis le départ. */
export function elapsedText(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${String(Math.floor(minutes / 60))}:${String(minutes % 60).padStart(2, '0')}`;
}

/** « 4:10 », « 4h10 », « 4h », « 4 » → secondes ; nul si la saisie ne se lit pas. */
export function parseElapsed(text: string): number | null {
  const match = /^(\d{1,3})(?:\s*[:hH.]\s*(\d{0,2}))?$/.exec(text.trim());
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = match[2] === undefined || match[2] === '' ? 0 : Number(match[2]);
  if (minutes >= 60) return null;
  return (hours * 60 + minutes) * 60;
}

function clockAt(startAt: string | null, timezone: string, seconds: number): string | null {
  if (startAt === null) return null;
  return formatClock(new Date(Date.parse(startAt) + seconds * 1000).toISOString(), timezone);
}

export interface ConditionCommand {
  readonly type: ConditionType;
  readonly enabled: boolean;
  readonly carbsGPerHour: number | null;
  readonly hydrationMlPerHour: number | null;
  readonly sodiumMgPerHour: number | null;
  readonly ranges: readonly {
    readonly startElapsedSeconds: number;
    readonly endElapsedSeconds: number;
  }[];
}

function optionalNumber(form: FormData, name: string): number | null {
  const raw = String(form.get(name) ?? '')
    .trim()
    .replace(',', '.');
  return raw === '' ? null : Number(raw);
}

/**
 * Les conditions saisies dans la modale des objectifs. Une plage laissée vide
 * des deux côtés est ignorée ; une plage à moitié remplie, ou illisible, rend
 * une erreur que la modale affiche.
 */
export function conditionsFromForm(
  form: FormData,
):
  | { readonly conditions: readonly ConditionCommand[]; readonly caffeineSpread: CaffeineSpread }
  | { readonly error: string } {
  const spread = String(form.get('caffeineSpread') ?? 'auto');
  const caffeineSpread = CAFFEINE_SPREADS.some((option) => option.value === spread)
    ? (spread as CaffeineSpread)
    : 'auto';

  const conditions: ConditionCommand[] = [];
  for (const type of CONDITION_TYPES) {
    const froms = form.getAll(`cond_${type}_from`).map((value) => String(value).trim());
    const tos = form.getAll(`cond_${type}_to`).map((value) => String(value).trim());
    const ranges: { startElapsedSeconds: number; endElapsedSeconds: number }[] = [];
    for (let index = 0; index < Math.max(froms.length, tos.length); index += 1) {
      const from = froms[index] ?? '';
      const to = tos[index] ?? '';
      if (from === '' && to === '') continue;
      const start = parseElapsed(from);
      const end = parseElapsed(to);
      if (start === null || end === null) {
        return {
          error: `${CONDITION_LABELS[type]} : écris chaque plage en heures:minutes depuis le départ, par exemple 4:10 → 9:00.`,
        };
      }
      ranges.push({ startElapsedSeconds: start, endElapsedSeconds: end });
    }
    const enabled = form.get(`cond_${type}_enabled`) === 'on';
    if (!enabled && ranges.length === 0) continue;
    const night = type === 'night';
    conditions.push({
      type,
      enabled,
      carbsGPerHour: night ? null : optionalNumber(form, `cond_${type}_carbs`),
      hydrationMlPerHour: night ? null : optionalNumber(form, `cond_${type}_hydration`),
      sodiumMgPerHour: night ? null : optionalNumber(form, `cond_${type}_sodium`),
      ranges,
    });
  }
  return { conditions, caffeineSpread };
}

/** Pourquoi la base ou le domaine refuse des conditions : un message pour le coureur. */
export const CONDITION_PROBLEMS: Readonly<Record<string, string>> = {
  hot_cold_overlap: 'Une plage chaude et une plage froide se chevauchent : ajuste-les.',
  range_overlap: 'Deux plages du même type se chevauchent : fusionne-les ou ajuste-les.',
  range_invalid: 'Une plage doit finir après son début.',
  condition_duplicate: 'Chaque condition ne se règle qu’une fois.',
  night_targets: 'La nuit ne change aucune cible : elle répartit seulement ta caféine.',
};

// ------------------------------------------------------------
// La modale : ce qui est enregistré, et les propositions PLUKA
// ------------------------------------------------------------

export interface ConditionRangeDraft {
  readonly from: string;
  readonly to: string;
  /** « ≈ 10:10 → 15:00 à l'horloge » pour une plage enregistrée ; nul sans départ connu. */
  readonly clock: string | null;
}

export interface ConditionDraft {
  readonly type: ConditionType;
  readonly label: string;
  /** « Chaud » : le libellé des plages dans l'en-tête replié. */
  readonly shortLabel: string;
  readonly enabled: boolean;
  /** Les valeurs du coureur ; vides, la proposition PLUKA s'applique. */
  readonly carbs: string;
  readonly hydration: string;
  readonly sodium: string;
  /** « 625 » : la proposition PLUKA sur les objectifs enregistrés ; nulle sans objectifs. */
  readonly proposal: {
    readonly carbs: string;
    readonly hydration: string;
    readonly sodium: string;
  } | null;
  readonly ranges: readonly ConditionRangeDraft[];
}

export interface ConditionsDraft {
  readonly conditions: readonly ConditionDraft[];
  readonly caffeineSpread: CaffeineSpread;
  readonly caffeineOptions: typeof CAFFEINE_SPREADS;
  /**
   * « Départ 06:00 · arrivée estimée vers 05:40, après 23:40 de course » : le
   * repère des plages ; nul sans Plan.
   */
  readonly reference: string | null;
}

const decimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

function referenceOf(view: NutritionStrategyView): string | null {
  const start = clockAt(view.startAt, view.timezone, 0);
  const finish = view.finishElapsedSeconds;
  const finishClock = finish === null ? null : clockAt(view.startAt, view.timezone, finish);
  const parts = [
    start === null ? null : `Départ ${start}`,
    finish === null
      ? null
      : finishClock === null
        ? `arrivée estimée après ${elapsedText(finish)} de course`
        : `arrivée estimée vers ${finishClock}, après ${elapsedText(finish)} de course`,
  ].filter((part) => part !== null);
  if (parts.length === 0) return null;
  const text = parts.join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function conditionsDraft(view: NutritionStrategyView): ConditionsDraft {
  const stored = new Map(view.conditions.map((condition) => [condition.type, condition]));
  const spread = view.settings?.caffeineSpread ?? 'auto';

  const conditions = CONDITION_TYPES.map((type): ConditionDraft => {
    const record = stored.get(type);
    const proposal = type === 'night' ? null : (view.conditionProposals?.[type] ?? null);
    return {
      type,
      label: CONDITION_LABELS[type],
      shortLabel: SHORT_LABELS[type],
      enabled: record?.enabled ?? false,
      carbs:
        record?.carbsGPerHour === null || record === undefined ? '' : String(record.carbsGPerHour),
      hydration:
        record?.hydrationMlPerHour === null || record === undefined
          ? ''
          : String(record.hydrationMlPerHour),
      sodium:
        record?.sodiumMgPerHour === null || record === undefined
          ? ''
          : String(record.sodiumMgPerHour),
      proposal:
        proposal === null
          ? null
          : {
              carbs: decimal.format(proposal.carbsGPerHour),
              hydration: String(proposal.hydrationMlPerHour),
              sodium: String(proposal.sodiumMgPerHour),
            },
      ranges: (record?.ranges ?? []).map((range) => {
        const from = clockAt(view.startAt, view.timezone, range.startElapsedSeconds);
        const to = clockAt(view.startAt, view.timezone, range.endElapsedSeconds);
        return {
          from: elapsedText(range.startElapsedSeconds),
          to: elapsedText(range.endElapsedSeconds),
          clock: from === null || to === null ? null : `≈ ${from} → ${to} à l’horloge`,
        };
      }),
    };
  });

  return {
    conditions,
    caffeineSpread: CAFFEINE_SPREADS.some((option) => option.value === spread)
      ? (spread as CaffeineSpread)
      : 'auto',
    caffeineOptions: CAFFEINE_SPREADS,
    reference: referenceOf(view),
  };
}

// ------------------------------------------------------------
// La bande Nutrition : ce qui s'applique
// ------------------------------------------------------------

export interface ConditionPeriodLine {
  readonly key: string;
  readonly type: ConditionType;
  /** « Chaud 4:10 → 9:00 ». */
  readonly label: string;
  /** « 10:10 → 15:00 » ; nul sans départ connu. */
  readonly clock: string | null;
}

export interface ConditionsBand {
  readonly periods: readonly ConditionPeriodLine[];
  /** « Temps chaud : 60 g/h · 625 ml/h · 500 mg/h · proposition PLUKA ». */
  readonly profiles: readonly string[];
  /** « Caféine : sur tes plages de nuit » ; nul sans objectif caféine. */
  readonly caffeine: string | null;
  readonly warnings: readonly string[];
}

const WARNINGS: Readonly<Record<string, string>> = {
  range_truncated: 'Une plage dépasse ton arrivée estimée : elle s’arrête à l’arrivée.',
  range_outside: 'Une plage commence après ton arrivée estimée : elle n’est pas appliquée.',
  caffeine_night_without_range:
    'Aucune plage de nuit : ta caféine est placée sur la deuxième partie de course.',
  hot_cold_overlap: 'Une plage chaude et une plage froide se chevauchent : la base s’y applique.',
};

const CAFFEINE_BAND: Readonly<Record<CaffeineSpread, string>> = {
  auto: 'Caféine : répartie sur toute la course',
  late: 'Caféine : à partir de la mi-course',
  night: 'Caféine : sur tes plages de nuit',
  manual: 'Caféine : placée par toi',
};

export function conditionsBand(view: NutritionStrategyView): ConditionsBand | null {
  const result = view.result;
  if (result === null) return null;
  const conditions = result.conditions;
  const periods = conditions.ranges.map((range, index): ConditionPeriodLine => {
    const from = clockAt(view.startAt, view.timezone, range.startElapsedSeconds);
    const to = clockAt(view.startAt, view.timezone, range.endElapsedSeconds);
    return {
      key: `${range.kind}-${String(index)}`,
      type: range.kind,
      label: `${SHORT_LABELS[range.kind]} ${elapsedText(range.startElapsedSeconds)} → ${elapsedText(range.endElapsedSeconds)}`,
      clock: from === null || to === null ? null : `${from} → ${to}`,
    };
  });
  const used = new Set(periods.map((period) => period.type));
  const profiles = (['hot', 'cold'] as const)
    .filter((type) => used.has(type))
    .map((type) => {
      const profile = conditions[type];
      const custom = profile.custom.carbs || profile.custom.hydration || profile.custom.sodium;
      return `${CONDITION_LABELS[type]} : ${decimal.format(profile.targets.carbsGPerHour)} g/h · ${String(profile.targets.hydrationMlPerHour)} ml/h · ${String(profile.targets.sodiumMgPerHour)} mg/h · ${custom ? 'tes valeurs' : 'proposition PLUKA'}`;
    });
  const hasCaffeine = (view.settings?.caffeineTotalMg ?? null) !== null;
  return periods.length === 0 && !hasCaffeine
    ? null
    : {
        periods,
        profiles,
        caffeine: hasCaffeine ? CAFFEINE_BAND[conditions.caffeineSpread] : null,
        warnings: conditions.warnings.map((warning) => WARNINGS[warning] ?? warning),
      };
}
