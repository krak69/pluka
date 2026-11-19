import type { AidItemKind, AidNoteRecord, AidStationItemRecord } from '@pluka/db';
import type { NutritionResult } from '@pluka/nutrition-engine';

/**
 * Ce que propose chaque ravitaillement, vu par la Nutrition — §31, §32 ;
 * décisions du 2026-11-19.
 *
 * - Le contenu officiel vient de l'organisation (ou de l'équipe PLUKA,
 *   d'après les sources) ; rien n'est supposé.
 * - Sans contenu annoncé, la note du coureur dit ce qu'il y trouvera :
 *   la sienne, jamais présentée comme officielle.
 * - Une boisson d'effort annoncée (ou notée) permet de la prendre sur place :
 *   ce remplissage ne demande ni dose à préparer ni dose à emporter.
 */

export interface AidPointView {
  readonly pointId: string;
  readonly name: string;
  readonly official: readonly { readonly kind: AidItemKind; readonly label: string }[];
  /** La note du coureur ; elle ne compte que si rien n'est annoncé. */
  readonly note: AidNoteRecord | null;
  /** D'où vient la boisson d'effort disponible ici, s'il y en a une. */
  readonly drink: 'official' | 'note' | null;
  /** Le coureur prend la boisson d'effort du ravito à ce point. */
  readonly usesAidDrink: boolean;
}

export function aidPoints(
  result: NutritionResult,
  items: readonly AidStationItemRecord[],
  notes: readonly AidNoteRecord[],
  aidDrinkWaypointIds: readonly string[],
): AidPointView[] {
  return result.milestones.flatMap((milestone) => {
    const pointId = milestone.pointId;
    if (milestone.kind !== 'aid' || pointId === null) return [];
    const official = items
      .filter((item) => item.waypointId === pointId)
      .map((item) => ({ kind: item.kind, label: item.label }));
    const note = notes.find((entry) => entry.waypointId === pointId) ?? null;
    const drink = official.some((item) => item.kind === 'sports_drink')
      ? ('official' as const)
      : official.length === 0 && note?.kinds.includes('sports_drink') === true
        ? ('note' as const)
        : null;
    return [
      {
        pointId,
        name: milestone.name,
        official,
        note,
        drink,
        usesAidDrink: drink !== null && aidDrinkWaypointIds.includes(pointId),
      },
    ];
  });
}

/**
 * Les points où le moteur remplit la flasque avec la boisson du ravito : ceux
 * que le coureur a choisis, et où une boisson est bien annoncée (ou notée).
 */
export function aidDrinkPointIds(
  items: readonly AidStationItemRecord[],
  notes: readonly AidNoteRecord[],
  chosen: readonly string[],
): string[] {
  return chosen.filter((pointId) => {
    const official = items.filter((item) => item.waypointId === pointId);
    if (official.length > 0) return official.some((item) => item.kind === 'sports_drink');
    return (
      notes.find((entry) => entry.waypointId === pointId)?.kinds.includes('sports_drink') === true
    );
  });
}
