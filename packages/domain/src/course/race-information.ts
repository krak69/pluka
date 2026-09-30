import { z } from 'zod';

import type {
  EditionRecord,
  EventRecord,
  PublishedRaceFactRecord,
  RaceCutoffRecord,
  RaceInformationRepositories,
  RaceRecord,
  RaceWaypointRecord,
} from '@pluka/db';

import type { Actor } from '../authorization/organization-role.js';
import { notFoundError, parseCommand } from '../errors.js';
import { isRacePubliclyReadable } from './invariants.js';

/**
 * Lecture de l'information d'une course — 03_PRIVACY_RLS §17, §18, §22.
 *
 * Deux écrans partagent ce module : l'onglet « La course » du coureur et la
 * fiche épreuve publique de `05_ROUTES_FLOWS.md` §4.3. C'est le même contenu,
 * lu par la même règle, et le dédoubler aurait produit deux vérités.
 *
 * Aucune de ces lectures n'écrit, aucune ne demande de droit commercial :
 * `04_ENTITLEMENTS.md` §6 place les informations de course, les sources, les
 * alertes officielles et le matériel obligatoire dans le socle Free.
 */

export interface RaceInformationContext {
  readonly repositories: RaceInformationRepositories;
  /** Absent sur la fiche publique : elle se lit sans session. */
  readonly actor?: Actor;
}

const slug = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'slug invalide');

export const findRaceBySlugsQuerySchema = z.object({
  eventSlug: slug,
  editionSlug: slug,
  raceSlug: slug,
});

export const searchRacesQuerySchema = z.object({
  query: z.string().trim().min(2).max(120),
  limit: z.number().int().min(1).max(20).default(8),
});

export const listRaceInformationQuerySchema = z.object({ raceId: z.string().uuid() });

/** Une épreuve et sa hiérarchie, telles qu'une adresse publique les désigne. */
export interface RaceBySlugs {
  readonly race: RaceRecord;
  readonly edition: EditionRecord;
  readonly event: EventRecord;
  /** Vrai quand la course est `public` : c'est la seule qui peut être indexée. */
  readonly indexable: boolean;
}

/**
 * Résout `/epreuves/[eventSlug]/[editionSlug]/[raceSlug]`.
 *
 * Les trois segments sont nécessaires parce que l'unicité l'exige :
 * `races.slug` n'est unique que par édition, `editions.slug` que par événement
 * (`05_ROUTES_FLOWS.md` §1.9).
 *
 * Tout échec est `not_found`, jamais `forbidden`. §17 est explicite : « une
 * Race unlisted ou private ne devient pas listable par la connaissance de son
 * UUID » — et répondre « interdit » sur un slug renseignerait tout autant.
 *
 * `unlisted` est donc résolue : elle est atteignable par lien direct. Seule
 * `private` reste introuvable, parce que ses participations naissent d'un
 * import et non d'une visite.
 */
export async function findRaceBySlugs(
  context: RaceInformationContext,
  input: unknown,
): Promise<RaceBySlugs> {
  const useCase = 'findRaceBySlugs';
  const query = parseCommand(findRaceBySlugsQuerySchema, input, useCase);

  const event = await context.repositories.events.findBySlug(query.eventSlug);
  if (event === null) throw notFoundError(useCase, 'épreuve');

  const edition = await context.repositories.editions.findByEventAndSlug(
    event.id,
    query.editionSlug,
  );
  if (edition === null) throw notFoundError(useCase, 'épreuve');

  const race = await context.repositories.races.findByEditionAndSlug(edition.id, query.raceSlug);
  if (race === null) throw notFoundError(useCase, 'épreuve');

  // La RLS a déjà filtré ; l'invariant le redit côté domaine plutôt que de
  // faire confiance à la policy seule (01_ARCHITECTURE §5, règle 5).
  if (!isRacePubliclyReadable(race, edition, event)) {
    throw notFoundError(useCase, 'épreuve');
  }

  return { race, edition, event, indexable: race.publicVisibility === 'public' };
}

/** Un événement trouvé, avec les épreuves de son édition la plus proche. */
export interface RaceSearchResult {
  readonly event: EventRecord;
  readonly edition: EditionRecord;
  readonly races: readonly RaceRecord[];
}

/**
 * Recherche d'une course — écran « Trouver ma course ».
 *
 * La recherche porte sur le nom de l'événement, et rend ses épreuves : c'est
 * ainsi que le prototype la présente, et c'est ainsi qu'un coureur cherche —
 * il connaît le nom de la course, pas celui de son épreuve.
 *
 * Aucun filtre de visibilité n'est écrit ici : `events__select__published` et
 * `editions__select__published` s'en chargent, et une épreuve non publiquement
 * lisible est écartée explicitement ensuite. Une recherche ne doit jamais être
 * un moyen de découvrir une course `unlisted`.
 */
export async function searchRaces(
  context: RaceInformationContext,
  input: unknown,
): Promise<readonly RaceSearchResult[]> {
  const query = parseCommand(searchRacesQuerySchema, input, 'searchRaces');

  const events = await context.repositories.events.searchByName(query.query, query.limit);

  const results = await Promise.all(
    events.map(async (event) => {
      const editions = await context.repositories.editions.listByEvent(event.id);

      // L'édition la plus proche dans le temps : c'est celle qu'on prépare.
      const edition = [...editions].sort((left, right) => left.year - right.year).at(-1);
      if (edition === undefined) return [];

      const races = await context.repositories.races.listByEdition(edition.id);
      const visible = races.filter((race) => race.publicVisibility === 'public');

      if (visible.length === 0) return [];

      return [{ event, edition, races: visible }];
    }),
  );

  return results.flat();
}

/**
 * L'information officielle d'une course.
 *
 * Trois lectures : les facts publiés avec leur source, les points de passage,
 * les barrières horaires. Rien d'autre — pas de plan, pas de participation.
 *
 * Les facts arrivent groupés par catégorie pour que l'écran n'ait pas à
 * connaître l'ordre du référentiel : c'est une propriété du contenu, pas de la
 * mise en page.
 */
export interface RaceInformation {
  readonly race: RaceRecord;
  readonly edition: EditionRecord;
  readonly event: EventRecord;
  readonly facts: readonly PublishedRaceFactRecord[];
  readonly waypoints: readonly RaceWaypointRecord[];
  readonly cutoffs: readonly RaceCutoffRecord[];
}

export async function listRaceInformation(
  context: RaceInformationContext,
  input: unknown,
): Promise<RaceInformation> {
  const useCase = 'listRaceInformation';
  const query = parseCommand(listRaceInformationQuerySchema, input, useCase);

  const race = await context.repositories.races.findById(query.raceId);
  if (race === null) throw notFoundError(useCase, 'épreuve');

  const edition = await context.repositories.editions.findById(race.editionId);
  if (edition === null) throw notFoundError(useCase, 'édition');

  const event = await context.repositories.events.findById(edition.eventId);
  if (event === null) throw notFoundError(useCase, 'événement');

  const [facts, waypoints, cutoffs] = await Promise.all([
    context.repositories.publishedFacts.listPublishedByRace(race.id),
    context.repositories.waypoints.listByRace(race.id),
    context.repositories.waypoints.listCutoffsByRace(race.id),
  ]);

  return { race, edition, event, facts, waypoints, cutoffs };
}
