import type { ConditionsPointView, RaceConditionsView } from '@pluka/domain';

import { formatClock } from '@/lib/plan-format';

/**
 * L'écran Conditions, mis en forme côté serveur — WEATHER_CONDITIONS §7, §9,
 * §11, §12, §50 à §59. Les heures sont celles du fuseau de la course ; une
 * mesure absente s'écrit « — », jamais remplacée (§54). Aucun seuil de
 * « pluie significative » ou de « froid » ici : ils attendent leur
 * calibrage (§38). L'écran dit les faits de la prévision.
 */

const HORIZONS: Readonly<Record<string, string>> = {
  far: 'Prévision lointaine · à confirmer',
  medium: 'Prévision intermédiaire',
  near: 'Prévision rapprochée',
  race_day: 'Dernière actualisation',
};

/** §56 : la taxonomie PLUKA du ciel, en clair. */
const SKIES: Readonly<Record<string, string>> = {
  clear: 'Ciel dégagé',
  partly_cloudy: 'Éclaircies',
  cloudy: 'Couvert',
  fog: 'Brouillard',
  drizzle: 'Bruine',
  rain: 'Pluie',
  heavy_rain: 'Forte pluie',
  snow: 'Neige',
  storm: 'Orage',
};

const integer = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

function degrees(value: number | null): string {
  return value === null ? '—' : `${integer.format(value)} °C`;
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

export interface ConditionsPointLine {
  readonly key: string;
  readonly name: string;
  /** « km 40 · 2 429 m » */
  readonly where: string;
  /** « sam. 12 sept. · 13:00 » */
  readonly passage: string;
  readonly sky: string;
  readonly temperature: string;
  readonly feelsLike: string;
  /** « 60 % · 1,2 mm » ; nul sans aucune donnée de pluie. */
  readonly rain: string | null;
  /** « 22 km/h, rafales 52 km/h » */
  readonly wind: string;
}

export type ConditionsScreen =
  | {
      readonly kind: 'unavailable';
      readonly title: string;
      readonly body: string;
      readonly action: { readonly label: string; readonly href: string } | null;
    }
  | {
      readonly kind: 'waiting';
      /** La première prévision a échoué : rien à montrer pour le moment (§54). */
      readonly failed: boolean;
    }
  | {
      readonly kind: 'forecast';
      readonly horizon: string;
      /** §53 : « Prévision météo externe · Selon ton Plan actuel · Mise à jour : 18:20 ». */
      readonly freshness: string;
      readonly notices: readonly string[];
      readonly summary: readonly string[];
      readonly nights: readonly string[];
      readonly points: readonly ConditionsPointLine[];
    };

function pointLine(point: ConditionsPointView, timeZone: string): ConditionsPointLine {
  const where = [
    point.distanceKm === null ? null : `km ${decimal.format(point.distanceKm)}`,
    point.routeAltitudeM === null ? null : `${integer.format(point.routeAltitudeM)} m`,
  ]
    .filter((part) => part !== null)
    .join(' · ');
  const rain =
    point.precipitationProbabilityPct === null && point.precipitationAmountMm === null
      ? null
      : [
          point.precipitationProbabilityPct === null
            ? null
            : `${integer.format(point.precipitationProbabilityPct)} %`,
          point.precipitationAmountMm === null
            ? null
            : `${decimal.format(point.precipitationAmountMm)} mm`,
        ]
          .filter((part) => part !== null)
          .join(' · ');
  return {
    key: point.pointKey,
    name: point.label ?? 'Point du parcours',
    where,
    passage: `${day(point.plannedDatetime, timeZone)} · ${formatClock(point.plannedDatetime, timeZone)}`,
    sky: point.weatherCode === null ? '—' : (SKIES[point.weatherCode] ?? '—'),
    temperature: degrees(point.temperatureC),
    feelsLike: `ressenti ${degrees(point.apparentTemperatureC)}`,
    rain,
    wind: `${point.windSpeedKmh === null ? '—' : `${integer.format(point.windSpeedKmh)} km/h`}, rafales ${
      point.windGustKmh === null ? '—' : `${integer.format(point.windGustKmh)} km/h`
    }`,
  };
}

function known(values: readonly (number | null)[]): number[] {
  return values.filter((value): value is number => value !== null);
}

/** §50 : ce qui mérite d'être regardé, pas quinze indicateurs. */
function summaryOf(points: readonly ConditionsPointView[]): string[] {
  const temperatures = known(points.map((point) => point.temperatureC));
  const feels = known(points.map((point) => point.apparentTemperatureC));
  const gusts = known(points.map((point) => point.windGustKmh));
  const rain = known(points.map((point) => point.precipitationProbabilityPct));
  return [
    temperatures.length === 0
      ? null
      : `Température ${degrees(Math.min(...temperatures))} → ${degrees(Math.max(...temperatures))}`,
    feels.length === 0 ? null : `Ressenti le plus bas ${degrees(Math.min(...feels))}`,
    gusts.length === 0 ? null : `Rafales jusqu’à ${integer.format(Math.max(...gusts))} km/h`,
    // Une probabilité, pas une intensité (§58) ; dite seulement si elle existe.
    rain.length === 0 || Math.max(...rain) === 0
      ? null
      : `Probabilité de pluie jusqu’à ${integer.format(Math.max(...rain))} %`,
  ].filter((line): line is string => line !== null);
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
        body: 'PLUKA projette la prévision sur tes heures de passage à partir de J-14. Plus tôt, une prévision ne dirait rien d’utile sur ta course.',
        action: null,
      };
    case 'no_plan':
      return {
        kind: 'unavailable',
        title: 'Crée ton Plan pour voir les conditions selon tes heures de passage',
        body: 'Les conditions se lisent là où tu seras, au moment où tu devrais y passer : il leur faut ton Plan.',
        action: { label: 'Créer mon Plan', href: planHref },
      };
    case 'missing_time':
    case 'missing_date':
      return {
        kind: 'unavailable',
        title: 'Il manque l’heure de départ de ton Plan',
        body: 'Sans heure de départ, PLUKA ne sait pas quand tu passeras à chaque point.',
        action: { label: 'Voir mon Plan', href: planHref },
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
        title: 'Les conditions sur tes heures de passage font partie du Race Pass',
        body: 'Les alertes et consignes de l’organisation restent visibles pour tous, dans l’onglet Course.',
        action: { label: 'Voir le Race Pass', href: `/offre?course=${participantRaceId}` },
      };
    case 'eligible':
      break;
  }

  if (view.forecast === null) return { kind: 'waiting', failed: view.lastFailureAt !== null };

  const timeZone = view.timezone;
  const forecast = view.forecast;
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
    freshness: `Prévision météo externe · Selon ton Plan actuel · Mise à jour : ${day(forecast.fetchedAt, timeZone)} à ${formatClock(forecast.fetchedAt, timeZone)}`,
    notices,
    summary: summaryOf(forecast.points),
    nights: forecast.nights.map((night) => {
      const from = night.fromStart
        ? 'dès le départ'
        : `${day(night.startDatetime, timeZone)} ${formatClock(night.startDatetime, timeZone)}`;
      const to = night.untilFinish
        ? 'jusqu’à l’arrivée'
        : `${day(night.endDatetime, timeZone)} ${formatClock(night.endDatetime, timeZone)}`;
      return `Nuit : ${from} → ${to}`;
    }),
    points: forecast.points.map((point) => pointLine(point, timeZone)),
  };
}
