'use server';

import {
  changePlanTarget,
  generateRacePlan,
  preserveCurrentPlan,
  rebalancePlanToTarget,
  removePlanSegmentOverride,
  updatePlanSegmentDuration,
  updatePlanStop,
  type PlanContext,
} from '@pluka/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { publicEnv } from '@/lib/env';
import { planErrorMessage, requirePlanContext } from '@/lib/plan';
import { safeReturnTo } from '@/lib/return-to';
import { createAuthClient } from '@/lib/supabase/auth';

/**
 * Entrée d'un formulaire : non fiable, donc validée à la frontière
 * (01_ARCHITECTURE §32).
 */
const signInSchema = z.object({
  email: z.email({ error: 'Adresse email invalide' }),
  returnTo: z.string().optional(),
});

/**
 * Demande de lien de connexion (magic link / OTP email).
 *
 * V1 ne rend pas le mot de passe obligatoire (01_ARCHITECTURE §10.1).
 *
 * Le message rendu à l'utilisateur est le même que l'adresse existe ou non :
 * répondre « ce compte n'existe pas » transformerait le formulaire en oracle
 * d'inscription, et dirait qui court chez PLUKA.
 */
export async function requestSignInLink(formData: FormData): Promise<void> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    returnTo: formData.get('returnTo') ?? undefined,
  });

  if (!parsed.success) {
    redirect('/connexion?etat=email-invalide');
  }

  const returnTo = safeReturnTo(parsed.data.returnTo);
  const auth = await createAuthClient();

  const { error } = await auth.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: `${publicEnv().NEXT_PUBLIC_APP_URL}/auth/callback?returnTo=${encodeURIComponent(returnTo)}`,
    },
  });

  if (error !== null) {
    // Le détail provider reste dans les logs serveur, pas dans l'URL : une
    // URL finit dans un historique et un log d'accès (03_PRIVACY_RLS §130).
    console.error('auth.signInWithOtp a échoué', { code: error.code, status: error.status });
    redirect('/connexion?etat=envoi-impossible');
  }

  redirect(`/connexion?etat=lien-envoye&returnTo=${encodeURIComponent(returnTo)}`);
}

/** Champ texte d'un formulaire : `FormData` rend `File | string | null`. */
function text(form: FormData, field: string): string | undefined {
  const value = form.get(field);
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export interface ActionState {
  readonly error?: string;
}

export async function signOut(): Promise<void> {
  const auth = await createAuthClient();
  await auth.auth.signOut();

  redirect('/connexion?etat=deconnecte');
}

/**
 * Mutations du Plan — docs/engines/PLAN_ENGINE.md §63.
 *
 * Toutes passent par un use case de `@pluka/domain`. Aucune ne construit de
 * requête, aucune ne calcule une durée : l'application transmet une intention
 * et un acteur, le domaine autorise, le moteur calcule, la base range.
 *
 * §22 donne deux comportements après une modification, et ils sont ici deux
 * actions distinctes — `rebalancePlanAction` et `preservePlanAction` — parce
 * que ce sont deux décisions du coureur, pas deux valeurs d'un même paramètre.
 * Les libellés suivent §65 : « Rééquilibrer », « Conserver ce Plan ».
 *
 * Un refus commercial revient dans l'état de l'action, à côté du formulaire.
 * §45 : « la sécurité ne doit jamais être un bouton masqué côté UI seulement »
 * — le bouton existe, le domaine tranche, et le coureur lit pourquoi.
 */

function planFormContext(): Promise<PlanContext> {
  return requirePlanContext('/').then((context) => context);
}

/** Champ numérique d'un formulaire, en secondes. */
function seconds(form: FormData, field: string): number | undefined {
  const value = text(form, field);
  if (value === undefined) return undefined;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : undefined;
}

/** Durée saisie en `HH:MM`, convertie en secondes. */
function durationFromClock(form: FormData, field: string): number | undefined {
  const value = text(form, field);
  if (value === undefined) return undefined;

  const match = /^(\d{1,3}):([0-5]\d)$/.exec(value);
  if (match === null) return undefined;

  return Number(match[1]) * 3600 + Number(match[2]) * 60;
}

async function runPlanCommand(
  participantRaceId: string,
  command: (context: PlanContext) => Promise<{
    readonly result: { readonly conflicts: readonly { readonly message: string }[] };
  }>,
): Promise<ActionState> {
  try {
    const outcome = await command(await planFormContext());

    // §24 : un conflit n'est pas résolu en silence. Il remonte à l'écran avec
    // la contrainte qu'il nomme, et l'utilisateur décide.
    if (outcome.result.conflicts.length > 0) {
      return { error: outcome.result.conflicts.map((issue) => issue.message).join(' · ') };
    }
  } catch (error) {
    return { error: planErrorMessage(error) };
  }

  revalidatePath(`/courses/${participantRaceId}/plan`);
  return {};
}

export async function generatePlanAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const participantRaceId = text(form, 'participantRaceId') ?? '';

  return runPlanCommand(participantRaceId, (context) =>
    generateRacePlan(context, {
      participantRaceId,
      targetDurationSeconds: durationFromClock(form, 'target') ?? 0,
    }),
  );
}

/** §21.1 — « l'utilisateur définit une nouvelle durée cible ». */
export async function changePlanTargetAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const participantRaceId = text(form, 'participantRaceId') ?? '';

  return runPlanCommand(participantRaceId, (context) =>
    changePlanTarget(context, {
      participantRaceId,
      targetDurationSeconds: durationFromClock(form, 'target') ?? 0,
    }),
  );
}

/**
 * §21.2 — durée imposée d'une section.
 *
 * Le mode est `preserve_manual_changes` : la modification est prise telle
 * quelle, et l'arrivée bouge. §27 admet exactement cet état — « le Plan peut
 * donc avoir target_duration_seconds = 13h30 et planned_finish = 13h42 tant
 * que l'utilisateur n'a pas demandé un rééquilibrage ». Rééquilibrer sur-le-
 * champ effacerait la décision de §22 avant que le coureur l'ait prise.
 */
export async function updateSegmentDurationAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const participantRaceId = text(form, 'participantRaceId') ?? '';

  return runPlanCommand(participantRaceId, (context) =>
    updatePlanSegmentDuration(context, {
      participantRaceId,
      raceSegmentId: text(form, 'raceSegmentId') ?? '',
      durationSeconds: durationFromClock(form, 'duration') ?? 0,
      mode: 'preserve_manual_changes',
    }),
  );
}

export async function removeSegmentOverrideAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const participantRaceId = text(form, 'participantRaceId') ?? '';

  return runPlanCommand(participantRaceId, (context) =>
    removePlanSegmentOverride(context, {
      participantRaceId,
      raceSegmentId: text(form, 'raceSegmentId') ?? '',
      mode: 'preserve_manual_changes',
    }),
  );
}

/** §21.3 — « la nouvelle durée devient fixe jusqu'à modification ultérieure ». */
export async function updateStopAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const participantRaceId = text(form, 'participantRaceId') ?? '';

  return runPlanCommand(participantRaceId, (context) =>
    updatePlanStop(context, {
      participantRaceId,
      raceWaypointId: text(form, 'raceWaypointId') ?? '',
      durationSeconds: (seconds(form, 'minutes') ?? 0) * 60,
      mode: 'preserve_manual_changes',
    }),
  );
}

/** §22.2 — « Rééquilibrer pour finir en HH:MM ». */
export async function rebalancePlanAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const participantRaceId = text(form, 'participantRaceId') ?? '';

  return runPlanCommand(participantRaceId, (context) =>
    rebalancePlanToTarget(context, { participantRaceId }),
  );
}

/** §22.1 — « Conserver ce Plan ». */
export async function preservePlanAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const participantRaceId = text(form, 'participantRaceId') ?? '';

  return runPlanCommand(participantRaceId, (context) =>
    preserveCurrentPlan(context, { participantRaceId }),
  );
}
