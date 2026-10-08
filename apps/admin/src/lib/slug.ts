/**
 * Adresse web proposée depuis un nom — minuscules, sans accent, tirets
 * simples, 80 caractères au plus : la forme qu'exige le domaine pour un slug.
 * Une proposition, toujours modifiable ; le domaine et la base tranchent.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}
