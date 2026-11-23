import type { NutritionResult, PlanPointView, PlanProfileSample } from '@pluka/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { AltitudeProfileProps } from '@/app/(shell)/courses/[participantRaceId]/plan/altitude-profile';
import { profileIntakes, strategyLines } from '@/lib/nutrition-format';

/**
 * Les prises sur le profil du Plan — prototype `planNutMarks` / `profFilters`.
 *
 * Le serveur pose chaque prise sur la courbe ; le navigateur ne fait que la
 * montrer ou la masquer, et mener à sa ligne dans « Ma stratégie ».
 */
vi.mock('@/app/(shell)/courses/[participantRaceId]/plan/nutrition-actions', () => {
  const noop = async () => ({});
  return {
    resetMilestoneAction: noop,
    setMilestoneItemsAction: noop,
    setRefillPointAction: noop,
    setReserveAction: noop,
    setSupplyPointAction: noop,
    sendNutritionAction: noop,
    setAidDrinkAction: noop,
    setAidNoteAction: noop,
  };
});

const { AltitudeProfile } =
  await import('@/app/(shell)/courses/[participantRaceId]/plan/altitude-profile');
const { NutritionViews } =
  await import('@/app/(shell)/courses/[participantRaceId]/plan/nutrition-views');

const WP0 = 'ffff0000-0000-4000-8000-000000000010';
const WP1 = 'ffff0000-0000-4000-8000-000000000011';
const WP2 = 'ffff0000-0000-4000-8000-000000000012';

function point(id: string, name: string, distanceKm: number, at: string): PlanPointView {
  return {
    raceWaypointId: id,
    name,
    sortOrder: distanceKm,
    distanceKm,
    altitudeM: null,
    plannedElapsedSeconds: 0,
    plannedArrivalAt: at,
    stopDurationSeconds: 0,
    plannedDepartureElapsedSeconds: 0,
    plannedDepartureAt: at,
    isLocked: false,
    lockedElapsedSeconds: null,
    incomingSegment: null,
  } as PlanPointView;
}

const POINTS = [
  point(WP0, 'Départ', 0, '2026-06-20T04:00:00.000Z'),
  point(WP1, 'Col du Test', 5, '2026-06-20T04:30:00.000Z'),
  point(WP2, 'Arrivée', 10, '2026-06-20T05:00:00.000Z'),
];

/** 900 m, 1400 m au km 5, 900 m à l'arrivée : un sommet au milieu. */
const PROFILE: PlanProfileSample[] = [
  { distanceKm: 0, elevationMeters: 900 },
  { distanceKm: 5, elevationMeters: 1400 },
  { distanceKm: 10, elevationMeters: 900 },
];

const NEED = { carbsG: 20, hydrationMl: 150, sodiumMg: 100 };
const COVERAGE = { carbs: 1, sodium: 1 };

/** Deux prises, un ravitaillement et l'arrivée ; la seconde prise est vide. */
function result(withProducts = true): NutritionResult {
  return {
    engineVersion: 'nutrition-1.1.0',
    configVersion: 'nutrition-config-1.0.0',
    inputHash: 'hash',
    totals: { ...NEED, caffeineMg: null },
    sections: [],
    milestones: [
      {
        stableKey: `intake:${WP0}:0`,
        kind: 'intake',
        pointId: null,
        name: 'Prise',
        elapsedSeconds: 900,
        distanceKm: 2.5,
        reason: 'climb',
        needSincePrevious: NEED,
      },
      {
        stableKey: `aid:${WP1}`,
        kind: 'aid',
        pointId: WP1,
        name: 'Col du Test',
        elapsedSeconds: 1800,
        distanceKm: 5,
        reason: 'aid',
        needSincePrevious: NEED,
      },
      {
        stableKey: `intake:${WP1}:0`,
        kind: 'intake',
        pointId: null,
        name: 'Prise',
        elapsedSeconds: 2700,
        distanceKm: 7.5,
        reason: 'descent',
        needSincePrevious: NEED,
      },
      {
        stableKey: `finish:${WP2}`,
        kind: 'finish',
        pointId: WP2,
        name: 'Arrivée',
        elapsedSeconds: 3600,
        distanceKm: 10,
        reason: 'finish',
        needSincePrevious: NEED,
      },
    ],
    allocation: withProducts
      ? {
          items: {
            [`intake:${WP0}:0`]: [
              {
                productId: 'p-gel',
                name: 'Gel 25',
                quantity: 1,
                carbsG: 25,
                sodiumMg: 50,
                caffeineMg: 0,
              },
            ],
          },
          drink: null,
          sectionCoverage: [],
          totalCoverage: COVERAGE,
          planned: { carbsG: 25, sodiumMg: 50, caffeineMg: 0 },
          warnings: [],
          customized: [],
        }
      : null,
    flasks: null,
  };
}

const START = '2026-06-20T04:00:00.000Z';

function profile(nutrition: Exclude<AltitudeProfileProps['nutrition'], undefined>): string {
  return renderToStaticMarkup(
    <AltitudeProfile
      profile={PROFILE}
      points={POINTS}
      timezone="Europe/Paris"
      anchored
      variant="dark"
      nutrition={nutrition}
    />,
  );
}

describe('les prises à poser sur le profil', () => {
  it('ne garde que les prises : ravitaillements et arrivée sont déjà des points du parcours', () => {
    const intakes = profileIntakes(result(), START, 'Europe/Paris');

    expect(intakes.map((intake) => intake.distanceKm)).toEqual([2.5, 7.5]);
  });

  it('dit l’heure, le kilomètre et ce qu’il faut prendre', () => {
    const [first, second] = profileIntakes(result(), START, 'Europe/Paris');

    expect(first?.label).toBe('Prise · 06:15 · km 2,5 — 1 × Gel 25');
    expect(second?.label).toBe('Prise · 06:45 · km 7,5 — Rien de prévu');
  });

  it('donne le besoin quand aucun produit n’est encore choisi', () => {
    const [first] = profileIntakes(result(false), START, 'Europe/Paris');

    expect(first?.label).toBe('Prise · 06:15 · km 2,5 — 20 g · 150 ml · 100 mg');
  });

  it('vise la même ancre que la ligne de « Ma stratégie »', () => {
    const intakes = profileIntakes(result(), START, 'Europe/Paris');
    const lines = strategyLines(result(), START, 'Europe/Paris').milestones;

    expect(intakes[0]?.anchor).toBe(`prise-intake-${WP0}-0`);
    expect(lines.map((line) => line.anchor)).toContain(intakes[0]?.anchor);
    expect(intakes[0]?.anchor).not.toContain(':');
  });
});

describe('le profil avec la Nutrition', () => {
  const ready = () => ({
    state: 'ready' as const,
    intakes: profileIntakes(result(), START, 'Europe/Paris'),
  });

  it('pose chaque prise sur la courbe, à son kilomètre et à son altitude', () => {
    const html = profile(ready());

    // km 2,5 sur 10 → 25 % ; 1150 m, à mi-hauteur entre 900 et 1400 → 50 %.
    expect(html).toContain('left:25.00%;top:50.00%');
    // km 7,5 → 75 %, même altitude en descente.
    expect(html).toContain('left:75.00%;top:50.00%');
    expect(html).toContain(`href="#prise-intake-${WP0}-0"`);
    expect(html).toContain('title="Prise · 06:15 · km 2,5 — 1 × Gel 25"');
  });

  it('ne dessine aucun point dans le SVG étiré : prises et jalons sont posés en HTML', () => {
    const html = profile(ready());

    // Un cercle d'un SVG `preserveAspectRatio="none"` deviendrait une ellipse.
    expect(html).not.toContain('<circle');
    expect(html).not.toContain('<polygon');
    expect(html.match(/class="pl-intake"/g)).toHaveLength(2);
    expect(html.match(/class="pl-waypoint"/g)).toHaveLength(2);
    expect(html.match(/class="pl-waypoint pl-waypoint-finish"/g)).toHaveLength(1);
  });

  it('pose chaque jalon sur la courbe, et marque les barrières en Aube', () => {
    const html = renderToStaticMarkup(
      <AltitudeProfile
        profile={PROFILE}
        points={POINTS}
        timezone="Europe/Paris"
        anchored
        variant="dark"
        cutoffWaypointIds={[WP1]}
        nutrition={null}
      />,
    );

    // Col du Test : km 5 sur 10 → 50 % ; 1400 m, le sommet, en haut de la
    // marge de 12 sur 180 → 6,67 %.
    expect(html).toContain('class="pl-waypoint pl-waypoint-cutoff" style="left:50.00%;top:6.67%"');
    expect(html).toContain('class="pl-waypoint pl-waypoint-finish" style="left:100.00%;');
    expect(html).toContain('class="pl-waypoints" aria-hidden="true"');
  });

  it('laisse les prises hors du clavier et des lecteurs d’écran, détaillées dans « Ma stratégie »', () => {
    const html = profile(ready());

    expect(html).toContain('class="pl-intakes" aria-hidden="true"');
    expect(html).toContain('tabindex="-1"');
  });

  it('offre de masquer les prises, et les nomme dans la légende', () => {
    const html = profile(ready());

    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-nutrition="on"');
    expect(html).toContain('Prise nutrition');
  });

  it('mène à l’activation quand la Nutrition est éteinte', () => {
    const html = profile({ state: 'off' });

    expect(html).toContain('href="#nutrition"');
    expect(html).not.toContain('aria-pressed');
    expect(html).not.toContain('class="pl-intake"');
    expect(html).not.toContain('Prise nutrition');
  });

  it('n’ajoute rien quand la Nutrition n’a pas sa place', () => {
    const html = profile(null);

    expect(html).not.toContain('Parcours');
    expect(html).not.toContain('pl-layer-chip');
    expect(html).not.toContain('class="pl-intake"');
  });

  it('n’offre pas de filtre sans aucune prise à montrer', () => {
    const html = profile({ state: 'ready', intakes: [] });

    expect(html).not.toContain('pl-layer-chip');
  });
});

describe('« Ma stratégie » reçoit les points du profil', () => {
  it('porte l’ancre de chaque jalon', () => {
    const lines = strategyLines(result(), START, 'Europe/Paris');
    const html = renderToStaticMarkup(
      <NutritionViews
        participantRaceId="aaaaaaaa-0000-4000-8000-000000000001"
        milestones={lines.milestones}
        sections={lines.sections}
        flasks={null}
        preparation={null}
        aid={[]}
        products={[]}
        canEdit={false}
      />,
    );

    expect(html).toContain(`id="prise-intake-${WP0}-0"`);
    expect(html).toContain(`id="prise-intake-${WP1}-0"`);
  });
});
