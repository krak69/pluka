/**
 * Matériel d'une épreuve — partagé par l'extraction (`@pluka/sources`) et la
 * saisie manuelle (`@pluka/domain`), migrations 0045 et 0046.
 *
 * Un même élément doit porter la même clé qu'il vienne d'un règlement lu ou
 * d'une saisie : c'est ce qui permet à la revue de rapprocher « Veste
 * imperméable » extraite d'un PDF de la « Veste imperméable » déjà publiée,
 * au lieu de créer un doublon.
 */

/** SOURCES_EXTRACTION §82 : les trois exigences à distinguer. */
export const EQUIPMENT_REQUIREMENTS = ['mandatory', 'conditional', 'recommended'] as const;

export type EquipmentRequirementValue = (typeof EQUIPMENT_REQUIREMENTS)[number];

/**
 * La clé de rapprochement d'un nom : « Veste imperméable » →
 * `equipment.veste-impermeable`. Elle n'est qu'un identifiant — elle évite le
 * doublon d'un même élément sur une épreuve, elle ne normalise rien de ce que
 * lit le coureur. La forme est vérifiée par la base (0045).
 */
export function equipmentFactKey(label: string): string | null {
  const slug = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');

  return slug === '' ? null : `equipment.${slug}`;
}
