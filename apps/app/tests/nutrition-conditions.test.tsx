import type { NutritionConditionRecord } from '@pluka/db';
import type { NutritionResult, NutritionStrategyView } from '@pluka/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ConditionsFields } from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-conditions';
import {
  conditionsBand,
  conditionsDraft,
  conditionsFromForm,
  elapsedText,
  parseElapsed,
} from '@/lib/nutrition-conditions';

/**
 * Temps chaud, froid, nuit à l'écran — NUTRITION_ENGINE §13 à §19, §24,
 * §14 bis ; décisions du 2026-11-24. Les plages se lisent et s'écrivent côté
 * serveur, en heures:minutes depuis le départ.
 */

const START = '2026-06-20T04:00:00.000Z';
const HOUR = 3600;

describe('les plages en heures:minutes', () => {
  it('lit les écritures courantes, et refuse le reste', () => {
    expect(parseElapsed('4:10')).toBe(4 * HOUR + 600);
    expect(parseElapsed('4h10')).toBe(4 * HOUR + 600);
    expect(parseElapsed('4h')).toBe(4 * HOUR);
    expect(parseElapsed(' 26 ')).toBe(26 * HOUR);
    expect(parseElapsed('4:75')).toBeNull();
    expect(parseElapsed('midi')).toBeNull();
  });

  it('écrit au-delà de 24 h sans revenir à zéro', () => {
    expect(elapsedText(26 * HOUR + 300)).toBe('26:05');
  });
});

function form(entries: readonly (readonly [string, string])[]): FormData {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
}

describe('le formulaire de la modale', () => {
  it('rend les conditions, cibles vides comprises, et la répartition de la caféine', () => {
    const parsed = conditionsFromForm(
      form([
        ['caffeineSpread', 'night'],
        ['cond_hot_enabled', 'on'],
        ['cond_hot_carbs', ''],
        ['cond_hot_hydration', '700'],
        ['cond_hot_sodium', ''],
        ['cond_hot_from', '4:10'],
        ['cond_hot_to', '9:00'],
        ['cond_hot_from', ''],
        ['cond_hot_to', ''],
        ['cond_night_enabled', 'on'],
        ['cond_night_from', '20:00'],
        ['cond_night_to', '30:00'],
      ]),
    );

    expect(parsed).toEqual({
      caffeineSpread: 'night',
      conditions: [
        {
          type: 'hot',
          enabled: true,
          carbsGPerHour: null,
          hydrationMlPerHour: 700,
          sodiumMgPerHour: null,
          ranges: [{ startElapsedSeconds: 4 * HOUR + 600, endElapsedSeconds: 9 * HOUR }],
        },
        {
          type: 'night',
          enabled: true,
          carbsGPerHour: null,
          hydrationMlPerHour: null,
          sodiumMgPerHour: null,
          ranges: [{ startElapsedSeconds: 20 * HOUR, endElapsedSeconds: 30 * HOUR }],
        },
      ],
    });
  });

  it('garde les plages d’une condition désactivée', () => {
    const parsed = conditionsFromForm(
      form([
        ['cond_cold_from', '0:00'],
        ['cond_cold_to', '2:30'],
      ]),
    );

    expect(parsed).toMatchObject({
      conditions: [{ type: 'cold', enabled: false, ranges: [{ endElapsedSeconds: 9000 }] }],
    });
  });

  it('dit quelle plage ne se lit pas', () => {
    const parsed = conditionsFromForm(
      form([
        ['cond_hot_enabled', 'on'],
        ['cond_hot_from', 'midi'],
        ['cond_hot_to', '9:00'],
      ]),
    );

    expect(parsed).toEqual({
      error:
        'Temps chaud : écris chaque plage en heures:minutes depuis le départ, par exemple 4:10 → 9:00.',
    });
  });
});

const HOT: NutritionConditionRecord = {
  type: 'hot',
  enabled: true,
  carbsGPerHour: null,
  hydrationMlPerHour: 700,
  sodiumMgPerHour: null,
  ranges: [{ startElapsedSeconds: 4 * HOUR, endElapsedSeconds: 9 * HOUR }],
};

const PROPOSALS = {
  hot: { carbsGPerHour: 60, hydrationMlPerHour: 625, sodiumMgPerHour: 500 },
  cold: { carbsGPerHour: 65, hydrationMlPerHour: 450, sodiumMgPerHour: 360 },
};

function view(patch: Partial<NutritionStrategyView> = {}): NutritionStrategyView {
  return {
    state: 'off',
    settings: null,
    result: null,
    startAt: START,
    timezone: 'Europe/Paris',
    finishElapsedSeconds: 20 * HOUR,
    planChangedSinceSettings: false,
    review: null,
    toPlace: [],
    canEdit: true,
    products: [],
    preparation: null,
    aid: [],
    conditions: [HOT],
    conditionProposals: PROPOSALS,
    ...patch,
  } as NutritionStrategyView;
}

describe('la modale reçoit ce qui est enregistré', () => {
  it('les valeurs du coureur, la proposition PLUKA en repère, les plages et leur heure', () => {
    const draft = conditionsDraft(view());
    const [hot, cold, night] = draft.conditions;

    expect(hot).toMatchObject({
      enabled: true,
      carbs: '',
      hydration: '700',
      proposal: { carbs: '60', hydration: '625', sodium: '500' },
      ranges: [{ from: '4:00', to: '9:00', clock: '≈ 10:00 → 15:00 à l’horloge' }],
    });
    expect(cold).toMatchObject({ enabled: false, ranges: [], proposal: { hydration: '450' } });
    expect(night?.proposal).toBeNull();
    expect(draft.reference).toBe(
      'Départ 06:00 · arrivée estimée vers 02:00, après 20:00 de course',
    );
  });

  it('sans heure de départ, le repère se limite à la durée ; sans Plan, il n’y en a pas', () => {
    expect(conditionsDraft(view({ startAt: null })).reference).toBe(
      'Arrivée estimée après 20:00 de course',
    );
    expect(
      conditionsDraft(view({ startAt: null, finishElapsedSeconds: null })).reference,
    ).toBeNull();
  });
});

describe('la section « Conditions particulières »', () => {
  const render = (patch: Partial<NutritionStrategyView> = {}) =>
    renderToStaticMarkup(<ConditionsFields draft={conditionsDraft(view(patch))} />);

  it('s’ouvre repliée, et son en-tête dit les plages réglées', () => {
    const html = render();

    expect(html).toMatch(/<button type="button" class="nu-cond-open" aria-expanded="false"/);
    expect(html).toMatch(/class="nu-cond-panel" hidden=""/);
    expect(html).toContain('Chaud 4:00 → 9:00');
    expect(html).not.toContain('Facultatif');
  });

  it('sans condition, l’en-tête dit que c’est facultatif', () => {
    expect(render({ conditions: [] })).toContain(
      'Facultatif · chaleur, froid ou nuit sur une partie de ta course',
    );
  });

  it('ne montre les réglages que des conditions cochées, mais envoie tout', () => {
    const html = render();

    // Temps chaud est coché ; froid et nuit, repliés, restent dans le formulaire.
    expect(html.match(/class="nu-cond-body" hidden=""/g)).toHaveLength(2);
    expect(html).toContain('name="cond_cold_enabled"');
    expect(html).toContain('name="cond_night_enabled"');
    expect(html).toContain('aria-label="Temps chaud, début de la plage 1"');
    expect(html).toContain('value="4:00"');
    expect(html).toContain('≈ 10:00 → 15:00 à l’horloge');
  });

  it('montre les cibles appliquées ; celles que le coureur a ajustées s’ouvrent', () => {
    const html = render();

    expect(html).toContain('60 g/h · 700 ml/h · 500 mg/h');
    expect(html).toContain('Ajustées par toi');
    expect(html).toContain('name="cond_hot_hydration"');
    expect(html).toContain('value="700"');
    expect(html).toContain('placeholder="PLUKA : 625"');
    expect(html).toContain('Revenir à la proposition PLUKA');
    // Le détail chaud est ouvert, celui du froid (sans valeur à lui) replié.
    expect(html.match(/class="nu-cond-adjust" hidden=""/g)).toHaveLength(1);
  });

  it('sans valeur du coureur, la proposition PLUKA s’applique et le détail reste replié', () => {
    const html = render({ conditions: [{ ...HOT, hydrationMlPerHour: null }] });

    expect(html).toContain('60 g/h · 625 ml/h · 500 mg/h');
    expect(html).toContain('Proposition PLUKA');
    expect(html.match(/class="nu-cond-adjust" hidden=""/g)).toHaveLength(2);
    expect(html).not.toContain('Revenir à la proposition PLUKA');
  });

  it('propose les quatre répartitions de la caféine, et le repère de la course', () => {
    const html = render();

    for (const label of ['Automatique', 'Deuxième partie', 'Période nocturne', 'Manuel']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('name="caffeineSpread" value="auto"');
    expect(html).toContain('Départ 06:00 · arrivée estimée vers 02:00, après 20:00 de course.');
  });
});

const PROFILE = (targets: (typeof PROPOSALS)['hot'], custom = false) => ({
  targets,
  proposal: targets,
  custom: { carbs: false, hydration: custom, sodium: false },
});

describe('la bande dit ce qui s’applique', () => {
  it('les plages avec leur heure, les cibles retenues, la caféine et ce qui a été ajusté', () => {
    const result = {
      conditions: {
        hot: PROFILE({ ...PROPOSALS.hot, hydrationMlPerHour: 700 }, true),
        cold: PROFILE(PROPOSALS.cold),
        ranges: [
          { kind: 'hot', startElapsedSeconds: 4 * HOUR, endElapsedSeconds: 9 * HOUR },
          { kind: 'night', startElapsedSeconds: 14 * HOUR, endElapsedSeconds: 16 * HOUR },
        ],
        caffeineSpread: 'night',
        warnings: ['range_truncated'],
      },
    } as unknown as NutritionResult;

    const band = conditionsBand(
      view({
        state: 'ready',
        result,
        settings: { caffeineTotalMg: 200 } as NutritionStrategyView['settings'],
      }),
    );

    expect(band).toEqual({
      periods: [
        { key: 'hot-0', type: 'hot', label: 'Chaud 4:00 → 9:00', clock: '10:00 → 15:00' },
        { key: 'night-1', type: 'night', label: 'Nuit 14:00 → 16:00', clock: '20:00 → 22:00' },
      ],
      profiles: ['Temps chaud : 60 g/h · 700 ml/h · 500 mg/h · tes valeurs'],
      caffeine: 'Caféine : sur tes plages de nuit',
      warnings: ['Une plage dépasse ton arrivée estimée : elle s’arrête à l’arrivée.'],
    });
  });
});
