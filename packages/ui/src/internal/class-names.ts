/**
 * Concaténation de classes.
 *
 * Interne au paquet : ce n'est pas une primitive du Design System, juste le
 * moyen de laisser un appelant ajouter sa classe de mise en page sans écraser
 * celles du composant.
 */
export function classNames(...values: readonly (string | false | null | undefined)[]): string {
  return values
    .filter((value): value is string => typeof value === 'string' && value !== '')
    .join(' ');
}
