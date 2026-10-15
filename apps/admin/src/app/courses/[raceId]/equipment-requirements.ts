/**
 * Les trois exigences d'un matériel, décrites — SOURCES_EXTRACTION §82.
 *
 * Hors du module `'use client'` des formulaires : un composant serveur (le
 * panneau Matériel) ne reçoit d'un module client que ses composants, jamais
 * ses constantes.
 */
export const REQUIREMENT_OPTIONS = [
  {
    value: 'mandatory',
    label: 'Obligatoire',
    description: 'Exigé au départ ou contrôlé en course.',
  },
  {
    value: 'conditional',
    label: 'Conditionnel',
    description: 'Exigé selon une condition annoncée — météo, horaire, décision de l’organisation.',
  },
  {
    value: 'recommended',
    label: 'Recommandé',
    description: 'Conseillé par l’organisation, jamais exigé.',
  },
] as const;

export type Requirement = (typeof REQUIREMENT_OPTIONS)[number]['value'];
