import { documentKindOf, isSameSite, type PageLink } from './links.js';
import type { RobotsPolicy } from './robots.js';

/**
 * Choix des pages lues — SOURCES_EXTRACTION §11.1.
 *
 * Profondeur 1, même site, au plus 15 pages page saisie comprise. Quand la
 * page d'accueil lie plus de pages que la borne, celles dont l'adresse ou le
 * texte parlent de course passent devant ; à égalité, l'ordre du document.
 * Ce tri ne décide d'aucun fait : il choisit seulement quoi lire.
 */

export const DISCOVERY_LIMITS = {
  /** Pages HTML lues, page saisie comprise. */
  maxPages: 15,
  /** Documents listés dans l'inventaire. */
  maxDocuments: 40,
} as const;

/** Mots qui signalent une page utile à la préparation d'une course. */
const USEFUL_WORDS = [
  'course',
  'courses',
  'epreuve',
  'epreuves',
  'parcours',
  'trail',
  'ultra',
  'reglement',
  'programme',
  'horaires',
  'infos',
  'informations',
  'pratique',
  'ravitaillement',
  'materiel',
  'barriere',
  'distance',
  'km',
  'race',
  'races',
  'rules',
  'program',
];

/** Ce qui ne se lit pas : boutiques, comptes, réseaux, fichiers. */
const SKIPPED = /\.(?:jpe?g|png|gif|webp|svg|zip|mp4|mov|docx?|xlsx?|ics)$/i;

function score(link: PageLink): number {
  const haystack = `${link.url} ${link.text}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

  return USEFUL_WORDS.filter((word) => new RegExp(`\\b${word}\\b`).test(haystack)).length;
}

export function selectPagesToRead(
  startUrl: string,
  links: readonly PageLink[],
  robots: RobotsPolicy,
  maxPages: number = DISCOVERY_LIMITS.maxPages,
): readonly string[] {
  const candidates = links
    .map((link, index) => ({ link, index, score: score(link) }))
    .filter(
      ({ link }) =>
        link.url !== startUrl &&
        isSameSite(link.url, startUrl) &&
        documentKindOf(link.url) === null &&
        !SKIPPED.test(new URL(link.url).pathname) &&
        robots.isAllowed(link.url),
    )
    .sort((left, right) => right.score - left.score || left.index - right.index);

  return candidates.slice(0, Math.max(0, maxPages - 1)).map(({ link }) => link.url);
}
