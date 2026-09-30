import { StatusBadge, type StatusTone } from '@pluka/ui';

/**
 * Statuts de la console, traduits une fois.
 *
 * Les RPC de la migration 0028 rendent tous les statuts, y compris ceux que la
 * RLS garde fermés au public — c'est justement l'intérêt de l'écran. Il faut
 * donc les nommer, et les nommer au même endroit : « Pilote » dans un onglet et
 * « prospect » dans un autre décriraient le même état comme deux choses.
 *
 * Les libellés reprennent ceux du prototype quand il en propose un, même quand
 * l'enum dit autre chose : le prototype affiche « Pilote » et « Terminé » là où
 * `organization_status` dit `prospect` et `archived`. C'est le vocabulaire de
 * l'équipe, et c'est lui qui doit gagner à l'écran.
 *
 * Une valeur inconnue s'affiche telle quelle, en ton neutre, plutôt que de
 * disparaître : un enum élargi par une migration future doit se voir à l'écran,
 * pas se taire.
 */

interface StatusStyle {
  readonly label: string;
  readonly tone: StatusTone;
}

/** `organization_status` — 0001. */
const ORGANIZATION: Readonly<Record<string, StatusStyle>> = {
  prospect: { label: 'Pilote', tone: 'warning' },
  active: { label: 'Actif', tone: 'success' },
  suspended: { label: 'Suspendu', tone: 'error' },
  archived: { label: 'Terminé', tone: 'neutral' },
};

/** `source_status` — 0001. */
const SOURCE: Readonly<Record<string, StatusStyle>> = {
  uploaded: { label: 'Déposée', tone: 'neutral' },
  processing: { label: 'En cours', tone: 'warning' },
  ready: { label: 'Traitée', tone: 'success' },
  failed: { label: 'En erreur', tone: 'error' },
  archived: { label: 'Archivée', tone: 'neutral' },
};

/** `nutrition_product_status` — 0001. Les trois sous-onglets de l'écran Produits. */
const PRODUCT: Readonly<Record<string, StatusStyle>> = {
  draft: { label: 'À vérifier', tone: 'warning' },
  validated: { label: 'Validé', tone: 'success' },
  archived: { label: 'Archivé', tone: 'neutral' },
};

/** `report_status` — 0001. */
const REPORT: Readonly<Record<string, StatusStyle>> = {
  open: { label: 'Ouvert', tone: 'error' },
  reviewed: { label: 'Examiné', tone: 'warning' },
  resolved: { label: 'Traité', tone: 'success' },
  dismissed: { label: 'Classé sans suite', tone: 'neutral' },
};

/** `private.ingestion_jobs.status` — 0001. */
const JOB: Readonly<Record<string, StatusStyle>> = {
  queued: { label: 'En file', tone: 'neutral' },
  running: { label: 'En cours', tone: 'warning' },
  completed: { label: 'Terminé', tone: 'success' },
  failed: { label: 'En échec', tone: 'error' },
  cancelled: { label: 'Annulé', tone: 'neutral' },
};

/** `private.fact_candidates.status` — 0001. */
const CANDIDATE: Readonly<Record<string, StatusStyle>> = {
  detected: { label: 'Détectée', tone: 'neutral' },
  conflict: { label: 'Conflit', tone: 'error' },
  accepted: { label: 'Acceptée', tone: 'success' },
  rejected: { label: 'Rejetée', tone: 'neutral' },
};

/** `private.conflict_reports.status` — 0001. */
const CONFLICT: Readonly<Record<string, StatusStyle>> = {
  open: { label: 'Conflit ouvert', tone: 'error' },
  resolved: { label: 'Conflit résolu', tone: 'success' },
  dismissed: { label: 'Conflit écarté', tone: 'neutral' },
};

const DICTIONARIES = {
  organization: ORGANIZATION,
  source: SOURCE,
  product: PRODUCT,
  report: REPORT,
  job: JOB,
  candidate: CANDIDATE,
  conflict: CONFLICT,
} as const;

export type StatusDomain = keyof typeof DICTIONARIES;

export function AdminStatus({
  domain,
  status,
}: {
  readonly domain: StatusDomain;
  readonly status: string;
}) {
  const style = DICTIONARIES[domain][status];

  return style === undefined ? (
    <StatusBadge tone="neutral">{status}</StatusBadge>
  ) : (
    <StatusBadge tone={style.tone}>{style.label}</StatusBadge>
  );
}

/** Libellé seul, quand l'écran ne veut pas d'une pastille. */
export function statusLabel(domain: StatusDomain, status: string): string {
  return DICTIONARIES[domain][status]?.label ?? status;
}

/**
 * Motifs de signalement — `report_reason`, 0001.
 *
 * Le motif est choisi par la personne qui signale ; il n'est pas un statut et
 * ne porte donc pas de ton. Le rendre en clair évite qu'un administrateur ait à
 * traduire `misinformation` de tête pendant un triage.
 */
const REPORT_REASONS: Readonly<Record<string, string>> = {
  spam: 'Spam',
  abuse: 'Abus',
  misinformation: 'Désinformation',
  privacy: 'Vie privée',
  other: 'Autre',
};

export function reportReason(reason: string): string {
  return REPORT_REASONS[reason] ?? reason;
}

/** `source_type` — 0001. */
const SOURCE_TYPES: Readonly<Record<string, string>> = {
  url: 'Page web',
  pdf: 'PDF',
  gpx: 'GPX',
  file: 'Fichier',
  manual: 'Saisie manuelle',
  organizer_input: 'Saisie organisateur',
};

export function sourceTypeLabel(type: string): string {
  return SOURCE_TYPES[type] ?? type;
}

/** `nutrition_product_category` — 0001. */
const PRODUCT_CATEGORIES: Readonly<Record<string, string>> = {
  gel: 'Gel',
  drink: 'Boisson',
  bar: 'Barre',
  chew: 'Pâte de fruits',
  solid: 'Solide',
  salty: 'Salé',
  generic_aid: 'Ravitaillement générique',
  other: 'Autre',
};

export function productCategoryLabel(category: string): string {
  return PRODUCT_CATEGORIES[category] ?? category;
}

/**
 * Niveaux de droit — 04_ENTITLEMENTS §21.
 *
 * Résolus en base par priorité, « le droit le plus large gagne ». L'écran ne
 * fait que nommer le niveau que la fonction a déjà tranché : recalculer la
 * priorité ici créerait une seconde règle.
 */
const ENTITLEMENT_LEVELS: Readonly<Record<string, string>> = {
  free: 'Gratuit',
  race_pass: 'Course à l’unité',
  organizer_included: 'Inclus organisateur',
  plus: 'PLUKA+',
};

export function entitlementLabel(level: string): string {
  return ENTITLEMENT_LEVELS[level] ?? level;
}

/** `platform_role` — 0001 : deux valeurs, pas trois. */
const PLATFORM_ROLES: Readonly<Record<string, string>> = {
  user: 'Coureur',
  pluka_admin: 'Administration',
};

export function platformRoleLabel(role: string): string {
  return PLATFORM_ROLES[role] ?? role;
}
