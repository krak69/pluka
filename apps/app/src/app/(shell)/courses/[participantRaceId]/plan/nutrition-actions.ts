'use server';

import {
  disableNutrition,
  DomainError,
  EntitlementError,
  saveNutritionSettings,
} from '@pluka/domain';
import { revalidatePath } from 'next/cache';

import type { ActionState } from '@/app/actions';
import { nutritionContext } from '@/lib/nutrition';
import { requireSession } from '@/lib/session';

/**
 * Nutrition sur la page Plan — prototype `activateNut`, `nutStepConfig`.
 * Le client n'envoie que des nombres et des choix ; le droit (Race Pass), la
 * propriété et le Plan actif se décident dans le domaine et la base (0102, 0103).
 */

function number(form: FormData, name: string): number {
  const raw = String(form.get(name) ?? '')
    .trim()
    .replace(',', '.');
  return raw === '' ? Number.NaN : Number(raw);
}

function pathOf(participantRaceId: string): string {
  return `/courses/${participantRaceId}/plan`;
}

export async function saveNutritionAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const participantRaceId = String(form.get('participantRaceId') ?? '');
  const session = await requireSession(pathOf(participantRaceId));
  const caffeine = String(form.get('caffeineTotalMg') ?? '').trim();
  const mode = String(form.get('placementMode') ?? 'smart');

  try {
    await saveNutritionSettings(nutritionContext(session), {
      participantRaceId,
      carbsGPerHour: number(form, 'carbsGPerHour'),
      hydrationMlPerHour: Math.round(number(form, 'hydrationMlPerHour')),
      sodiumMgPerHour: Math.round(number(form, 'sodiumMgPerHour')),
      caffeineTotalMg: caffeine === '' ? null : Math.round(number(form, 'caffeineTotalMg')),
      waterSharePercent: number(form, 'waterSharePercent'),
      density: String(form.get('density') ?? 'auto'),
      aidBuffer: form.get('aidBuffer') === 'on',
      placementMode: mode,
      intervalMinutes: mode === 'interval' ? Math.round(number(form, 'intervalMinutes')) : null,
    });
  } catch (error) {
    if (error instanceof EntitlementError) {
      return {
        error: 'Ta stratégie Nutrition fait partie de la préparation complète, avec le Race Pass.',
      };
    }
    if (error instanceof DomainError && error.code === 'validation') {
      return { error: 'Vérifie tes objectifs : des nombres positifs, sans unité.' };
    }
    if (error instanceof DomainError && error.code === 'invalid_state') {
      return { error: 'Construis d’abord ton Plan : la Nutrition se cale sur lui.' };
    }
    console.error('nutrition : réglage refusé', {
      code: error instanceof DomainError ? error.code : 'inconnu',
    });
    return { error: 'Tes objectifs n’ont pas pu être enregistrés. Réessaie dans un instant.' };
  }

  revalidatePath(pathOf(participantRaceId));
  return {};
}

export async function disableNutritionAction(form: FormData): Promise<void> {
  const participantRaceId = String(form.get('participantRaceId') ?? '');
  const session = await requireSession(pathOf(participantRaceId));
  await disableNutrition(nutritionContext(session), { participantRaceId }).catch(
    (error: unknown) => {
      console.error('nutrition : désactivation refusée', {
        code: error instanceof DomainError ? error.code : 'inconnu',
      });
    },
  );
  revalidatePath(pathOf(participantRaceId));
}
