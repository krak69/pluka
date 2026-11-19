import type {
  AssistanceAssignmentRecord,
  AssistantRecord,
  BagRecord,
  SupplyChoice,
} from '@pluka/db';
import type {
  NutritionResult,
  PreparationDestination,
  PreparationPlan,
  PreparationUnit,
} from '@pluka/nutrition-engine';

/**
 * D'où vient ce qui sert après chaque ravitaillement — NUTRITION_ENGINE §53 à
 * §56 ; décisions du 2026-11-19.
 *
 * Sans choix du coureur, c'est automatique : l'Assistance s'il a un
 * rendez-vous à ce point, le drop bag s'il en a créé un dans Sacs, sinon il
 * le porte depuis le départ. Il peut choisir point par point. Si ce qu'il a
 * choisi n'existe plus (sac supprimé, rendez-vous retiré), ses produits
 * restent comptés, « sans place » (§56) : jamais réaffectés en silence.
 */

export interface SupplyPointView {
  readonly pointId: string;
  readonly name: string;
  readonly distanceKm: number;
  readonly elapsedSeconds: number;
  /** Toujours le départ ; le drop bag ou l'Assistance quand ils existent à ce point. */
  readonly options: readonly SupplyChoice[];
  readonly auto: SupplyChoice;
  /** Le choix du coureur ; nul quand il suit l'automatique. */
  readonly chosen: SupplyChoice | null;
  /** Ce qui s'applique ; `unassigned` quand le choix n'existe plus. */
  readonly source: PreparationDestination;
  /** Les prénoms de ceux qui l'attendent à ce point. */
  readonly assistants: readonly string[];
  readonly bagName: string | null;
}

export interface NutritionPreparationView {
  readonly plan: PreparationPlan;
  readonly points: readonly SupplyPointView[];
  /** Les listes à envoyer, envoyées ou périmées chez les accompagnants (0109). */
  readonly sends: readonly NutritionSendView[];
}

export interface SupplyFacts {
  readonly choices: Readonly<Record<string, SupplyChoice>>;
  readonly bags: readonly BagRecord[];
  readonly assistants: readonly AssistantRecord[];
  readonly assignments: readonly AssistanceAssignmentRecord[];
}

export function supplyPoints(result: NutritionResult, facts: SupplyFacts): SupplyPointView[] {
  const names = new Map(facts.assistants.map((person) => [person.id, person.firstName]));
  return result.milestones.flatMap((milestone) => {
    const pointId = milestone.pointId;
    if (milestone.kind !== 'aid' || pointId === null) return [];
    const bag = facts.bags.find(
      (entry) => entry.bagType === 'drop_bag' && entry.raceWaypointId === pointId,
    );
    const assistants = facts.assignments
      .filter((assignment) => assignment.raceWaypointId === pointId)
      .flatMap((assignment) => {
        const name = names.get(assignment.assistantId);
        return name === undefined ? [] : [name];
      });
    const options: SupplyChoice[] = [
      'start',
      ...(bag === undefined ? [] : (['bag'] as const)),
      ...(assistants.length === 0 ? [] : (['assistance'] as const)),
    ];
    const auto: SupplyChoice =
      assistants.length > 0 ? 'assistance' : bag !== undefined ? 'bag' : 'start';
    const chosen = facts.choices[pointId] ?? null;
    return [
      {
        pointId,
        name: milestone.name,
        distanceKm: milestone.distanceKm,
        elapsedSeconds: milestone.elapsedSeconds,
        options,
        auto,
        chosen,
        source: chosen === null ? auto : options.includes(chosen) ? chosen : 'unassigned',
        assistants,
        bagName: bag?.name ?? null,
      },
    ];
  });
}

/** Les sources, pour le moteur : un point par ravitaillement. */
export function sourcesOf(
  points: readonly SupplyPointView[],
): Readonly<Record<string, PreparationDestination>> {
  return Object.fromEntries(points.map((point) => [point.pointId, point.source]));
}

/** Un produit de la stratégie, là où il se range : sac ou Assistance. */
export interface SuppliedItem {
  readonly productId: string;
  readonly name: string;
  readonly unit: PreparationUnit;
  readonly quantity: number;
  /** Doses à préparer dans les flasques avant le départ (sac de départ seulement). */
  readonly inFlasks: number;
  /** La part de réserve (sac de départ seulement). */
  readonly reserve: number;
}

/**
 * Ce que la Nutrition range à chaque endroit (§53 à §55) : sur le coureur au
 * départ, dans le drop bag d'un point, chez l'Assistance d'un point. Calculé
 * à la lecture depuis la stratégie : les sacs et « À me donner » l'affichent
 * sans le stocker, et suivent chaque changement de stratégie.
 */
export interface NutritionSupply {
  readonly start: readonly SuppliedItem[];
  /** Par point de la course. */
  readonly bags: Readonly<Record<string, readonly SuppliedItem[]>>;
  readonly assistance: Readonly<Record<string, readonly SuppliedItem[]>>;
}

/** Lire ce que la Nutrition range, depuis un autre domaine : nul sans stratégie. */
export type NutritionSupplyReader = (participantRaceId: string) => Promise<NutritionSupply | null>;

export function supplyOf(preparation: NutritionPreparationView): NutritionSupply {
  const at = (source: PreparationDestination) =>
    Object.fromEntries(
      preparation.plan.points
        .filter((point) => point.kind === 'aid' && point.source === source)
        .map((point) => [
          point.pointId,
          point.items.map((item) => ({ ...item, inFlasks: 0, reserve: 0 })),
        ]),
    );
  return {
    start: preparation.plan.products
      .filter((product) => product.start > 0)
      .map((product) => ({
        productId: product.productId,
        name: product.name,
        unit: product.unit,
        quantity: product.start,
        inFlasks: product.inFlasks,
        reserve: product.reserve,
      })),
    bags: at('bag'),
    assistance: at('assistance'),
  };
}

// ------------------------------------------------------------
// Envoyer à l'accompagnant — §55 (0109)
// ------------------------------------------------------------

const LABEL_MAX = 120;
const number = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

function dosesText(value: number): string {
  if (value === 0.5) return '½ dose';
  return value === 1 ? '1 dose' : `${number.format(value)} doses`;
}

/**
 * Ce que l'accompagnant lit : « 3 × Gel 25 », « 1 dose de Näak ». Des
 * quantités seulement, jamais les objectifs (§55). Le libellé est figé à
 * l'envoi : il se compare ensuite au calcul pour dire si l'envoi est à jour.
 */
export function supplyLabels(items: readonly SuppliedItem[]): string[] {
  return items.map((item) =>
    (item.unit === 'dose'
      ? `${dosesText(item.quantity)} de ${item.name}`
      : `${number.format(item.quantity)} × ${item.name}`
    ).slice(0, LABEL_MAX),
  );
}

/**
 * - `none` : rien à donner, rien d'envoyé ;
 * - `unsent` : la stratégie prévoit des produits, l'accompagnant ne les voit pas ;
 * - `sent` : il voit exactement ce que la stratégie prévoit ;
 * - `stale` : il voit une ancienne liste — la stratégie a changé depuis l'envoi.
 */
export type NutritionSendStatus = 'none' | 'unsent' | 'sent' | 'stale';

export function sendStatus(
  current: readonly string[],
  sent: readonly string[],
): NutritionSendStatus {
  if (sent.length === 0) return current.length === 0 ? 'none' : 'unsent';
  const same =
    current.length === sent.length && current.every((label, index) => label === sent[index]);
  return same ? 'sent' : 'stale';
}

/** Un envoi à un accompagnant, vu depuis la Nutrition. */
export interface NutritionSendView {
  readonly rendezvousId: string;
  readonly assistant: string;
  readonly pointId: string;
  readonly pointName: string;
  readonly status: Exclude<NutritionSendStatus, 'none'>;
  /** Le moment de l'envoi en cours chez l'accompagnant ; nul s'il n'a rien reçu. */
  readonly sentAt: string | null;
  /** La stratégie ne prévoit plus rien à donner ici : renvoyer retire la liste. */
  readonly nothingToGive: boolean;
  /** Ce qu'il faut donner, selon la stratégie maintenant. */
  readonly labels: readonly string[];
}

export interface SentItem {
  readonly assignmentId: string;
  readonly label: string;
  readonly kind: 'nutrition' | 'other';
  readonly createdAt: string;
}

/** Ce qui a été envoyé à un rendez-vous, dans l'ordre, et quand. */
export function sentOf(
  items: readonly SentItem[],
  assignmentId: string,
): { readonly labels: readonly string[]; readonly sentAt: string | null } {
  const sent = items
    .filter((item) => item.assignmentId === assignmentId && item.kind === 'nutrition')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return { labels: sent.map((item) => item.label), sentAt: sent[0]?.createdAt ?? null };
}
