import type { NutritionMilestone } from './contracts.js';

/**
 * Les prises modifiées par le coureur, face au Plan qui a changé —
 * NUTRITION_ENGINE §61, §63, §64, §65 ; N25 à N28 ; décisions du 2026-11-23.
 *
 * Le moteur recalcule les prises sur le nouveau Plan. Une prise que le coureur
 * a modifiée s'y retrouve par sa clé stable (§63, étapes 1 et 2 : la clé d'un
 * ravitaillement est son point officiel). Elle garde ses produits ; si son
 * heure a bougé, le diff le dit (N25) au lieu de la déplacer en silence (N26).
 *
 * Sans clé correspondante — la section compte moins de prises, le point a
 * disparu, la course s'est raccourcie (N28) —, la prise n'a plus de place :
 * ses produits restent, à replacer par le coureur (N27). Pas de rapprochement
 * « par le temps » (§63, étape 4) : son seuil n'est pas défini, il serait
 * inventé.
 */

export interface MilestonePosition {
  readonly elapsedSeconds: number;
  readonly distanceKm: number | null;
}

/** Une prise modifiée, là où elle était quand le coureur l'a validée. */
export interface CustomizedMilestone extends MilestonePosition {
  readonly stableKey: string;
}

export interface KeptCustomization {
  readonly stableKey: string;
  readonly before: MilestonePosition;
  readonly after: MilestonePosition;
  /** L'heure affichée change : au moins une minute d'écart (N25). */
  readonly shifted: boolean;
}

/** NUTRITION_ENGINE §86 : un produit devenu orphelin. */
export type CustomizationWarning = 'PRODUCT_REASSIGNMENT_REQUIRED';

export interface CustomizationReview {
  /** Dans l'ordre de la course, sur le nouveau Plan. */
  readonly kept: readonly KeptCustomization[];
  /** Plus de place sur le nouveau Plan : à replacer, jamais supprimées (N27). */
  readonly orphaned: readonly CustomizedMilestone[];
  readonly warnings: readonly CustomizationWarning[];
}

/** Les heures se lisent à la minute : en deçà, rien ne change pour le coureur. */
const SHIFT_SECONDS = 60;

function byTime(left: MilestonePosition & { stableKey: string }, right: typeof left): number {
  return (
    left.elapsedSeconds - right.elapsedSeconds || left.stableKey.localeCompare(right.stableKey)
  );
}

export function reviewCustomizations(
  customs: readonly CustomizedMilestone[],
  milestones: readonly NutritionMilestone[],
): CustomizationReview {
  // L'arrivée ne porte jamais de produits (§58) : une clé d'arrivée n'accueille rien.
  const byKey = new Map(
    milestones
      .filter((milestone) => milestone.kind !== 'finish')
      .map((milestone) => [milestone.stableKey, milestone]),
  );

  const kept: KeptCustomization[] = [];
  const orphaned: CustomizedMilestone[] = [];
  for (const custom of customs) {
    const match = byKey.get(custom.stableKey);
    if (match === undefined) {
      orphaned.push(custom);
      continue;
    }
    kept.push({
      stableKey: custom.stableKey,
      before: { elapsedSeconds: custom.elapsedSeconds, distanceKm: custom.distanceKm },
      after: { elapsedSeconds: match.elapsedSeconds, distanceKm: match.distanceKm },
      shifted: Math.abs(match.elapsedSeconds - custom.elapsedSeconds) >= SHIFT_SECONDS,
    });
  }

  return {
    kept: kept.sort((left, right) =>
      byTime(
        { ...left.after, stableKey: left.stableKey },
        { ...right.after, stableKey: right.stableKey },
      ),
    ),
    orphaned: orphaned.sort(byTime),
    warnings: orphaned.length > 0 ? ['PRODUCT_REASSIGNMENT_REQUIRED'] : [],
  };
}
