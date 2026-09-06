import type { PlanOverview } from '@pluka/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * Écran du Plan — PLAN_ENGINE §64, §65 ; 06_DESIGN_SYSTEM.md §47, §51, §53.
 *
 * Les Server Actions sont remplacées : elles ouvrent une session Supabase et
 * n'ont rien à faire dans un test de rendu. Ce qui est vérifié ici est le
 * balisage qu'un coureur reçoit à la première réponse du serveur — avant tout
 * JavaScript, donc avant qu'un `useActionState` ait pu changer quoi que ce soit.
 */
vi.mock('@/app/actions', () => {
  const noop = async () => ({});

  return {
    changePlanTargetAction: noop,
    preservePlanAction: noop,
    rebalancePlanAction: noop,
    removeSegmentOverrideAction: noop,
    updateSegmentDurationAction: noop,
    updateStopAction: noop,
    generatePlanAction: noop,
  };
});

const { AltitudeProfile } = await import('@/app/courses/[participantRaceId]/plan/altitude-profile');
const { PlanPoints } = await import('@/app/courses/[participantRaceId]/plan/plan-points');

const PARTICIPATION = 'aaaaaaaa-0000-4000-8000-000000000001';
const WP0 = 'ffff0000-0000-4000-8000-000000000010';
const WP1 = 'ffff0000-0000-4000-8000-000000000011';
const WP2 = 'ffff0000-0000-4000-8000-000000000012';

/**
 * Le parcours P01 du moteur : dix kilomètres en deux sections de 5 km, 1756 s
 * puis 1844 s pour un objectif d'une heure. Les valeurs affichées restent donc
 * vérifiables à la main.
 */
function overview(patch: Partial<PlanOverview> = {}): PlanOverview {
  const points: PlanOverview['points'] = [
    {
      raceWaypointId: WP0,
      name: 'Départ',
      sortOrder: 0,
      distanceKm: 0,
      altitudeM: 900,
      plannedElapsedSeconds: 0,
      plannedArrivalAt: '2026-06-20T04:00:00.000Z',
      stopDurationSeconds: 0,
      plannedDepartureElapsedSeconds: 0,
      plannedDepartureAt: '2026-06-20T04:00:00.000Z',
      isLocked: false,
      lockedElapsedSeconds: null,
      incomingSegment: null,
    },
    {
      raceWaypointId: WP1,
      name: 'Col du Test',
      sortOrder: 1,
      distanceKm: 5,
      altitudeM: 1400,
      plannedElapsedSeconds: 1756,
      plannedArrivalAt: '2026-06-20T04:29:16.000Z',
      stopDurationSeconds: 300,
      plannedDepartureElapsedSeconds: 2056,
      plannedDepartureAt: '2026-06-20T04:34:16.000Z',
      isLocked: true,
      lockedElapsedSeconds: 1756,
      incomingSegment: {
        raceSegmentId: 'ffff0000-0000-4000-8000-000000000020',
        distanceKm: 5,
        plannedDurationSeconds: 1756,
        initialDurationSeconds: 1700,
        manualOverride: true,
        paceSecondsPerKm: 351,
      },
    },
    {
      raceWaypointId: WP2,
      name: 'Arrivée',
      sortOrder: 2,
      distanceKm: 10,
      altitudeM: 900,
      plannedElapsedSeconds: 3600,
      plannedArrivalAt: '2026-06-20T05:00:00.000Z',
      stopDurationSeconds: 0,
      plannedDepartureElapsedSeconds: 3600,
      plannedDepartureAt: '2026-06-20T05:00:00.000Z',
      isLocked: false,
      lockedElapsedSeconds: null,
      incomingSegment: {
        raceSegmentId: 'ffff0000-0000-4000-8000-000000000021',
        distanceKm: 5,
        plannedDurationSeconds: 1844,
        initialDurationSeconds: 1844,
        manualOverride: false,
        paceSecondsPerKm: 369,
      },
    },
  ];

  return {
    racePlanId: 'plan-1',
    version: 1,
    engineVersion: 'plan-v1.0.0',
    startAt: '2026-06-20T04:00:00.000Z',
    timezone: 'Europe/Paris',
    targetDurationSeconds: 3600,
    initialTargetDurationSeconds: 3600,
    finishElapsedSeconds: 3600,
    driftSeconds: 0,
    points,
    profile: [
      { distanceKm: 0, elevationMeters: 900 },
      { distanceKm: 5, elevationMeters: 1400 },
      { distanceKm: 10, elevationMeters: 900 },
    ],
    profileIsAnchored: true,
    cutoffs: [
      {
        raceCutoffId: 'cutoff-col',
        raceWaypointId: WP1,
        waypointName: 'Col du Test',
        marginSeconds: 1844,
        status: 'comfortable',
      },
    ],
    tightestCutoff: {
      raceCutoffId: 'cutoff-col',
      raceWaypointId: WP1,
      waypointName: 'Col du Test',
      marginSeconds: 1844,
      status: 'comfortable',
    },
    ...patch,
  };
}

function points(patch: Partial<PlanOverview> = {}): string {
  return renderToStaticMarkup(
    <PlanPoints
      participantRaceId={PARTICIPATION}
      overview={overview(patch)}
      timezone="Europe/Paris"
    />,
  );
}

describe('points du parcours', () => {
  it('affiche l’heure de passage dans le fuseau de la course', () => {
    // §5.3 : les heures sont celles du terrain. Le départ est à 04:00 UTC,
    // donc 06:00 à Paris — un coureur qui prépare depuis un autre fuseau lit
    // l'heure de la course, pas celle de son navigateur.
    const html = points();

    expect(html).toContain('06:00');
    expect(html).toContain('06:29');
    expect(html).toContain('07:00');
  });

  it('affiche le temps écoulé depuis le départ, pas une heure', () => {
    // §5.1 : « des secondes écoulées depuis le départ effectif ».
    const html = points();

    expect(html).toContain('00:29');
    expect(html).toContain('01:00');
  });

  it('affiche l’allure de chaque section', () => {
    // 351 et 369 s/km, calculées par `getPlanOverview` : l'écran les met en
    // forme, il ne les divise pas.
    const html = points();

    expect(html).toContain('5:51');
    expect(html).toContain('6:09');
  });

  it('nomme la marge au lieu de la coder en couleur', () => {
    // §185 : un état se lit. Le badge porte le texte, pas seulement une teinte.
    const html = points();

    expect(html).toContain('Marge confortable');
    expect(html).toContain('+00:30');
  });

  it('dit qu’une heure est verrouillée', () => {
    // §26 : un waypoint verrouillé ne bouge plus. L'écran doit le dire, sinon
    // le coureur ne comprend pas pourquoi le rééquilibrage l'ignore.
    expect(points()).toContain('Heure verrouillée');
  });

  it('écrit les distances en décimale française', () => {
    const html = points();

    expect(html).toContain('>5,0<');
    expect(html).toContain('>10,0<');
  });

  it('rend un tiret plutôt qu’une allure inventée au départ', () => {
    // §54 : ne pas fabriquer de précision. Aucune section ne mène au départ.
    expect(points()).toContain('—');
  });

  it('propose les deux décisions de §22 comme deux actions distinctes', () => {
    // §22.1 et §22.2 sont deux choix du coureur, pas deux valeurs d'un même
    // réglage : deux formulaires, deux libellés de §65.
    const html = points({ driftSeconds: 720, finishElapsedSeconds: 4320 });

    expect(html).toContain('Rééquilibrer pour finir en 01:00');
    expect(html).toContain('Conserver ce Plan');
  });

  it('n’offre aucun arbitrage quand le Plan tient déjà l’objectif', () => {
    // Sans écart, il n'y a rien à trancher.
    const html = points();

    expect(html).not.toContain('Rééquilibrer pour finir');
    expect(html).not.toContain('Conserver ce Plan');
  });

  it('affiche l’écart à l’objectif quand il existe', () => {
    // §27 : l'écart est un état légitime, pas une anomalie à masquer.
    const html = points({ driftSeconds: 720, finishElapsedSeconds: 4320 });

    expect(html).toContain('+00:12');
  });

  it('offre le changement d’objectif et l’édition d’un point', () => {
    const html = points();

    expect(html).toContain('Changer l’objectif');
    expect(html).toContain('Imposer cette durée');
    expect(html).toContain('Enregistrer l’arrêt');
  });

  it('ne propose de revenir à la proposition PLUKA que sur une durée imposée', () => {
    // §24 : une durée imposée reste imposée jusqu'à ce que l'utilisateur la
    // retire. Le bouton qui la retire n'a de sens que là où il y a un override.
    expect(points()).toContain('Revenir à la proposition PLUKA');
    expect(
      points({
        points: overview().points.map((point) =>
          point.incomingSegment === null
            ? point
            : { ...point, incomingSegment: { ...point.incomingSegment, manualOverride: false } },
        ),
      }),
    ).not.toContain('Revenir à la proposition PLUKA');
  });

  it('nomme la table pour qui ne voit pas la mise en page', () => {
    expect(points()).toContain('<caption');
  });
});

describe('profil altimétrique', () => {
  const profile = (patch: Partial<PlanOverview> = {}) => {
    const data = overview(patch);

    return renderToStaticMarkup(
      <AltitudeProfile
        profile={data.profile}
        points={data.points}
        timezone="Europe/Paris"
        anchored={data.profileIsAnchored}
      />,
    );
  };

  it('rend un tracé déjà projeté par le serveur', () => {
    // Aucune série n'est envoyée au navigateur : il reçoit un chemin.
    const html = profile();

    expect(html).toContain('<svg');
    expect(html).toContain('<path');
    expect(html).toContain('M0.0');
  });

  it('donne toujours l’équivalent textuel du tracé', () => {
    // §51 : « un SVG / canvas n'est jamais la seule source de l'information ».
    const html = profile();

    expect(html).toContain('Départ — 06:00');
    expect(html).toContain('Col du Test — 06:29');
    expect(html).toContain('Arrivée — 07:00');
  });

  it('décrit le graphique pour un lecteur d’écran', () => {
    expect(profile()).toContain('role="img"');
    expect(profile()).toContain('aria-label="Profil du parcours, 10,0 kilomètres"');
  });

  it('marque l’arrivée en Aube et les autres points en neutre', () => {
    // §49 : triangle Aube pour la prochaine échéance, jalon neutre ailleurs.
    const html = profile();

    expect(html).toContain('var(--pk-dawn)');
    expect(html.match(/<circle/g)).toHaveLength(2);
    expect(html.match(/<polygon/g)).toHaveLength(1);
  });

  it('avoue une altitude non ancrée plutôt que d’afficher des mètres inventés', () => {
    // §54, point 8.
    const html = profile({ profileIsAnchored: false });

    expect(html).toContain('Altitudes relatives au départ');
    expect(profile()).not.toContain('Altitudes relatives au départ');
  });

  it('reste lisible sans parcours prétraité', () => {
    // Sans micro-segments, pas de courbe — mais les passages restent une
    // information complète.
    const html = profile({ profile: [] });

    expect(html).not.toContain('<svg');
    expect(html).toContain('Départ — 06:00');
    expect(html).toContain('n’est pas encore disponible');
  });
});
