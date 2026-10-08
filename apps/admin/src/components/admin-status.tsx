import { Chip, type ChipTone } from '@/components/admin-page';

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
  readonly tone: ChipTone;
}

/** `organization_status` — 0001. */
const ORGANIZATION: Readonly<Record<string, StatusStyle>> = {
  prospect: { label: 'Pilote', tone: 'glacier' },
  active: { label: 'Actif', tone: 'success' },
  suspended: { label: 'Suspendu', tone: 'error' },
  archived: { label: 'Terminé', tone: 'neutral' },
};

/** `source_status` — 0001. */
const SOURCE: Readonly<Record<string, StatusStyle>> = {
  uploaded: { label: 'Déposée', tone: 'neutral' },
  processing: { label: 'Analyse en cours', tone: 'glacier' },
  ready: { label: 'Traitée', tone: 'success' },
  failed: { label: 'Erreur', tone: 'error' },
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
  running: { label: 'En cours', tone: 'glacier' },
  completed: { label: 'Terminé', tone: 'success' },
  failed: { label: 'Échec', tone: 'error' },
  cancelled: { label: 'Annulé', tone: 'neutral' },
};

/** `private.fact_candidates.status` — 0001. */
const CANDIDATE: Readonly<Record<string, StatusStyle>> = {
  detected: { label: 'Candidate', tone: 'neutral' },
  conflict: { label: 'Conflit', tone: 'warning' },
  accepted: { label: 'Acceptée', tone: 'success' },
  rejected: { label: 'Rejetée', tone: 'neutral' },
};

/** `private.conflict_reports.status` — 0001. */
const CONFLICT: Readonly<Record<string, StatusStyle>> = {
  open: { label: 'Conflit ouvert', tone: 'warning' },
  resolved: { label: 'Conflit résolu', tone: 'success' },
  dismissed: { label: 'Conflit écarté', tone: 'neutral' },
};

/** `record_status` d'un événement — libellés de l'`adminEventList` du prototype. */
const EVENT: Readonly<Record<string, StatusStyle>> = {
  draft: { label: 'En préparation', tone: 'glacier' },
  published: { label: 'Publié', tone: 'success' },
  archived: { label: 'Archivé', tone: 'neutral' },
};

/**
 * `edition_status` et `race_status` — 0001, sens de 00_PRODUCT_SPEC §4.1.
 * Accordés au féminin : une édition, une épreuve.
 */
const EDITION: Readonly<Record<string, StatusStyle>> = {
  draft: { label: 'En préparation', tone: 'glacier' },
  published: { label: 'Diffusée', tone: 'success' },
  completed: { label: 'Courue', tone: 'neutral' },
  cancelled: { label: 'Annulée', tone: 'error' },
  archived: { label: 'Archivée', tone: 'neutral' },
};

const RACE: Readonly<Record<string, StatusStyle>> = EDITION;

const DICTIONARIES = {
  event: EVENT,
  edition: EDITION,
  race: RACE,
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
    <Chip tone="neutral">{status}</Chip>
  ) : (
    <Chip tone={style.tone}>{style.label}</Chip>
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

/**
 * `management_status` d'un événement — 0001. « Partenaire » et
 * « Communautaire » viennent de l'`adminEventList` du prototype ;
 * « Maintenu par PLUKA » n'y figure pas et a été décidé pour la console.
 *
 * Le type se lit sur ce champ seul, jamais sur la présence d'une organisation :
 * la base ne lie pas les deux, et en déduire l'un de l'autre masquerait un
 * événement incohérent au lieu de le montrer.
 */
const MANAGEMENT_STATUSES: Readonly<Record<string, string>> = {
  organizer_managed: 'Partenaire',
  community: 'Communautaire',
  pluka_managed: 'Maintenu par PLUKA',
};

export function managementStatusLabel(status: string): string {
  return MANAGEMENT_STATUSES[status] ?? status;
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

/**
 * `nutrition_product_category` — 0001 et 0039. Les libellés mêlent la base et
 * le catalogue réel importé (décision du 2026-10-07) : « Boisson d'effort »,
 * « Gummies ».
 */
const PRODUCT_CATEGORIES: Readonly<Record<string, string>> = {
  gel: 'Gel',
  drink: 'Boisson d’effort',
  bar: 'Barre',
  chew: 'Gummies',
  puree: 'Purée',
  solid: 'Solide',
  salty: 'Salé',
  capsule: 'Capsule',
  electrolyte: 'Électrolytes',
  generic_aid: 'Ravitaillement générique',
  other: 'Autre',
};

/** `nutrition_texture` — 0039. */
const PRODUCT_TEXTURES: Readonly<Record<string, string>> = {
  gel: 'Gel',
  liquid: 'Liquide',
  semi_liquid: 'Semi-liquide',
  solid: 'Solide',
  chewy: 'Gomme',
};

export function productTextureLabel(texture: string): string {
  return PRODUCT_TEXTURES[texture] ?? texture;
}

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

/**
 * `organization_member_role` — 0001. Libellés et descriptions de l'`orgTeam`
 * du prototype, dans l'ordre d'autorité.
 */
export const ORGANIZATION_ROLE_OPTIONS = [
  {
    value: 'owner',
    label: 'Propriétaire',
    description: 'Gère tout, y compris l’organisation et l’équipe.',
  },
  {
    value: 'admin',
    label: 'Administrateur',
    description: 'Gère l’événement, les sources et les participants.',
  },
  {
    value: 'editor',
    label: 'Éditeur',
    description: 'Modifie les contenus et valide les informations.',
  },
  { value: 'viewer', label: 'Lecture seule', description: 'Consulte sans modifier.' },
] as const;

export function organizationRoleLabel(role: string): string {
  return ORGANIZATION_ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;
}

/** `platform_role` — 0001 : deux valeurs, pas trois. */
const PLATFORM_ROLES: Readonly<Record<string, string>> = {
  user: 'Coureur',
  pluka_admin: 'Administration',
};

export function platformRoleLabel(role: string): string {
  return PLATFORM_ROLES[role] ?? role;
}

/**
 * `fact_category` — 0001. Mêmes libellés que la fiche épreuve du coureur
 * (`apps/app/src/components/race-facts.tsx`) : une information porte le même
 * nom des deux côtés.
 */
const FACT_CATEGORIES: Readonly<Record<string, string>> = {
  general: 'Général',
  start: 'Départ',
  bib: 'Dossard',
  course: 'Parcours',
  gpx: 'Trace GPX',
  aid: 'Ravitaillement',
  cutoff: 'Barrières horaires',
  equipment: 'Matériel',
  assistance: 'Assistance',
  bag: 'Sacs',
  transport: 'Transport',
  safety: 'Sécurité',
  withdrawal: 'Abandon',
  rules: 'Règlement',
  contact: 'Contact',
  weather: 'Météo',
  other: 'Autres informations',
};

export function factCategoryLabel(category: string): string {
  return FACT_CATEGORIES[category] ?? category;
}

/**
 * Types de traitement — `private.ingestion_jobs.job_type`, posés par 0008 à
 * 0011. Ce sont des chaînes libres : un type nouveau s'affiche tel quel.
 */
const JOB_TYPES: Readonly<Record<string, string>> = {
  'gpx.process': 'Analyse GPX',
  'source.ingest': 'Import de source',
  'source.parse': 'Lecture de source',
  'source.extract': 'Extraction de source',
};

export function jobTypeLabel(jobType: string): string {
  return JOB_TYPES[jobType] ?? jobType;
}

/**
 * `race_visibility` — 0001, 03_PRIVACY_RLS §17. Les descriptions disent ce
 * que le code fait aujourd'hui (05_ROUTES_FLOWS §1.8, §12.10) : seule une
 * épreuve publique s'ouvre sans session ; une non listée accepte encore des
 * inscriptions ; une privée n'en accepte plus.
 */
export const RACE_VISIBILITY_OPTIONS = [
  {
    value: 'public',
    label: 'Publique',
    description: 'Listée sur PLUKA et dans la recherche, ouverte à tous.',
  },
  {
    value: 'unlisted',
    label: 'Non listée',
    description:
      'Absente des listes et de la recherche. Les coureurs peuvent s’y inscrire ; la page demande une connexion.',
  },
  {
    value: 'private',
    label: 'Privée',
    description:
      'Réservée à l’organisation, à PLUKA et aux inscrits déjà présents. Aucune nouvelle inscription.',
  },
] as const;

export function raceVisibilityLabel(visibility: string): string {
  return RACE_VISIBILITY_OPTIONS.find((option) => option.value === visibility)?.label ?? visibility;
}
