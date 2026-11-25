import type { NutritionPlanReview, NutritionResult, OrphanMilestoneView } from '@pluka/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { orphanLines, reviewLines } from '@/lib/nutrition-format';

/**
 * Le Plan a changé — NUTRITION_ENGINE §61 à §66, N25 à N28 ; décisions du
 * 2026-11-23. Le récapitulatif dit ce qui change avant de valider ; une prise
 * sans place garde ses produits, à placer ou à rendre à PLUKA.
 */
vi.mock('@/app/(shell)/courses/[participantRaceId]/plan/nutrition-actions', () => {
  const noop = async () => ({});
  return {
    applyNutritionAction: noop,
    placeOrphanAction: noop,
    resetMilestoneAction: noop,
  };
});

const { NutritionReview, OrphanPanel } =
  await import('@/app/(shell)/courses/[participantRaceId]/plan/nutrition-review');

const START = '2026-06-20T04:00:00.000Z';
const PARTICIPATION = 'aaaaaaaa-0000-4000-8000-000000000001';
const GEL = { userProductId: 'p-gel', label: 'Gel 25', quantity: 2 };

const REVIEW: NutritionPlanReview = {
  kept: [
    {
      stableKey: 'intake:r1:1',
      label: 'Prise',
      before: { elapsedSeconds: 2 * 3600, distanceKm: 12.4 },
      after: { elapsedSeconds: 2 * 3600 + 30 * 60, distanceKm: 12.4 },
      shifted: true,
      items: [GEL],
    },
    {
      stableKey: 'aid:r1',
      label: 'Col du Test',
      before: { elapsedSeconds: 3600, distanceKm: 10 },
      after: { elapsedSeconds: 3600, distanceKm: 10 },
      shifted: false,
      items: [],
    },
  ],
  orphaned: [
    {
      stableKey: 'intake:depart:4',
      label: 'Prise',
      elapsedSeconds: 50 * 60,
      distanceKm: 8.5,
      items: [GEL],
      placeable: true,
    },
  ],
  canApply: true,
};

describe('le récapitulatif avant validation', () => {
  it('dit l’heure avant et après, sans arrondir un décalage en « rien »', () => {
    const view = reviewLines(REVIEW, START, 'Europe/Paris');

    expect(view.kept.map((line) => [line.where, line.items, line.shifted])).toEqual([
      ['Prise · 08:00 → 08:30 · km 12,4', '2 × Gel 25', true],
      ['Col du Test · 07:00 · km 10', 'Rien à cette prise', false],
    ]);
    expect(view.orphaned).toEqual([
      { key: 'intake:depart:4', where: 'Prise de 06:50 · km 8,5', items: '2 × Gel 25' },
    ]);
  });

  it('dit aussi le kilomètre quand il change', () => {
    const first = REVIEW.kept[0] as NutritionPlanReview['kept'][number];
    const [line] = reviewLines(
      {
        ...REVIEW,
        kept: [{ ...first, after: { elapsedSeconds: 2 * 3600, distanceKm: 10.1 }, shifted: false }],
      },
      START,
      'Europe/Paris',
    ).kept;

    expect(line?.where).toBe('Prise · 08:00 · km 12,4 → 10,1');
  });

  it('montre la validation, l’heure changée par un libellé, et les produits gardés', () => {
    const html = renderToStaticMarkup(
      <NutritionReview
        participantRaceId={PARTICIPATION}
        review={reviewLines(REVIEW, START, 'Europe/Paris')}
      />,
    );

    expect(html).toContain('Ton Plan a changé : vérifie ta Nutrition');
    expect(html).toContain('Heure changée');
    expect(html).toContain('Une prise n’a plus de place');
    expect(html).toContain('À replacer');
    expect(html).toContain('Ces produits sont gardés');
    expect(html).toContain('Appliquer au nouveau Plan');
  });

  it('sans Race Pass, dit pourquoi au lieu d’offrir la validation', () => {
    const html = renderToStaticMarkup(
      <NutritionReview
        participantRaceId={PARTICIPATION}
        review={reviewLines({ ...REVIEW, canApply: false }, START, 'Europe/Paris')}
      />,
    );

    expect(html).not.toContain('Appliquer au nouveau Plan');
    expect(html).toContain('Valider ta stratégie demande le Race Pass.');
  });
});

/** Deux prises et un ravitaillement, puis l'arrivée. */
function result(): NutritionResult {
  const need = { carbsG: 20, hydrationMl: 150, sodiumMg: 100 };
  const milestone = (
    stableKey: string,
    kind: 'intake' | 'aid' | 'finish',
    elapsedSeconds: number,
    distanceKm: number,
    name = 'Prise',
  ) => ({
    stableKey,
    kind,
    pointId: kind === 'intake' ? null : (stableKey.split(':')[1] ?? null),
    name,
    elapsedSeconds,
    distanceKm,
    reason: kind === 'intake' ? ('climb' as const) : kind,
    needSincePrevious: need,
  });
  return {
    engineVersion: 'nutrition-1.1.0',
    configVersion: 'nutrition-config-1.0.0',
    inputHash: 'hash',
    totals: { ...need, caffeineMg: null },
    sections: [],
    milestones: [
      milestone('intake:depart:1', 'intake', 30 * 60, 4),
      milestone('aid:r1', 'aid', 60 * 60, 10, 'Col du Test'),
      milestone('intake:r1:1', 'intake', 90 * 60, 14),
      milestone('finish:arrivee', 'finish', 120 * 60, 20, 'Arrivée'),
    ],
    allocation: null,
    flasks: null,
  };
}

const ORPHAN: OrphanMilestoneView = {
  stableKey: 'intake:depart:4',
  label: 'Prise',
  elapsedSeconds: 55 * 60,
  distanceKm: 8.5,
  items: [GEL],
  placeable: true,
};

describe('les prises à replacer', () => {
  it('propose d’abord la prise la plus proche, jamais l’arrivée', () => {
    const { lines, targets } = orphanLines([ORPHAN], result(), START, 'Europe/Paris');

    expect(lines[0]?.nearest).toBe('aid:r1');
    expect(targets.map((target) => target.label)).toEqual([
      '06:30 · km 4 · Prise',
      '07:00 · km 10 · Col du Test',
      '07:30 · km 14 · Prise',
    ]);
  });

  it('dit pourquoi une prise ne peut que revenir à PLUKA', () => {
    const { lines } = orphanLines(
      [
        { ...ORPHAN, placeable: false },
        { ...ORPHAN, stableKey: 'intake:depart:5', items: [], placeable: false },
      ],
      result(),
      START,
      'Europe/Paris',
    );

    expect(lines.map((line) => line.onlyReturn)).toEqual([
      'Un de ses produits n’est plus dans « Mes produits » : elle ne peut que revenir à PLUKA.',
      'Tu n’y prenais rien : il n’y a rien à replacer.',
    ]);
  });

  it('offre de placer, avec un libellé, ou de rendre à PLUKA', () => {
    const { lines, targets } = orphanLines([ORPHAN], result(), START, 'Europe/Paris');
    const html = renderToStaticMarkup(
      <OrphanPanel participantRaceId={PARTICIPATION} lines={lines} targets={targets} canEdit />,
    );

    expect(html).toContain('Une prise à replacer');
    expect(html).toContain('<label for="nu-orphan-intake-depart-4"');
    expect(html).toContain('id="nu-orphan-intake-depart-4"');
    expect(html).toContain('Placer ici');
    expect(html).toContain('Rendre à PLUKA');
  });

  it('se lit sans gestes quand le coureur ne peut pas modifier', () => {
    const { lines, targets } = orphanLines([ORPHAN], result(), START, 'Europe/Paris');
    const html = renderToStaticMarkup(
      <OrphanPanel
        participantRaceId={PARTICIPATION}
        lines={lines}
        targets={targets}
        canEdit={false}
      />,
    );

    expect(html).toContain('2 × Gel 25');
    expect(html).not.toContain('Placer ici');
    expect(html).not.toContain('Rendre à PLUKA');
  });

  it('ne montre rien sans prise à replacer', () => {
    const html = renderToStaticMarkup(
      <OrphanPanel participantRaceId={PARTICIPATION} lines={[]} targets={[]} canEdit />,
    );

    expect(html).toBe('');
  });
});
