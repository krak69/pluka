'use server';

import { requestRaceConditionsRefresh, type ConditionsRefreshOutcome } from '@pluka/domain';

import { conditionsContext, conditionsEnabled } from '@/lib/conditions';
import { requireSession } from '@/lib/session';

/**
 * Demande une prévision fraîche pour les Conditions du coureur —
 * WEATHER_CONDITIONS §31 ; 0113.
 *
 * Appelée par l'écran quand la prévision manque ou a vieilli : le domaine
 * revérifie la fenêtre J-14, les droits et la fraîcheur, et ne demande rien
 * d'inutile. Le fournisseur n'est appelé que par le worker.
 */
export async function requestConditionsRefreshAction(
  participantRaceId: string,
): Promise<ConditionsRefreshOutcome | { readonly result: 'disabled' }> {
  // Flag coupé : la fonctionnalité n'existe pas dans cette release, ce n'est pas une question de droits.
  if (!conditionsEnabled()) return { result: 'disabled' };
  const session = await requireSession(`/courses/${participantRaceId}/plan/conditions`);
  return requestRaceConditionsRefresh(conditionsContext(session), { participantRaceId });
}
