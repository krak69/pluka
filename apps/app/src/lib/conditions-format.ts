import type { ConditionsPointView, RaceConditionsView } from '@pluka/domain';

import type { IconName } from '@/components/icon';
import { formatClock } from '@/lib/plan-format';

/**
 * L'écran Conditions, mis en forme côté serveur — prototype « Conditions de
 * course » ; WEATHER_CONDITIONS §7, §9, §11, §12, §50 à §59.
 *
 * Les heures sont celles du fuseau de la course ; une mesure absente s'écrit
 * « — », jamais remplacée (§54). Aucun seuil de « pluie probable » ou de
 * « froid » ici : ils attendent leur calibrage (§38). L'écran dit les faits de
 * la prévision, aux points du Plan.
 */

const HORIZONS: Readonly<Record<string, string>> = {
  far: 'Prévision lointaine · à confirmer',
  medium: 'Prévision intermédiaire',
  near: 'Prévision rapprochée',
  race_day: 'Dernière actualisation',
};

/** §56 : la taxonomie PLUKA du ciel, en clair et en icône. */
const SKIES: Readonly<Record<string, { readonly label: string; readonly icon: IconName }>> = {
  clear: { label: 'Ciel dégagé', icon: 'Sun' },
  partly_cloudy: { label: 'Éclaircies', icon: 'CloudSun' },
  cloudy: { label: 'Couvert', icon: 'Cloud' },
  fog: { label: 'Brouillard', icon: 'CloudFog' },
  drizzle: { label: 'Bruine', icon: 'CloudRain' },
  rain: { label: 'Pluie', icon: 'CloudRain' },
  heavy_rain: { label: 'Forte pluie', icon: 'CloudRain' },
  snow: { label: 'Neige', icon: 'CloudSnow' },
  storm: { label: 'Orage', icon: 'CloudLightning' },
};

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'] as const;

const integer = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

function degrees(value: number | null): string {
  return value === null ? '—' : `${integer.format(value)} °C`;
}

function kmh(value: number | null): string {
  return value === null ? '—' : `${integer.format(value)} km/h`;
}

function day(isoInstant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(new Date(isoInstant));
}

function longDay(date: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00.000Z`));
}

/** D'où vient le vent : 280° → « O ». */
function compass(direction: number | null): string | null {
  if (direction === null) return null;
  return COMPASS[Math.round(direction / 45) % 8] ?? null;
}

export interface ConditionsPointLine {
  readonly key: string;
  /** « 17:20 », précédé du jour s'il n'est pas celui du départ : « dim. 03:10 ». */
  readonly eta: string;
  /** « sam. 12 sept. · 17:20 » */
  readonly passage: string;
  readonly name: string;
  /** « km 40,5 · 2 429 m » */
  readonly meta: string;
  readonly sky: string;
  readonly icon: IconName | null;
  readonly temperature: string;
  /** « ressenti 1 °C » */
  readonly feelsLike: string;
  /** « rafales 52 km/h » */
  readonly gust: string;
  /** « 60 % » ; « — » sans donnée. */
  readonly rain: string;
  /** « 1,2 mm » ; nul sans donnée. */
  readonly rainAmount: string | null;
  readonly wind: string;
  /** « O » : d'où vient le vent ; nul sans donnée. */
  readonly windFrom: string | null;
}

export interface ConditionsSummary {
  /** « 4 → 9 °C » */
  readonly range: string;
  readonly feelsMin: string;
  /** « ressenti minimum · Col du Rawil » */
  readonly feelsMinAt: string;
  readonly gustMax: string;
  readonly gustMaxAt: string;
  /** « Pluie jusqu’à 60 % », ou « Pas de pluie annoncée ». */
  readonly rain: string;
  /** « Col du Rawil · 17:20 » ; nul sans pluie annoncée. */
  readonly rainAt: string | null;
}

export type ConditionsScreen =
  | {
      readonly kind: 'unavailable';
      readonly title: string;
      readonly body: string;
      readonly action: {
        readonly label: string;
        readonly href: string;
        readonly primary: boolean;
      } | null;
    }
  | {
      readonly kind: 'waiting';
      /** La première prévision a échoué : rien à montrer pour le moment (§54). */
      readonly failed: boolean;
    }
  | {
      readonly kind: 'forecast';
      /** §9 : l'horizon, en libellé qualitatif. */
      readonly horizon: string;
      /** §53 : « jeu. 10 sept. à 18:20 ». */
      readonly updated: string;
      readonly notices: readonly string[];
      readonly summary: ConditionsSummary | null;
      readonly nights: readonly string[];
      readonly points: readonly ConditionsPointLine[];
    };

function localDate(isoInstant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(isoInstant));
}

function pointLine(
  point: ConditionsPointView,
  timeZone: string,
  startDate: string | null,
): ConditionsPointLine {
  const clock = formatClock(point.plannedDatetime, timeZone);
  const sameDay = startDate === null || localDate(point.plannedDatetime, timeZone) === startDate;
  const sky = point.weatherCode === null ? undefined : SKIES[point.weatherCode];
  return {
    key: point.pointKey,
    eta: sameDay
      ? clock
      : `${new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone }).format(new Date(point.plannedDatetime))} ${clock}`,
    passage: `${day(point.plannedDatetime, timeZone)} · ${clock}`,
    name: point.label ?? 'Point du parcours',
    meta: [
      point.distanceKm === null ? null : `km ${decimal.format(point.distanceKm)}`,
      point.routeAltitudeM === null ? null : `${integer.format(point.routeAltitudeM)} m`,
    ]
      .filter((part) => part !== null)
      .join(' · '),
    sky: sky?.label ?? '—',
    icon: sky?.icon ?? null,
    temperature: degrees(point.temperatureC),
    feelsLike: `ressenti ${degrees(point.apparentTemperatureC)}`,
    gust: `rafales ${kmh(point.windGustKmh)}`,
    rain:
      point.precipitationProbabilityPct === null
        ? '—'
        : `${integer.format(point.precipitationProbabilityPct)} %`,
    rainAmount:
      point.precipitationAmountMm === null
        ? null
        : `${decimal.format(point.precipitationAmountMm)} mm`,
    wind: kmh(point.windSpeedKmh),
    windFrom: compass(point.windDirectionDeg),
  };
}

function extreme(
  points: readonly ConditionsPointView[],
  value: (point: ConditionsPointView) => number | null,
  pick: 'min' | 'max',
): ConditionsPointView | null {
  let best: ConditionsPointView | null = null;
  for (const point of points) {
    const current = value(point);
    if (current === null) continue;
    const known = best === null ? null : value(best);
    if (known === null || (pick === 'min' ? current < known : current > known)) best = point;
  }
  return best;
}

/** §50 : ce qui mérite d'être regardé, pas quinze indicateurs. */
function summaryOf(
  points: readonly ConditionsPointView[],
  timeZone: string,
): ConditionsSummary | null {
  const coldest = extreme(points, (point) => point.temperatureC, 'min');
  const warmest = extreme(points, (point) => point.temperatureC, 'max');
  if (coldest === null || warmest === null) return null;
  const feels = extreme(points, (point) => point.apparentTemperatureC, 'min');
  const windiest = extreme(points, (point) => point.windGustKmh, 'max');
  const wettest = extreme(points, (point) => point.precipitationProbabilityPct, 'max');
  const rain = wettest?.precipitationProbabilityPct ?? null;
  const name = (point: ConditionsPointView) => point.label ?? 'un point du parcours';
  return {
    range: `${integer.format(coldest.temperatureC as number)} → ${degrees(warmest.temperatureC)}`,
    feelsMin: degrees(feels?.apparentTemperatureC ?? null),
    feelsMinAt: feels === null ? 'ressenti minimum' : `ressenti minimum · ${name(feels)}`,
    gustMax: kmh(windiest?.windGustKmh ?? null),
    gustMaxAt: windiest === null ? 'rafales max' : `rafales max · ${name(windiest)}`,
    // Une probabilité, pas une intensité (§58), sans seuil de « pluie probable » (§38).
    rain:
      rain === null
        ? 'Pluie : —'
        : rain === 0
          ? 'Pas de pluie annoncée'
          : `Pluie jusqu’à ${integer.format(rain)} %`,
    rainAt:
      wettest === null || rain === null || rain === 0
        ? null
        : `${name(wettest)} · ${formatClock(wettest.plannedDatetime, timeZone)}`,
  };
}

export function conditionsScreen(
  view: RaceConditionsView,
  participantRaceId: string,
): ConditionsScreen {
  const planHref = `/courses/${participantRaceId}/plan`;
  switch (view.status) {
    case 'too_early':
      return {
        kind: 'unavailable',
        title:
          view.opensOn === null
            ? 'Conditions disponibles à partir de J-14'
            : `Conditions disponibles à partir du ${longDay(view.opensOn)}`,
        body: 'PLUKA croise la prévision avec tes horaires de passage à partir de J-14. Plus tôt, une prévision ne dirait rien d’utile sur ta course. Les informations de l’organisation, elles, restent toujours accessibles.',
        action: null,
      };
    case 'no_plan':
      return {
        kind: 'unavailable',
        title: 'Crée ton Plan pour voir les conditions selon tes heures de passage',
        body: 'Les conditions se lisent là où tu seras, au moment où tu devrais y passer : il leur faut ton Plan.',
        action: { label: 'Créer mon Plan', href: planHref, primary: true },
      };
    case 'missing_time':
    case 'missing_date':
      return {
        kind: 'unavailable',
        title: 'Il manque l’heure de départ de ton Plan',
        body: 'Sans heure de départ, PLUKA ne sait pas quand tu passeras à chaque point.',
        action: { label: 'Voir mon Plan', href: planHref, primary: false },
      };
    case 'past':
      return {
        kind: 'unavailable',
        title: 'La course est passée',
        body: 'Les conditions prévues ne sont plus mises à jour après le jour du départ.',
        action: null,
      };
    case 'not_entitled':
      return {
        kind: 'unavailable',
        title: 'Température, ressenti, pluie et vent, là où tu seras',
        body: 'Les conditions croisées avec ton Plan, tes horaires de passage et l’altitude du parcours font partie du Race Pass. Les informations météo officielles de l’organisation, elles, restent toujours accessibles.',
        action: {
          label: 'Préparer cette course avec Race Pass',
          href: `/offre?course=${participantRaceId}`,
          primary: true,
        },
      };
    case 'eligible':
      break;
  }

  if (view.forecast === null) return { kind: 'waiting', failed: view.lastFailureAt !== null };

  const timeZone = view.timezone;
  const forecast = view.forecast;
  const startDate = view.startAt === null ? null : localDate(view.startAt, timeZone);
  const notices = [
    forecast.completeness === 'partial'
      ? 'Certains points n’ont pas encore de prévision : ils sont trop loin dans le temps pour le fournisseur.'
      : null,
    view.lastFailureAt === null
      ? null
      : `La dernière mise à jour a échoué à ${formatClock(view.lastFailureAt, timeZone)} : la prévision affichée reste la précédente.`,
  ].filter((notice): notice is string => notice !== null);

  return {
    kind: 'forecast',
    horizon: view.horizon === null ? '' : (HORIZONS[view.horizon] ?? ''),
    updated: `${day(forecast.fetchedAt, timeZone)} à ${formatClock(forecast.fetchedAt, timeZone)}`,
    notices,
    summary: summaryOf(forecast.points, timeZone),
    nights: forecast.nights.map((night) => {
      const from = night.fromStart
        ? 'dès le départ'
        : `${day(night.startDatetime, timeZone)} ${formatClock(night.startDatetime, timeZone)}`;
      const to = night.untilFinish
        ? 'jusqu’à l’arrivée'
        : `${day(night.endDatetime, timeZone)} ${formatClock(night.endDatetime, timeZone)}`;
      return `Nuit : ${from} → ${to}`;
    }),
    points: forecast.points.map((point) => pointLine(point, timeZone, startDate)),
  };
}

/** « sam. 12 sept. · 08:00 · Départ » : la ligne de course de la bande. */
export function conditionsRaceLine(view: RaceConditionsView): string | null {
  if (view.startAt === null) return null;
  const first = view.forecast?.points[0]?.label ?? null;
  return [day(view.startAt, view.timezone), formatClock(view.startAt, view.timezone), first]
    .filter((part) => part !== null)
    .join(' · ');
}

/**
 * Le lien de l'Accueil — prototype `wxCta` : « Conditions disponibles · … »,
 * seulement une fois la fenêtre J-14 ouverte. Sans Race Pass, il mène à
 * l'offre depuis l'écran Conditions.
 */
export function conditionsTeaser(view: RaceConditionsView): string | null {
  if (view.status === 'not_entitled') return 'Race Pass · PLUKA+';
  if (view.status !== 'eligible') return null;
  return view.horizon === null ? null : (HORIZONS[view.horizon] ?? null);
}

export interface ConditionsNextPoint {
  readonly name: string;
  /** « 08:33 · 2 385 m » */
  readonly where: string;
  readonly icon: IconName | null;
  /** « 3 ° » : le format court du prototype. */
  readonly temperature: string;
  readonly feelsLike: string;
  readonly wind: string;
}

function shortDegrees(value: number | null): string {
  return value === null ? '—' : `${integer.format(value)} °`;
}

/**
 * Accueil, prototype `wxNextPoint` : le prochain point clé du Plan, et ce qui
 * l'attend. Avant le départ, c'est le départ lui-même. Rien sans prévision.
 */
export function conditionsNextPoint(
  view: RaceConditionsView,
  now: Date,
): ConditionsNextPoint | null {
  if (view.status !== 'eligible' || view.forecast === null) return null;
  const next = view.forecast.points.find(
    (point) => new Date(point.plannedDatetime).getTime() > now.getTime(),
  );
  if (next === undefined) return null;
  const sky = next.weatherCode === null ? undefined : SKIES[next.weatherCode];
  return {
    name: next.label ?? 'Point du parcours',
    where: [
      formatClock(next.plannedDatetime, view.timezone),
      next.routeAltitudeM === null ? null : `${integer.format(next.routeAltitudeM)} m`,
    ]
      .filter((part) => part !== null)
      .join(' · '),
    icon: sky?.icon ?? null,
    temperature: shortDegrees(next.temperatureC),
    feelsLike: `ressenti ${shortDegrees(next.apparentTemperatureC)}`,
    wind: `vent ${kmh(next.windSpeedKmh)}`,
  };
}
