import type { SourceLocator } from '../parsing/blocks.js';

/**
 * Candidats d'extraction — docs/engines/SOURCES_EXTRACTION.md §21, §24, §25.
 *
 * Un candidat est une **proposition**, jamais une vérité publiée. §25 est
 * explicite : « le système ne doit jamais afficher directement un candidat
 * comme fact publié ». Rien ici ne porte donc d'état de publication : le
 * vocabulaire s'arrête à ce qu'un relecteur humain aura à trancher (§30).
 *
 * Ces types sont **métier**, pas provider : §56 les place dans ce paquet et
 * garde `AIProvider` dans `packages/contracts`.
 */

/** Catégories de facts — miroir exact de l'enum SQL `public.fact_category`. */
export const FACT_CATEGORIES = [
  'general',
  'start',
  'bib',
  'course',
  'gpx',
  'aid',
  'cutoff',
  'equipment',
  'assistance',
  'bag',
  'transport',
  'safety',
  'withdrawal',
  'rules',
  'contact',
  'weather',
  'other',
] as const;

export type FactCategory = (typeof FACT_CATEGORIES)[number];

/**
 * §28 : « le champ `confidence` de l'IA est seulement un signal de tri ».
 *
 * Trois étiquettes, pas une probabilité : une valeur numérique laisserait
 * croire à une mesure statistique certifiée, ce que §28 refuse explicitement.
 */
export const CONFIDENCE_LABELS = ['high', 'medium', 'low'] as const;

export type ConfidenceLabel = (typeof CONFIDENCE_LABELS)[number];

/**
 * Origine d'un candidat.
 *
 * §29 impose l'ordre « déterministe avant IA ». Conserver l'origine rend cet
 * ordre vérifiable après coup, et permet à la revue humaine de savoir ce qui a
 * été lu par une règle et ce qui a été interprété par un modèle.
 */
export const CANDIDATE_ORIGINS = ['deterministic', 'ai'] as const;

export type CandidateOrigin = (typeof CANDIDATE_ORIGINS)[number];

/**
 * État de revue d'un candidat à sa naissance.
 *
 * Deux valeurs seulement, et aucune ne publie : `detected` pour un candidat
 * complet, `needs_review` pour un candidat volontairement incomplet — §84
 * demande de produire un candidat marqué à revoir plutôt que d'inventer la
 * base horaire d'une barrière. `accepted`, `rejected` et `duplicate` sont des
 * décisions humaines (§31) : ce lot ne les produit pas.
 */
export const CANDIDATE_REVIEW_STATES = ['detected', 'needs_review'] as const;

export type CandidateReviewState = (typeof CANDIDATE_REVIEW_STATES)[number];

/**
 * Preuve d'un candidat — §20 « citation précise ».
 *
 * « Une preuve minimale contient : snapshot_id, block_id ou chunk_id,
 * page_number si disponible, section_path si disponible, quote / excerpt
 * court. »
 *
 * Le snapshot n'apparaît pas ici : ce paquet est pur et ne connaît aucun
 * identifiant de base. Les index de block et de chunk sont ceux du run de
 * parsing, et c'est la couche SQL qui les résout en identifiants — un index
 * n'a de sens que rapporté à son run, ce qui est précisément ce qui rattache
 * la preuve à son snapshot.
 */
export interface CandidateEvidence {
  readonly blockIndex: number;
  readonly chunkIndex: number | null;
  readonly pageNumber: number | null;
  readonly sectionPath: readonly string[];
  readonly locator: SourceLocator;
  /** Extrait court. §20 : « les extraits servent à la traçabilité, pas à recopier tout le document ». */
  readonly excerpt: string;
  readonly isPrimary: boolean;
}

/**
 * Candidat extrait — §21.
 *
 * La valeur est éclatée en trois colonnes plutôt qu'en un `value: unknown`
 * générique : `02_DATA_MODEL` impose `num_nonnulls(value_text, value_number,
 * value_json) >= 1`, et une valeur numérique rangée en texte ne se compare
 * pas. §80 veut la valeur normalisée *et* la valeur d'origine : la première
 * est ici, la seconde reste dans l'extrait de preuve.
 */
export interface ExtractedCandidate {
  readonly factType: FactCategory;
  /** Sujet de l'information — §24. Jamais la valeur. */
  readonly subjectKey: string;
  /** Précision de contexte : `arrival`, `departure`, `conditional`… */
  readonly context: string | null;
  /** Identité logique dérivée. Deux valeurs contradictoires partagent la même clé. */
  readonly factKey: string;
  readonly valueText: string | null;
  readonly valueNumber: number | null;
  readonly unit: string | null;
  readonly valueJson: Readonly<Record<string, unknown>> | null;
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly evidence: readonly CandidateEvidence[];
  readonly confidence: ConfidenceLabel;
  readonly notes: string | null;
  readonly origin: CandidateOrigin;
  readonly reviewState: CandidateReviewState;
}

/**
 * Identité logique d'un fact — §24.
 *
 * « La clé logique ne doit pas être : valeur + texte. Elle doit représenter le
 * sujet. » C'est ce qui permet à une barrière qui passe de 16:20 à 16:31 de
 * rester *la même* information versionnée, et non deux concepts distincts.
 *
 * `raceId` ne fait pas partie de la clé construite ici : la table
 * `public.race_facts` porte déjà `race_id` et l'unicité est `(race_id,
 * fact_key)`. L'inclure dupliquerait la portée et rendrait la clé illisible.
 */
export function factKeyOf(input: {
  readonly factType: FactCategory;
  readonly subjectKey: string;
  readonly context?: string | null;
}): string {
  const parts = [input.factType, slug(input.subjectKey)];
  const context = input.context ?? null;

  if (context !== null && context.trim() !== '') parts.push(slug(context));

  return parts.join('/');
}

/**
 * Normalise un fragment de clé.
 *
 * Les accents sont réduits pour que « Iffigenalp » écrit avec ou sans accent
 * dans deux documents ne fabrique pas deux facts distincts. La casse et la
 * ponctuation disparaissent pour la même raison.
 */
export function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}
