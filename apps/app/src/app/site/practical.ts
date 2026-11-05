import type { PublishedRaceFactRecord } from '@pluka/db';
import {
  SITE_MOMENTS,
  SITE_MOMENT_LABELS,
  SITE_PRACTICAL_TOPICS,
  type PublicEventSite,
  type SiteMoment,
} from '@pluka/domain';

/**
 * Les infos pratiques d'un site, par moment puis par rubrique — EVENT_SITE §3.3.
 *
 * Une rubrique réunit les faits publiés de son sujet et le texte de
 * l'organisation. Les horaires de départ n'y figurent pas : ils sont sur chaque
 * épreuve. Une rubrique sans fait ni texte n'existe pas pour le visiteur.
 */

export interface PracticalRaceFacts {
  readonly raceName: string;
  readonly facts: readonly PublishedRaceFactRecord[];
}

export interface PracticalItem {
  readonly value: string;
  /** Vide quand l'information vaut pour toutes les épreuves. */
  readonly races: readonly string[];
}

export interface PracticalRubric {
  readonly key: string;
  readonly title: string;
  readonly items: readonly PracticalItem[];
  readonly body: string | null;
}

export interface PracticalMoment {
  readonly moment: SiteMoment;
  readonly title: string;
  readonly rubrics: readonly PracticalRubric[];
}

function factValue(fact: PublishedRaceFactRecord): string | null {
  if (fact.valueText !== null && fact.valueText.trim() !== '') return fact.valueText;
  if (fact.valueNumber !== null) {
    return `${String(fact.valueNumber)}${fact.unit === null ? '' : ` ${fact.unit}`}`;
  }
  return null;
}

/**
 * Une même information, commune à plusieurs épreuves, ne s'affiche qu'une fois,
 * avec les épreuves qu'elle concerne quand elle ne les concerne pas toutes.
 */
function itemsOf(
  category: PublishedRaceFactRecord['category'],
  races: readonly PracticalRaceFacts[],
): readonly PracticalItem[] {
  const raceNamesByValue = new Map<string, string[]>();

  for (const { raceName, facts } of races) {
    for (const fact of facts) {
      if (fact.category !== category) continue;
      const value = factValue(fact);
      if (value === null) continue;

      const raceNames = raceNamesByValue.get(value) ?? [];
      if (!raceNames.includes(raceName)) raceNames.push(raceName);
      raceNamesByValue.set(value, raceNames);
    }
  }

  return [...raceNamesByValue].map(([value, raceNames]) => ({
    value,
    races: raceNames.length === races.length ? [] : raceNames,
  }));
}

export function practicalGuide(
  races: readonly PracticalRaceFacts[],
  sections: PublicEventSite['sections'],
): readonly PracticalMoment[] {
  return SITE_MOMENTS.flatMap((moment) => {
    const topics = SITE_PRACTICAL_TOPICS.filter((topic) => topic.moment === moment).flatMap(
      (topic) => {
        const items = topic.factCategory === null ? [] : itemsOf(topic.factCategory, races);
        const body = sections.find((section) => section.topicKey === topic.key)?.body ?? null;
        if (items.length === 0 && body === null) return [];
        return [{ key: topic.key, title: topic.title, items, body }];
      },
    );

    const added = sections.flatMap((section, index) =>
      section.topicKey === null && section.moment === moment
        ? [{ key: `rubrique-${String(index)}`, title: section.title, items: [], body: section.body }]
        : [],
    );

    const rubrics = [...topics, ...added];
    return rubrics.length === 0 ? [] : [{ moment, title: SITE_MOMENT_LABELS[moment], rubrics }];
  });
}
