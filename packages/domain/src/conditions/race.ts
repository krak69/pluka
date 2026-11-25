import { z } from 'zod';

import type {
  ConditionsNightRecord,
  ConditionsPointRecord,
  ConditionsRepository,
  EntitlementRepositories,
  RacePlanRepository,
  RaceRepository,
  RaceWaypointRepository,
} from '@pluka/db';
import {
  OPEN_METEO,
  WEATHER_ENGINE_V1,
  refreshDue,
  weatherEligibility,
  type WeatherEligibilityStatus,
  type WeatherHorizon,
} from '@pluka/weather';

import type { Actor } from '../authorization/organization-role.js';
import type { Capability } from '../entitlements/capabilities.js';
import { can } from '../entitlements/resolver.js';
import { resolveEntitlements } from '../entitlements/use-cases.js';
import { notFoundError, parseCommand } from '../errors.js';

/**
 * Conditions d'une course — WEATHER_CONDITIONS §6 à §12, §28 à §35, §52 à §55.
 *
 * Le coureur lit la prévision projetée sur son Plan actif, et demande un
 * rafraîchissement quand elle a vieilli. Pas de prévision avant J-14, ni sans
 * Race Pass ou PLUKA+ (§10) ; une prévision n'est jamais inventée (§54). Le
 * fournisseur n'est appelé que par le worker, qui revérifie tout (0113).
 */

export interface ConditionsContext {
  readonly repositories: EntitlementRepositories & {
    readonly conditions: ConditionsRepository;
    readonly racePlans: Pick<RacePlanRepository, 'findActive'>;
    readonly races: Pick<RaceRepository, 'findById'>;
    readonly waypoints: Pick<RaceWaypointRepository, 'listByRace'>;
  };
  readonly actor: Actor;
  readonly now: () => Date;
  readonly disabledCapabilities?: ReadonlySet<Capability>;
}

export interface ConditionsPointView extends ConditionsPointRecord {
  /** Le nom du point de course ; nul s'il a disparu du parcours depuis. */
  readonly label: string | null;
}

export interface RaceConditionsView {
  /** §6 à §12 : pourquoi la prévision est, ou non, disponible. */
  readonly status: WeatherEligibilityStatus;
  readonly daysToStart: number | null;
  /** Le jour où la fenêtre s'ouvre, dans le fuseau de la course. */
  readonly opensOn: string | null;
  readonly horizon: WeatherHorizon | null;
  readonly timezone: string;
  readonly startAt: string | null;
  /** La prévision qui fait foi pour ce Plan ; nulle sans droit ou hors fenêtre. */
  readonly forecast: {
    readonly fetchedAt: string;
    readonly completeness: 'unknown' | 'complete' | 'partial';
    readonly points: readonly ConditionsPointView[];
    readonly nights: readonly ConditionsNightRecord[];
  } | null;
  /** La dernière mise à jour a échoué depuis la prévision affichée (§90). */
  readonly lastFailureAt: string | null;
  /** La prévision manque ou a vieilli pour l'horizon : un rafraîchissement est utile (§32). */
  readonly refreshDue: boolean;
  /** §53 et licence du fournisseur : la source se cite à côté de la donnée. */
  readonly attribution: typeof OPEN_METEO.attribution;
}

const participation = z.object({ participantRaceId: z.uuid() }).strict();

async function load(context: ConditionsContext, input: unknown, useCase: string) {
  const { participantRaceId } = parseCommand(participation, input, useCase);
  // Vérifie aussi que la course est celle du coureur (04_ENTITLEMENTS §9).
  const entitlements = await resolveEntitlements(
    {
      repositories: context.repositories,
      actor: context.actor,
      now: context.now,
      ...(context.disabledCapabilities === undefined
        ? {}
        : { disabledCapabilities: context.disabledCapabilities }),
    },
    { participantRaceId },
  );
  const record = await context.repositories.participantRaces.findById(participantRaceId);
  if (record === null) throw notFoundError(useCase, 'participation');
  const [race, plan] = await Promise.all([
    context.repositories.races.findById(record.raceId),
    context.repositories.racePlans.findActive(participantRaceId),
  ]);
  const timezone = race?.timezone ?? 'Europe/Paris';
  const now = context.now().toISOString();
  const eligibility = weatherEligibility({
    scope: 'race_plan',
    now,
    timezone,
    // Sans Plan, le départ de la course situe la fenêtre : « crée ton Plan » (§11).
    startAt: plan?.startAt ?? race?.startDatetime ?? null,
    startDate: null,
    hasPlan: plan !== null,
    entitled: can(entitlements, 'conditions.race.read').allowed,
  });
  return { participantRaceId, raceId: record.raceId, timezone, plan, now, eligibility };
}

/** Les Conditions du coureur sur son Plan actif. */
export async function getRaceConditions(
  context: ConditionsContext,
  input: unknown,
): Promise<RaceConditionsView> {
  const { raceId, timezone, plan, now, eligibility } = await load(
    context,
    input,
    'getRaceConditions',
  );
  const base = {
    status: eligibility.status,
    daysToStart: eligibility.daysToStart,
    opensOn: eligibility.opensOn,
    horizon: eligibility.horizon,
    timezone,
    startAt: plan?.startAt ?? null,
    attribution: OPEN_METEO.attribution,
  };
  // W01, W03 : hors fenêtre ou sans droit, rien de personnalisé n'est rendu.
  if (eligibility.status !== 'eligible' || eligibility.horizon === null || plan === null) {
    return { ...base, forecast: null, lastFailureAt: null, refreshDue: false };
  }

  const [active, latest, waypoints] = await Promise.all([
    context.repositories.conditions.activeRun(plan.id),
    context.repositories.conditions.latestRun(plan.id),
    context.repositories.waypoints.listByRace(raceId),
  ]);
  const names = new Map(waypoints.map((waypoint) => [waypoint.id, waypoint.name]));
  const [points, nights] =
    active === null
      ? [[], []]
      : await Promise.all([
          context.repositories.conditions.listPoints(active.id),
          context.repositories.conditions.listNights(active.id),
        ]);

  return {
    ...base,
    forecast:
      active === null
        ? null
        : {
            fetchedAt: active.fetchedAt,
            completeness: active.completeness,
            points: points.map((point) => ({
              ...point,
              label:
                point.raceWaypointId === null ? null : (names.get(point.raceWaypointId) ?? null),
            })),
            nights,
          },
    lastFailureAt:
      latest !== null &&
      latest.status === 'failed' &&
      (active === null || Date.parse(latest.fetchedAt) > Date.parse(active.fetchedAt))
        ? latest.fetchedAt
        : null,
    refreshDue: refreshDue(active?.fetchedAt ?? null, now, eligibility.horizon, WEATHER_ENGINE_V1),
  };
}

export type ConditionsRefreshOutcome =
  /** La demande part au worker, ou attendait déjà. */
  | { readonly result: 'queued' | 'already_queued' }
  /** La prévision est encore fraîche pour l'horizon : rien n'est demandé (§31). */
  | { readonly result: 'fresh' }
  /** Hors fenêtre, sans droit, sans Plan : rien n'est demandé. */
  | { readonly result: 'unavailable'; readonly status: WeatherEligibilityStatus };

/**
 * Demande une prévision fraîche, seulement quand elle manque ou a vieilli :
 * jamais à chaque affichage (§31, §92).
 */
export async function requestRaceConditionsRefresh(
  context: ConditionsContext,
  input: unknown,
): Promise<ConditionsRefreshOutcome> {
  const { participantRaceId, plan, now, eligibility } = await load(
    context,
    input,
    'requestRaceConditionsRefresh',
  );
  if (eligibility.status !== 'eligible' || eligibility.horizon === null || plan === null) {
    return { result: 'unavailable', status: eligibility.status };
  }
  const active = await context.repositories.conditions.activeRun(plan.id);
  if (!refreshDue(active?.fetchedAt ?? null, now, eligibility.horizon, WEATHER_ENGINE_V1)) {
    return { result: 'fresh' };
  }
  return { result: await context.repositories.conditions.requestRefresh(participantRaceId) };
}
