import type { PlanPointView, PlanProfileSample } from '@pluka/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AltitudeProfile } from '@/app/(shell)/courses/[participantRaceId]/plan/altitude-profile';
import type { ProfileWeather, ProfileWeatherMark } from '@/lib/conditions-format';

/**
 * La météo posée sur le profil du Plan : un picto et la température au-dessus
 * de chaque point, une fois les Conditions ouvertes (J-14, Race Pass).
 *
 * Le serveur choisit les points et leur place ; le navigateur ne fait que les
 * montrer ou les masquer avec la puce « Météo ».
 */

function point(id: string, distanceKm: number): PlanPointView {
  return {
    raceWaypointId: id,
    name: id === 'wp-0' ? 'Départ' : `Point ${distanceKm}`,
    sortOrder: distanceKm,
    distanceKm,
    waypointType: 'other',
    altitudeM: null,
    gainFromStartM: null,
    plannedElapsedSeconds: distanceKm * 600,
    plannedArrivalAt: new Date(Date.UTC(2026, 10, 28, 7, 20) + distanceKm * 600_000).toISOString(),
    stopDurationSeconds: 0,
    plannedDepartureElapsedSeconds: distanceKm * 600,
    plannedDepartureAt: new Date(
      Date.UTC(2026, 10, 28, 7, 20) + distanceKm * 600_000,
    ).toISOString(),
    isLocked: false,
    lockedElapsedSeconds: null,
    incomingSegment: null,
  } as PlanPointView;
}

function mark(id: string, distanceKm: number, temperature = '3 °'): ProfileWeatherMark {
  return {
    key: `key-${id}`,
    raceWaypointId: id,
    distanceKm,
    icon: 'Sun',
    temperature,
    text: `Ciel dégagé, ${temperature.replace(' °', ' °C')}`,
  };
}

/** Un sommet au km 5 d'un parcours de 10 km. */
const PROFILE: PlanProfileSample[] = Array.from({ length: 11 }, (_, km) => ({
  distanceKm: km,
  elevationMeters: 1000 + 100 * (5 - Math.abs(5 - km)),
}));

function weather(marks: readonly ProfileWeatherMark[]): ProfileWeather & { href: string } {
  return {
    marks,
    updated: 'ven. 27 nov. à 10:02',
    attribution: {
      text: 'Weather data by Open-Meteo.com',
      url: 'https://open-meteo.com/',
      licence: 'CC BY 4.0',
      licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    },
    href: '/courses/pr-1/plan/conditions',
  };
}

function render(
  points: readonly PlanPointView[],
  forecast: ReturnType<typeof weather> | null,
  variant: 'dark' | 'light' = 'dark',
): string {
  return renderToStaticMarkup(
    <AltitudeProfile
      profile={PROFILE}
      points={points}
      timezone="Europe/Paris"
      anchored
      variant={variant}
      weather={forecast}
    />,
  );
}

/** Les pictos posés, dans l'ordre du parcours. */
function stations(html: string): { left: string; wide: boolean; temperature: string }[] {
  return [
    ...html.matchAll(
      /<a href="[^"]*" tabindex="-1" title="[^"]*" class="(pl-wx[^"]*)" style="left:clamp\(var\(--pl-wx-half\), ([\d.]+)%[^"]*">.*?<span class="pl-wx-temp">([^<]+)<\/span><\/a>/g,
    ),
  ].map((match) => ({
    left: match[2] as string,
    wide: (match[1] as string).includes('pl-wx-wide'),
    temperature: match[3] as string,
  }));
}

const THREE = [point('wp-0', 0), point('wp-5', 5), point('wp-10', 10)];

describe('la météo sur le profil du Plan', () => {
  it('un picto et la température au-dessus de chaque point, qui mènent à Conditions', () => {
    const html = render(
      THREE,
      weather([mark('wp-0', 0, '-1 °'), mark('wp-5', 5, '-2 °'), mark('wp-10', 10, '0 °')]),
    );

    expect(stations(html)).toEqual([
      { left: '0.00', wide: false, temperature: '-1 °' },
      { left: '50.00', wide: false, temperature: '-2 °' },
      { left: '100.00', wide: false, temperature: '0 °' },
    ]);
    expect(html).toContain('href="/courses/pr-1/plan/conditions"');
    expect(html).toContain('class="pl-weather" aria-hidden="true"');
  });

  it('la puce « Météo » montre ou masque les pictos ; ils sont affichés d’abord', () => {
    const html = render(THREE, weather([mark('wp-5', 5)]));

    expect(html).toContain('data-weather="on"');
    expect(html).toMatch(
      /<button type="button" class="pl-layer-chip" aria-pressed="true">.*?Météo<\/button>/,
    );
  });

  it('§53 — prévision externe, datée, et sa source à côté', () => {
    const html = render(THREE, weather([mark('wp-5', 5)]));

    expect(html).toContain('prévision externe, mise à jour ven. 27 nov. à 10:02');
    expect(html).toContain('href="https://open-meteo.com/"');
    expect(html).toContain('CC BY 4.0');
    expect(html).not.toContain('Officielle');
  });

  it('06 §51 — la météo de chaque passage se lit aussi sans image', () => {
    const html = render(THREE, weather([mark('wp-5', 5, '-2 °')]));

    expect(html).toContain('Point 5 — 09:10 · météo prévue : Ciel dégagé, -2 °C');
  });

  it('un fil relie le picto à son point, sauf au départ et à l’arrivée (au bord)', () => {
    const html = render(THREE, weather([mark('wp-0', 0), mark('wp-5', 5), mark('wp-10', 10)]));
    const stems = [...html.matchAll(/class="pl-wx-stem[^"]*" style="left:([\d.]+)%/g)].map(
      (match) => match[1],
    );

    expect(stems).toEqual(['50.00']);
  });

  it('des points trop serrés : départ, arrivée puis les plus hauts d’abord', () => {
    // Un point par km : 10 % d'écart, assez sur un profil large. Sur un profil
    // étroit (17 %), restent le départ, l'arrivée, le sommet, puis les plus hauts.
    const points = Array.from({ length: 11 }, (_, km) => point(km === 0 ? 'wp-0' : `wp-${km}`, km));
    const html = render(points, weather(points.map((p) => mark(p.raceWaypointId, p.distanceKm))));
    const placed = stations(html);

    expect(placed).toHaveLength(11);
    expect(placed.filter((station) => !station.wide).map((station) => station.left)).toEqual([
      '0.00',
      '30.00',
      '50.00',
      '70.00',
      '100.00',
    ]);
  });

  it('deux points à moins de 8 % : un seul picto, le plus haut', () => {
    const points = [point('wp-0', 0), point('wp-4.6', 4.6), point('wp-5', 5), point('wp-10', 10)];
    const html = render(points, weather(points.map((p) => mark(p.raceWaypointId, p.distanceKm))));

    expect(stations(html).map((station) => station.left)).toEqual(['0.00', '50.00', '100.00']);
  });

  it('sans prévision, ni picto ni puce « Météo »', () => {
    const html = render(THREE, null);

    expect(html).not.toContain('pl-weather');
    expect(html).not.toContain('Météo');
    expect(html).toContain('data-weather="off"');
  });

  it('le profil clair (hors bannière du Plan) ne pose pas la météo', () => {
    const html = render(THREE, weather([mark('wp-5', 5)]), 'light');

    expect(html).not.toContain('pl-weather');
    expect(html).not.toContain('météo prévue');
  });
});
