'use server';

import {
  changePlanTarget,
  lockPlanWaypoint,
  resetPlanScope,
  unlockPlanWaypoint,
  updateTrailProfile,
} from '@pluka/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { ActionState } from '@/app/actions';
import { planErrorMessage, requirePlanContext } from '@/lib/plan';
import { requireProfileContext } from '@/lib/profile';

/**
 * Écritures du Profil trailer, de l'objectif et des verrous du Plan.
 *
 * Elles vivent hors de `actions.ts` parce qu'elles touchent trois domaines :
 * les mélanger au fichier historique, dont l'en-tête ne parle que du Plan,
 * aurait rendu ce commentaire faux.
 *
 * Le contrat est le même partout : le domaine tranche, et le refus revient dans
 * l'état de l'action, à côté du formulaire. PLAN_ENGINE §45 refuse « le bouton
 * masqué côté UI seulement » — le coureur lit pourquoi, il ne devine pas.
 */

/** Champ texte non vide, ou `undefined`. */
function text(form: FormData, field: string): string | undefined {
  const value = form.get(field);
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Nombre, ou `null` quand le champ est vide.
 *
 * `null` est une valeur légitime : §7.2 veut qu'on puisse reprendre un profil
 * partiel, donc vider une réponse déjà donnée. `undefined` signale une saisie
 * illisible, que l'appelant refuse.
 */
function optionalNumber(form: FormData, field: string): number | null | undefined {
  const value = text(form, field);
  if (value === undefined) return null;

  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Durée en `HH:MM`, convertie en secondes. */
function durationFromClock(form: FormData, field: string): number | null | undefined {
  const value = text(form, field);
  if (value === undefined) return null;

  const match = /^(\d{1,3}):([0-5]\d)$/.exec(value);
  if (match === null) return undefined;

  return Number(match[1]) * 3600 + Number(match[2]) * 60;
}

/** Valeur d'énumération, ou `null` quand rien n'est choisi. */
function choice<TValue extends string>(
  form: FormData,
  field: string,
  allowed: readonly TValue[],
): TValue | null {
  const value = text(form, field);
  if (value === undefined) return null;

  return allowed.includes(value as TValue) ? (value as TValue) : null;
}

const COMFORT = ['low', 'medium', 'high'] as const;
const EXPERIENCE = ['none', 'up_to_30k', '30_60k', '60_100k', '100k_plus'] as const;

/**
 * Effort de référence — 00_PRODUCT_SPEC §8.1.
 *
 * « À défaut, repère d'allure trail » : les deux voies sont acceptées côte à
 * côte, et c'est le domaine qui décide si le profil porte un signal
 * exploitable. L'écran n'exige rien.
 */
export async function saveEffortAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const distance = optionalNumber(form, 'representativeDistanceKm');
  const elevation = optionalNumber(form, 'representativeElevationGainM');
  const duration = durationFromClock(form, 'representativeDurationSeconds');
  const pace = durationFromClock(form, 'fallbackTrailPaceSecondsPerKm');

  if (distance === undefined || elevation === undefined) {
    return { error: 'Distance et dénivelé doivent être des nombres.' };
  }

  if (duration === undefined) return { error: 'La durée s’écrit en HH:MM.' };
  if (pace === undefined) return { error: 'L’allure s’écrit en MM:SS par kilomètre.' };

  try {
    await updateTrailProfile(await requireProfileContext('/profil'), {
      representativeEffortLabel: text(form, 'representativeEffortLabel') ?? null,
      representativeEffortDate: text(form, 'representativeEffortDate') ?? null,
      representativeDistanceKm: distance,
      representativeElevationGainM: elevation,
      representativeDurationSeconds: duration,
      fallbackTrailPaceSecondsPerKm: pace,
    });
  } catch (error) {
    return { error: planErrorMessage(error) };
  }

  revalidatePath('/profil');
  return {};
}

/** Volume, terrain et expérience — 00_PRODUCT_SPEC §8.1, second écran. */
export async function saveTrainingAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const weekly = optionalNumber(form, 'weeklyDistanceKm');
  const weeklyElevation = optionalNumber(form, 'weeklyElevationGainM');

  if (weekly === undefined || weeklyElevation === undefined) {
    return { error: 'Volume et dénivelé hebdomadaires doivent être des nombres.' };
  }

  try {
    await updateTrailProfile(await requireProfileContext('/profil'), {
      weeklyDistanceKm: weekly,
      weeklyElevationGainM: weeklyElevation,
      climbComfort: choice(form, 'climbComfort', COMFORT),
      descentComfort: choice(form, 'descentComfort', COMFORT),
      longDistanceExperience: choice(form, 'longDistanceExperience', EXPERIENCE),
    });
  } catch (error) {
    return { error: planErrorMessage(error) };
  }

  revalidatePath('/profil');
  return {};
}

/**
 * Objectif de course — 00_PRODUCT_SPEC §9.1.
 *
 * « Le coureur choisit l'objectif qu'il veut préparer, en HH:MM. L'objectif
 * reste la décision du coureur. » Rien ici ne le propose, ne l'ajuste ni ne le
 * borne selon un profil.
 *
 * `changePlanTarget` porte l'objectif et le recalcul ensemble : un Plan doit
 * finir sur la valeur visée, et écrire l'objectif sans recalculer laisserait un
 * Plan qui contredit son propre objectif.
 */
export async function setObjectiveAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const participantRaceId = text(form, 'participantRaceId') ?? '';
  const target = durationFromClock(form, 'target');

  if (target === undefined || target === null) {
    return { error: 'L’objectif s’écrit en HH:MM, arrêts compris.' };
  }

  try {
    const outcome = await changePlanTarget(await requirePlanContext('/'), {
      participantRaceId,
      targetDurationSeconds: target,
    });

    if (outcome.result.conflicts.length > 0) {
      return { error: outcome.result.conflicts.map((issue) => issue.message).join(' · ') };
    }
  } catch (error) {
    return { error: planErrorMessage(error) };
  }

  redirect(`/courses/${participantRaceId}/plan`);
}

/**
 * Verrou d'un passage — PLAN_ENGINE §26.
 *
 * Un horaire verrouillé n'est plus recalculé : c'est une contrainte que le
 * coureur pose, et le moteur répartit autour. Le verrou s'exprime en temps
 * écoulé depuis le départ, comme le reste du Plan — une heure d'horloge
 * dépendrait du fuseau et de l'heure de départ réelle.
 *
 * Un champ vide déverrouille. C'est le même geste à l'écran, donc la même
 * action, et les deux use cases restent distincts derrière.
 *
 * `preserve_manual_changes` : poser un verrou ne doit pas redistribuer tout le
 * reste. §22.1 en fait un choix explicite, et c'est celui qui correspond à
 * l'intention — « je sais que je passerai là à cette heure ».
 */
export async function lockWaypointAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const participantRaceId = text(form, 'participantRaceId') ?? '';
  const raceWaypointId = text(form, 'raceWaypointId') ?? '';
  const elapsed = durationFromClock(form, 'elapsed');

  if (elapsed === undefined) {
    return { error: 'Le passage s’écrit en HH:MM depuis le départ.' };
  }

  try {
    const context = await requirePlanContext('/');

    const outcome =
      elapsed === null
        ? await unlockPlanWaypoint(context, {
            participantRaceId,
            raceWaypointId,
            mode: 'preserve_manual_changes',
          })
        : await lockPlanWaypoint(context, {
            participantRaceId,
            raceWaypointId,
            arrivalElapsedSeconds: elapsed,
            mode: 'preserve_manual_changes',
          });

    if (outcome.result.conflicts.length > 0) {
      return { error: outcome.result.conflicts.map((issue) => issue.message).join(' · ') };
    }
  } catch (error) {
    return { error: planErrorMessage(error) };
  }

  revalidatePath(`/courses/${participantRaceId}/plan`);
  return {};
}

/**
 * Remise à zéro de tous les ajustements — PLAN_ENGINE §28.
 *
 * `scope: { kind: 'all' }` efface arrêts, surcharges de segment et verrous.
 * `rebalance_to_target` ensuite, parce qu'un Plan sans aucune contrainte doit
 * repartir de l'objectif : le conserver tel quel laisserait les horaires des
 * contraintes qu'on vient de retirer.
 */
export async function resetPlanAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const participantRaceId = text(form, 'participantRaceId') ?? '';

  try {
    const outcome = await resetPlanScope(await requirePlanContext('/'), {
      participantRaceId,
      scope: { kind: 'all' },
      mode: 'rebalance_to_target',
    });

    if (outcome.result.conflicts.length > 0) {
      return { error: outcome.result.conflicts.map((issue) => issue.message).join(' · ') };
    }
  } catch (error) {
    return { error: planErrorMessage(error) };
  }

  revalidatePath(`/courses/${participantRaceId}/plan`);
  return {};
}
