/**
 * Marqueur des mondes créés par les suites e2e.
 *
 * Ces suites construisent un référentiel de course réel — organisation,
 * événement, édition, épreuves — et ne peuvent pas le démonter : un dépôt crée
 * un `source_snapshot`, immuable par trigger, et supprimer l'organisation
 * casserait dessus en cascade. Chaque exécution laisse donc son monde derrière
 * elle, et ils s'accumulent dans la liste des événements de l'administration,
 * indiscernables d'une vraie course.
 *
 * Le marqueur les rend reconnaissables sans rien supprimer : il apparaît dans
 * le slug, qui est indexé et filtrable en SQL, et dans le nom, qui est ce qu'un
 * humain lit dans l'écran. Nommer un jeu de test « Trail GPX » était le vrai
 * problème — un nom qui ne s'annonce pas se prend pour une donnée.
 *
 * Il ne remplace pas un nettoyage. Il permet de le faire en connaissance de
 * cause, et de repérer d'un coup d'œil ce qui n'est pas de la production.
 */

/** Segment inséré dans chaque slug produit par une suite e2e. */
export const E2E_MARKER = 'e2e-test';

/** Préfixe lisible, pour ce qu'un écran affiche. */
export const E2E_NAME_PREFIX = '[e2e]';

/**
 * Slug marqué.
 *
 * Le marqueur est en tête : un `like 'e2e-test-%'` suffit à isoler l'ensemble,
 * et l'ordre alphabétique les regroupe.
 */
export function e2eSlug(base: string, suffix: string): string {
  return `${E2E_MARKER}-${base}-${suffix}`;
}

/** Nom marqué, tel qu'il apparaîtra dans l'administration. */
export function e2eName(base: string): string {
  return `${E2E_NAME_PREFIX} ${base}`;
}

/** Reconnaît un monde de test, côté lecture. */
export function isE2eSlug(slug: string): boolean {
  return slug.startsWith(`${E2E_MARKER}-`);
}
