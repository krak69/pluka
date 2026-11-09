'use server';

import { DomainError, estimateRepere, updateTrailProfile, type RepereRefusal } from '@pluka/domain';

import { profileContext } from '@/lib/profile';
import { repereContext, repereEnabled } from '@/lib/repere';
import { requireSession } from '@/lib/session';

/**
 * Repère PLUKA — docs/engines/REPERE_PLUKA.md §1.
 *
 * L'effort saisi rejoint le Profil trailer, puis le domaine calcule la plage
 * et la garde pour le calibrage. Rien n'est écrit dans l'objectif : c'est le
 * coureur qui reprend la plage, ou non. Aucune valeur dans les journaux.
 */

export interface RepereActionState {
  readonly error?: string;
  readonly refusal?: string;
  readonly range?: {
    readonly lowSeconds: number;
    readonly centralSeconds: number;
    readonly highSeconds: number;
    readonly approximate: boolean;
    readonly exceedsCutoff: boolean;
  };
}

const REFUSALS: Readonly<Record<RepereRefusal, string>> = {
  course_elevation_unknown:
    'Le dénivelé de cette course n’est pas encore connu : PLUKA ne peut pas proposer de repère.',
  reference_too_short:
    'Cet effort est trop court pour servir de repère : prends une sortie plus longue.',
  too_far:
    'Cet effort est trop différent de la course visée pour en tirer un repère fiable. Prends une sortie plus proche en distance et en dénivelé.',
  reference_too_old: 'Cet effort date de plus de deux ans : prends une sortie plus récente.',
  implausible_reference:
    'Ces chiffres donnent une allure inhabituelle : vérifie la distance, le D+ et le temps.',
};

function text(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === 'string' ? value.trim() : '';
}

function number(value: string): number | null {
  if (value === '') return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/** `H:MM` ou `HH:MM` → secondes. */
function clock(value: string): number | null {
  const match = /^(\d{1,3}):([0-5]\d)$/u.exec(value);
  return match === null ? null : Number(match[1]) * 3600 + Number(match[2]) * 60;
}

/** `M:SS` par kilomètre → secondes. */
function pace(value: string): number | null {
  const match = /^(\d{1,2}):([0-5]\d)$/u.exec(value);
  return match === null ? null : Number(match[1]) * 60 + Number(match[2]);
}

export async function estimateRepereAction(
  _previous: RepereActionState,
  form: FormData,
): Promise<RepereActionState> {
  if (!repereEnabled()) return { error: 'Le Repère PLUKA n’est pas encore ouvert.' };

  const participantRaceId = text(form, 'participantRaceId');
  const session = await requireSession(`/courses/${participantRaceId}/objectif`);
  const kind = text(form, 'kind') === 'pace' ? 'pace' : 'effort';

  let reference;
  if (kind === 'effort') {
    const distanceKm = number(text(form, 'distance'));
    const elevationGainM = number(text(form, 'elevation'));
    const durationSeconds = clock(text(form, 'duration'));
    const date = text(form, 'date');

    if (distanceKm === null || distanceKm <= 0) return { error: 'Indique la distance, en km.' };
    if (elevationGainM === null || elevationGainM < 0 || !Number.isInteger(elevationGainM)) {
      return { error: 'Indique le D+, en mètres.' };
    }
    if (durationSeconds === null || durationSeconds === 0) {
      return { error: 'Indique le temps au format H:MM, arrêts compris.' };
    }

    reference = {
      kind,
      distanceKm,
      elevationGainM,
      durationSeconds,
      date: date === '' ? null : date,
    } as const;
  } else {
    const secondsPerKm = pace(text(form, 'pace'));
    if (secondsPerKm === null) return { error: 'Indique ton allure au format M:SS par km.' };
    reference = { kind, secondsPerKm } as const;
  }

  try {
    // L'effort rejoint le Profil : la prochaine course le reprend (§1).
    await updateTrailProfile(
      profileContext(session),
      reference.kind === 'effort'
        ? {
            representativeDistanceKm: reference.distanceKm,
            representativeElevationGainM: reference.elevationGainM,
            representativeDurationSeconds: reference.durationSeconds,
            representativeEffortDate: reference.date,
          }
        : { fallbackTrailPaceSecondsPerKm: reference.secondsPerKm },
    );

    const estimate = await estimateRepere(repereContext(session), {
      participantRaceId,
      reference,
    });

    if (!estimate.result.ok) return { refusal: REFUSALS[estimate.result.reason] };

    return {
      range: {
        lowSeconds: estimate.result.lowSeconds,
        centralSeconds: estimate.result.centralSeconds,
        highSeconds: estimate.result.highSeconds,
        approximate: estimate.result.approximate,
        exceedsCutoff: estimate.exceedsCutoff,
      },
    };
  } catch (error) {
    if (error instanceof DomainError && error.code === 'validation') {
      const detail = Object.values(error.details)[0];
      return { error: typeof detail === 'string' ? detail : 'Vérifie les valeurs saisies.' };
    }
    if (error instanceof DomainError) return { error: 'Cette course n’est pas accessible.' };

    console.error('repère : erreur non traduite', {
      name: error instanceof Error ? error.name : 'inconnu',
    });
    return { error: 'Une erreur est survenue. Réessaie dans un instant.' };
  }
}
