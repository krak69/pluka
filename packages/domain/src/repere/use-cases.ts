import { z } from 'zod';

import type { PlanRepositories, RepereRepositories } from '@pluka/db';

import type { Actor } from '../authorization/organization-role.js';
import { parseCommand, validationError } from '../errors.js';
import { loadPlanScope } from '../plan/snapshot.js';

import { computeRepere, REPERE_V0, type RepereReference, type RepereResult } from './engine.js';

/**
 * Repère PLUKA — docs/engines/REPERE_PLUKA.md.
 *
 * Lit la course du coureur, calcule une plage, la garde pour le calibrage
 * (§5), et la rend. N'écrit ni objectif ni Plan (REP-06) : le coureur reprend
 * lui-même la plage s'il le veut. Le flag `repere_pluka` est tenu par
 * l'application (AGENTS §47).
 */

export interface RepereContext {
  readonly repositories: PlanRepositories & RepereRepositories;
  readonly actor: Actor;
  readonly now: () => Date;
}

const civilDate = z.iso.date();

export const estimateRepereCommandSchema = z
  .object({
    participantRaceId: z.string().uuid(),
    reference: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('effort'),
          distanceKm: z.number().positive().max(1000),
          elevationGainM: z.number().int().min(0).max(30000),
          durationSeconds: z
            .number()
            .int()
            .positive()
            .max(14 * 24 * 3600),
          date: civilDate.nullable(),
        })
        .strict(),
      z
        .object({
          kind: z.literal('pace'),
          secondsPerKm: z.number().int().min(60).max(7200),
        })
        .strict(),
    ]),
  })
  .strict();

export interface RepereEstimate {
  readonly result: RepereResult;
  /** Barrière d'arrivée en secondes depuis le départ, si l'épreuve en a une. */
  readonly finishCutoffSeconds: number | null;
  /** Le haut de la plage dépasse la barrière d'arrivée (§3.5). */
  readonly exceedsCutoff: boolean;
}

function civilDay(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(instant);
}

export async function estimateRepere(
  context: RepereContext,
  input: unknown,
): Promise<RepereEstimate> {
  const useCase = 'estimateRepere';
  const command = parseCommand(estimateRepereCommandSchema, input, useCase);
  // La participation doit être celle du coureur : sinon « introuvable » (§120).
  const scope = await loadPlanScope(
    context.repositories,
    context.actor.userId,
    command.participantRaceId,
    useCase,
  );

  const today = civilDay(context.now(), scope.race.timezone);
  const reference: RepereReference = command.reference;

  if (reference.kind === 'effort' && reference.date !== null && reference.date > today) {
    throw validationError(useCase, 'un effort de référence ne peut pas être daté dans le futur', {
      date: 'Cette date est dans le futur.',
    });
  }

  const course = { distanceKm: scope.race.distanceKm, elevationGainM: scope.race.elevationGainM };
  const result = computeRepere({ reference, course, today }, REPERE_V0);

  await context.repositories.repereEstimates.record({
    participantRaceId: command.participantRaceId,
    configVersion: result.configVersion,
    referenceKind: reference.kind,
    input: { reference, course, today },
    outcome: result.ok ? 'range' : result.reason,
    lowSeconds: result.ok ? result.lowSeconds : null,
    centralSeconds: result.ok ? result.centralSeconds : null,
    highSeconds: result.ok ? result.highSeconds : null,
  });

  const finishCutoffSeconds =
    scope.race.cutoffDatetime === null
      ? null
      : Math.round((Date.parse(scope.race.cutoffDatetime) - Date.parse(scope.startAt)) / 1000);

  return {
    result,
    finishCutoffSeconds,
    exceedsCutoff:
      result.ok && finishCutoffSeconds !== null && result.highSeconds > finishCutoffSeconds,
  };
}
