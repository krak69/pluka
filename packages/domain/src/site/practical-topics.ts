/**
 * Les rubriques proposées des infos pratiques — EVENT_SITE §3.3.
 *
 * L'organisateur part de cette liste plutôt que d'une page blanche. Une
 * rubrique peut reprendre une catégorie de faits publiés : ils s'affichent avec
 * son texte, sans être ressaisis.
 */

export const SITE_MOMENTS = ['before', 'during', 'after'] as const;

export type SiteMoment = (typeof SITE_MOMENTS)[number];

export const SITE_MOMENT_LABELS: Readonly<Record<SiteMoment, string>> = {
  before: 'Avant',
  during: 'Pendant',
  after: 'Après',
};

export const SITE_PRACTICAL_TOPICS = [
  {
    key: 'bib_pickup',
    moment: 'before',
    title: 'Retrait des dossards',
    hint: 'Où, quand, pièces à présenter.',
    factCategory: 'bib',
  },
  {
    key: 'access',
    moment: 'before',
    title: 'Accès et parking',
    hint: 'Venir en voiture, en train, où se garer.',
    factCategory: null,
  },
  {
    key: 'lodging',
    moment: 'before',
    title: 'Hébergement',
    hint: 'Camping, gîtes, office de tourisme.',
    factCategory: null,
  },
  {
    key: 'food',
    moment: 'before',
    title: 'Restauration',
    hint: 'Pasta party, buvette, où manger.',
    factCategory: null,
  },
  {
    key: 'contact',
    moment: 'before',
    title: 'Contact',
    hint: 'Qui joindre avant et pendant l’événement.',
    factCategory: 'contact',
  },
  {
    key: 'shuttles',
    moment: 'during',
    title: 'Navettes et transport',
    hint: 'Horaires et points de départ des navettes.',
    factCategory: 'transport',
  },
  {
    key: 'companions',
    moment: 'during',
    title: 'Accompagnants',
    hint: 'Où voir passer les coureurs, comment y aller.',
    factCategory: null,
  },
  {
    key: 'bag_drop',
    moment: 'during',
    title: 'Consignes et sacs',
    hint: 'Dépôt des sacs, vestiaires.',
    factCategory: null,
  },
  {
    key: 'showers',
    moment: 'after',
    title: 'Douches',
    hint: 'Lieu et horaires.',
    factCategory: null,
  },
  {
    key: 'post_race_meal',
    moment: 'after',
    title: 'Repas d’après-course',
    hint: 'Ce qui est offert, où, jusqu’à quand.',
    factCategory: null,
  },
  {
    key: 'awards',
    moment: 'after',
    title: 'Remise des prix',
    hint: 'Heure, lieu, catégories récompensées.',
    factCategory: null,
  },
] as const satisfies readonly {
  readonly key: string;
  readonly moment: SiteMoment;
  readonly title: string;
  readonly hint: string;
  readonly factCategory: 'bib' | 'contact' | 'transport' | null;
}[];

export type SitePracticalTopic = (typeof SITE_PRACTICAL_TOPICS)[number];
export type SitePracticalTopicKey = SitePracticalTopic['key'];

export const SITE_PRACTICAL_TOPIC_KEYS = SITE_PRACTICAL_TOPICS.map((topic) => topic.key) as [
  SitePracticalTopicKey,
  ...SitePracticalTopicKey[],
];

export function sitePracticalTopic(key: SitePracticalTopicKey): SitePracticalTopic {
  const topic = SITE_PRACTICAL_TOPICS.find((candidate) => candidate.key === key);
  if (topic === undefined) throw new Error(`rubrique inconnue : ${key}`);
  return topic;
}
