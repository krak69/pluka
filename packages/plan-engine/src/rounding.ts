/**
 * Arrondi déterministe — docs/engines/PLAN_ENGINE.md §16.
 *
 * « Les données persistées utilisent des secondes entières. Afin d'éviter des
 * dérives de quelques secondes, des différences selon runtime, un finish
 * différent de l'objectif, l'arrondi V1 doit être déterministe. »
 *
 * Méthode de référence (§16.1) :
 *
 * 1. durées exactes en flottants ;
 * 2. agrégées au niveau des segments persistés ;
 * 3. `floor` de chaque durée flexible ;
 * 4. reste à distribuer pour atteindre exactement le budget ;
 * 5. distribution par plus grand reste fractionnaire ;
 * 6. égalité départagée par `sortOrder` croissant.
 *
 * L'étape 6 est ce qui rend la méthode reproductible : sans elle, deux
 * fractions identiques seraient départagées par l'ordre de parcours d'une
 * structure, et §35 interdit exactement cela.
 */

export interface RoundingItem {
  readonly key: string;
  readonly sortOrder: number;
  readonly exactSeconds: number;
}

export interface RoundedItem {
  readonly key: string;
  readonly sortOrder: number;
  readonly seconds: number;
}

/**
 * Répartit `budgetSeconds` entiers sur des durées exactes.
 *
 * La somme des durées rendues vaut exactement `budgetSeconds` — c'est
 * l'invariant de §55.4, et ce qui garantit qu'un intervalle ancré tombe juste
 * à la seconde.
 */
export function distributeSeconds(
  items: readonly RoundingItem[],
  budgetSeconds: number,
): readonly RoundedItem[] {
  if (items.length === 0) return [];

  const ordered = [...items].sort((left, right) => left.sortOrder - right.sortOrder);

  const floors = ordered.map((item) => {
    // Une durée exacte peut être très légèrement négative par accumulation de
    // flottants ; le plancher à zéro évite une durée négative, que §55.3
    // interdit.
    const exact = item.exactSeconds > 0 ? item.exactSeconds : 0;
    const floor = Math.floor(exact);

    return { item, floor, remainder: exact - floor };
  });

  const floorTotal = floors.reduce((sum, entry) => sum + entry.floor, 0);
  let remaining = budgetSeconds - floorTotal;

  const extra = new Map<string, number>();

  if (remaining > 0) {
    // Plus grand reste fractionnaire d'abord ; à égalité, `sortOrder`
    // croissant (§16.1, étapes 5 et 6).
    const byRemainder = [...floors].sort((left, right) => {
      if (right.remainder !== left.remainder) return right.remainder - left.remainder;

      return left.item.sortOrder - right.item.sortOrder;
    });

    let index = 0;
    while (remaining > 0) {
      const entry = byRemainder[index % byRemainder.length] as (typeof byRemainder)[number];
      extra.set(entry.item.key, (extra.get(entry.item.key) ?? 0) + 1);
      remaining -= 1;
      index += 1;
    }
  }

  const rounded = floors.map((entry) => ({
    key: entry.item.key,
    sortOrder: entry.item.sortOrder,
    seconds: entry.floor + (extra.get(entry.item.key) ?? 0),
  }));

  // Budget inférieur à la somme des planchers : on retire la seconde en trop
  // aux plus petits restes, en commençant par la fin du parcours, et sans
  // jamais descendre sous une seconde — §55.3, « duration[i] > 0 ».
  if (remaining < 0) return removeSeconds(rounded, -remaining);

  return rounded;
}

function removeSeconds(items: readonly RoundedItem[], toRemove: number): readonly RoundedItem[] {
  const seconds = new Map(items.map((item) => [item.key, item.seconds]));
  const order = [...items].sort((left, right) => right.sortOrder - left.sortOrder);

  let remaining = toRemove;
  let index = 0;
  let guard = 0;
  const maxPasses = order.length * toRemove + order.length;

  while (remaining > 0 && guard <= maxPasses) {
    const entry = order[index % order.length] as RoundedItem;
    const current = seconds.get(entry.key) ?? 0;

    if (current > 1) {
      seconds.set(entry.key, current - 1);
      remaining -= 1;
    }

    index += 1;
    guard += 1;
  }

  return items.map((item) => ({ ...item, seconds: seconds.get(item.key) ?? item.seconds }));
}
