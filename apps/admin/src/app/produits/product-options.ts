/**
 * Options du formulaire de fiche — migration 0039. Module sans dépendance
 * serveur : le formulaire client l'importe. Les valeurs sont celles de la
 * base ; un test les recoupe avec les constantes du domaine.
 */
export const CATEGORY_OPTIONS = [
  { value: 'gel', label: 'Gel' },
  { value: 'drink', label: 'Boisson d’effort' },
  { value: 'bar', label: 'Barre' },
  { value: 'chew', label: 'Gummies' },
  { value: 'puree', label: 'Purée' },
  { value: 'solid', label: 'Solide' },
  { value: 'salty', label: 'Salé' },
  { value: 'capsule', label: 'Capsule' },
  { value: 'electrolyte', label: 'Électrolytes' },
  { value: 'generic_aid', label: 'Ravitaillement générique' },
  { value: 'other', label: 'Autre' },
] as const;

export const TEXTURE_OPTIONS = [
  { value: 'gel', label: 'Gel' },
  { value: 'liquid', label: 'Liquide' },
  { value: 'semi_liquid', label: 'Semi-liquide' },
  { value: 'solid', label: 'Solide' },
  { value: 'chewy', label: 'Gomme' },
] as const;

/** Des faits, aucune allégation (décision du 2026-10-07). */
export const TAG_OPTIONS = [
  'Caféiné',
  'Riche en glucides',
  'Riche en sodium',
  'Salé',
  'Isotonique',
  'Hydrogel',
] as const;

export const STATUS_OPTIONS = [
  { value: 'draft', label: 'À vérifier' },
  { value: 'validated', label: 'Validé — trouvable par tous les coureurs' },
  { value: 'archived', label: 'Archivé — retiré des coureurs' },
] as const;
