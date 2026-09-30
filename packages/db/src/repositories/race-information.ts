import { selectColumns } from '../columns.js';
import { defineRepository, type RepositoryContext } from '../repository.js';
import { unwrap } from '../results.js';
import {
  editionRepository,
  eventRepository,
  identityRepository,
  raceRepository,
  type EditionRepository,
  type EventRepository,
  type IdentityRepository,
  type RaceRepository,
} from './course.js';
import type { PublishedRaceFactRecord } from './records.js';
import { raceWaypointRepository, type RaceWaypointRepository } from './waypoints.js';

/*
 * Lecture des facts publiés — 03_PRIVACY_RLS §22, §23.
 *
 * Cette lecture-là n'a rien à voir avec la revue : elle sert le coureur et la
 * page publique d'une épreuve. La RLS l'autorise déjà sans nouvelle policy —
 * `race_facts__select__race_readable`, `race_fact_versions__select__published`
 * et `fact_sources__select__scope` ouvrent à `anon` et `authenticated` les
 * facts publiés d'une course lisible, et rien d'autre. Les états `draft`,
 * `validated` non publié, `rejected` et `superseded` restent internes.
 *
 * Trois requêtes plutôt qu'une jointure imbriquée : `selectColumns` type une
 * projection plate, et trois lectures explicites se relisent mieux qu'une
 * chaîne PostgREST imbriquée que personne ne vérifie.
 */

const PUBLISHED_FACT_COLUMNS = [
  'id',
  'race_id',
  'category',
  'fact_key',
  'current_version_id',
] as const;

const PUBLISHED_VERSION_COLUMNS = [
  'id',
  'fact_id',
  'version_number',
  'value_text',
  'value_number',
  'unit',
  'value_json',
  'trust_level',
  'published_at',
] as const;

const FACT_SOURCE_COLUMNS = [
  'id',
  'fact_version_id',
  'source_id',
  'page_start',
  'page_end',
  'section_label',
  'article_label',
  'excerpt',
  'is_primary',
] as const;

const SOURCE_COLUMNS = ['id', 'source_type', 'title', 'url', 'declared_published_at'] as const;

export interface PublishedFactRepository {
  /**
   * Les facts publiés d'une course, avec leur source principale.
   *
   * Un fact sans version publiée est absent du résultat : il existe en base
   * mais n'a rien à montrer, et l'afficher vide laisserait croire à une valeur
   * manquante plutôt qu'à une information non encore publiée.
   */
  listPublishedByRace(raceId: string): Promise<readonly PublishedRaceFactRecord[]>;
}

export const publishedFactRepository = defineRepository<PublishedFactRepository>((context) => ({
  async listPublishedByRace(raceId) {
    const facts = unwrap(
      await context.client
        .from('race_facts')
        .select(selectColumns('race_facts', PUBLISHED_FACT_COLUMNS))
        .eq('race_id', raceId)
        .order('fact_key', { ascending: true }),
      'race_facts.listPublishedByRace',
    );

    const versionIds = facts
      .map((fact) => fact.current_version_id)
      .filter((id): id is string => id !== null);

    if (versionIds.length === 0) return [];

    const versions = unwrap(
      await context.client
        .from('race_fact_versions')
        .select(selectColumns('race_fact_versions', PUBLISHED_VERSION_COLUMNS))
        .in('id', versionIds),
      'race_fact_versions.listPublished',
    );

    const factSources = unwrap(
      await context.client
        .from('fact_sources')
        .select(selectColumns('fact_sources', FACT_SOURCE_COLUMNS))
        .in(
          'fact_version_id',
          versions.map((version) => version.id),
        ),
      'fact_sources.listForVersions',
    );

    const sourceIds = [...new Set(factSources.map((link) => link.source_id))];

    const sources =
      sourceIds.length === 0
        ? []
        : unwrap(
            await context.client
              .from('sources')
              .select(selectColumns('sources', SOURCE_COLUMNS))
              .in('id', sourceIds),
            'sources.listForFacts',
          );

    const versionById = new Map(versions.map((version) => [version.id, version]));
    const sourceById = new Map(sources.map((source) => [source.id, source]));

    /* La source principale est unique par version — `ux_fact_sources_primary`. */
    const primaryByVersion = new Map(
      factSources.filter((link) => link.is_primary).map((link) => [link.fact_version_id, link]),
    );

    return facts.flatMap((fact) => {
      if (fact.current_version_id === null) return [];

      const version = versionById.get(fact.current_version_id);

      // La version est absente quand elle n'est pas publiée : la policy ne la
      // rend pas. C'est un résultat, pas une incohérence.
      if (version === undefined) return [];

      const link = primaryByVersion.get(version.id);
      const source = link === undefined ? undefined : sourceById.get(link.source_id);

      return [
        {
          factId: fact.id,
          raceId: fact.race_id,
          category: fact.category,
          factKey: fact.fact_key,
          versionId: version.id,
          versionNumber: version.version_number,
          valueText: version.value_text,
          valueNumber: version.value_number === null ? null : Number(version.value_number),
          unit: version.unit,
          valueJson: (version.value_json ?? null) as Readonly<Record<string, unknown>> | null,
          trustLevel: version.trust_level,
          publishedAt: version.published_at,
          source:
            link === undefined || source === undefined
              ? null
              : {
                  sourceId: source.id,
                  sourceType: source.source_type,
                  title: source.title,
                  url: source.url,
                  declaredPublishedAt: source.declared_published_at,
                  pageStart: link.page_start,
                  pageEnd: link.page_end,
                  sectionLabel: link.section_label,
                  articleLabel: link.article_label,
                  excerpt: link.excerpt,
                },
        },
      ];
    });
  },
}));

/**
 * Tout ce qu'il faut pour lire l'information d'une course.
 *
 * Ce bundle sert deux écrans : l'onglet « La course » du coureur et la fiche
 * épreuve publique. Il compose des lectures existantes plutôt que d'en créer —
 * la hiérarchie course vient de `course.js`, les waypoints et barrières de
 * `waypoints.js`, et seuls les facts publiés sont nouveaux.
 *
 * `identity` en fait partie parce que `getRaceOverview` en a besoin pour
 * distinguer un gestionnaire d'un visiteur sur une course non publique.
 */
export interface RaceInformationRepositories {
  readonly events: EventRepository;
  readonly editions: EditionRepository;
  readonly races: RaceRepository;
  readonly waypoints: RaceWaypointRepository;
  readonly publishedFacts: PublishedFactRepository;
  readonly identity: IdentityRepository;
}

export function createRaceInformationRepositories(
  context: RepositoryContext,
): RaceInformationRepositories {
  return {
    events: eventRepository(context),
    editions: editionRepository(context),
    races: raceRepository(context),
    waypoints: raceWaypointRepository(context),
    publishedFacts: publishedFactRepository(context),
    identity: identityRepository(context),
  };
}
