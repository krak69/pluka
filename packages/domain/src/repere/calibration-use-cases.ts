import { z } from 'zod';

import {
  DbError,
  type RepereCalibrationPairRecord,
  type RepereCalibrationRepositories,
} from '@pluka/db';

import type { Actor } from '../authorization/organization-role.js';
import { forbiddenError, parseCommand, validationError } from '../errors.js';

import { calibrateRepere, type CalibrationReport } from './calibration.js';

/**
 * Calibrage du Repère — REPERE_PLUKA §5 · migration 0074.
 *
 * Le coureur donne ses couples ; le rapport, réservé à PLUKA, ne lit que des
 * échantillons anonymes et n'en rend que des agrégats.
 */

export interface RepereCalibrationContext {
  readonly repositories: RepereCalibrationRepositories;
  readonly actor: Actor;
  readonly now: () => Date;
}

const distance = z.number().positive().max(1000);
const elevation = z.number().int().min(0).max(30000);
const duration = z
  .number()
  .int()
  .positive()
  .max(14 * 24 * 3600);

export const addCalibrationPairCommandSchema = z
  .object({
    referenceDistanceKm: distance,
    referenceElevationGainM: elevation,
    referenceDurationSeconds: duration,
    referenceDate: z.iso.date(),
    courseDistanceKm: distance,
    courseElevationGainM: elevation,
    courseDurationSeconds: duration,
    courseDate: z.iso.date(),
  })
  .strict();

function civilToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(now);
}

export async function listMyCalibrationPairs(
  context: RepereCalibrationContext,
): Promise<readonly RepereCalibrationPairRecord[]> {
  return context.repositories.repereCalibration.listOwn(context.actor.userId);
}

export async function addCalibrationPair(
  context: RepereCalibrationContext,
  input: unknown,
): Promise<void> {
  const useCase = 'addCalibrationPair';
  const pair = parseCommand(addCalibrationPairCommandSchema, input, useCase);

  if (pair.referenceDate > pair.courseDate) {
    throw validationError(useCase, 'référence après la course', {
      referenceDate: 'La sortie de référence doit précéder la course.',
    });
  }
  if (pair.courseDate > civilToday(context.now())) {
    throw validationError(useCase, 'course dans le futur', {
      courseDate: 'La course doit être déjà courue.',
    });
  }

  await context.repositories.repereCalibration.add(context.actor.userId, pair);
}

export async function removeCalibrationPair(
  context: RepereCalibrationContext,
  input: unknown,
): Promise<void> {
  const command = parseCommand(
    z.object({ pairId: z.string().uuid() }).strict(),
    input,
    'removeCalibrationPair',
  );
  // La RLS borne la suppression aux couples du coureur.
  await context.repositories.repereCalibration.remove(command.pairId);
}

export interface RepereCalibrationView extends CalibrationReport {
  readonly declared: number;
  readonly estimates: number;
}

export async function getRepereCalibrationReport(
  context: RepereCalibrationContext,
): Promise<RepereCalibrationView> {
  try {
    const samples = await context.repositories.repereCalibration.samples();
    return {
      ...calibrateRepere(samples),
      declared: samples.filter((sample) => sample.source === 'declared').length,
      estimates: samples.filter((sample) => sample.source === 'estimate').length,
    };
  } catch (error) {
    if (error instanceof DbError && error.code === 'permission_denied') {
      throw forbiddenError('getRepereCalibrationReport');
    }
    throw error;
  }
}
