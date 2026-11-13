import type { GearCategory } from '@pluka/domain';

/**
 * Les catégories de « Mon matériel », telles que le coureur les lit (0093).
 * Le domaine ne connaît que les clés ; les mots sont ceux de l'écran.
 */
export const GEAR_CATEGORY_LABELS: Readonly<Record<GearCategory, string>> = {
  clothing: 'Vêtements et accessoires',
  lighting: 'Éclairage',
  safety: 'Sécurité',
  hydration: 'Hydratation',
  nutrition: 'Nutrition',
  carrying: 'Portage',
  electronics: 'Électronique',
  care: 'Soins',
  other: 'Divers',
};
