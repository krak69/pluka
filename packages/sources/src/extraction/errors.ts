/**
 * Erreurs d'extraction — docs/engines/SOURCES_EXTRACTION.md §61.
 *
 * Les codes sont ceux de la spécification, mot pour mot. Le worker les
 * normalise dans `ingestion_jobs.last_error` et s'en sert pour décider d'un
 * retry : une réponse de modèle hors schéma peut réussir au coup suivant, un
 * run de parsing vide ne guérira pas.
 *
 * §61 pose aussi la règle qui compte le plus ici :
 *
 * > « Un échec extraction ne doit jamais invalider un RaceFact déjà publié. »
 *
 * Rien dans ce module n'écrit : l'échec produit une erreur, et la couche SQL
 * marque le run en échec. Aucun chemin ne touche à `race_facts`.
 */
export const EXTRACTION_ERROR_CODES = [
  'EXTRACTION_FAILED',
  'EXTRACTION_SCHEMA_INVALID',
  'EXTRACTION_EMPTY',
  'CANDIDATE_INVALID',
  'CANDIDATE_LOW_CONFIDENCE',
] as const;

export type ExtractionErrorCode = (typeof EXTRACTION_ERROR_CODES)[number];

/**
 * Codes qui ne guériront pas au retry.
 *
 * Un run de parsing sans chunk restera sans chunk ; un candidat invalide l'est
 * par construction. Une sortie de modèle hors schéma, en revanche, peut être
 * différente au prochain appel : §27 autorise « retry borné si pertinent ».
 */
const PERMANENT_CODES = new Set<ExtractionErrorCode>(['EXTRACTION_EMPTY', 'CANDIDATE_INVALID']);

export class ExtractionError extends Error {
  readonly code: ExtractionErrorCode;
  /** Détail court et sûr à journaliser : jamais de contenu de document. */
  readonly detail: string | undefined;

  constructor(code: ExtractionErrorCode, message: string, detail?: string) {
    super(`${code} : ${message}`);
    this.name = 'ExtractionError';
    this.code = code;
    this.detail = detail;
  }

  get permanent(): boolean {
    return PERMANENT_CODES.has(this.code);
  }
}

export function isExtractionError(error: unknown): error is ExtractionError {
  return error instanceof ExtractionError;
}

/**
 * Candidat écarté après validation.
 *
 * §27 distingue deux échecs, et ce lot les traite différemment :
 *
 * - la **sortie ne respecte pas le schéma** — la réponse entière est rejetée,
 *   parce qu'on ne sait pas ce qu'on lit ;
 * - un **candidat viole une règle métier** — citation inconnue, extrait
 *   introuvable dans la preuve citée — seul ce candidat tombe, et les autres
 *   restent exploitables.
 *
 * Dans les deux cas rien n'est réparé : §27 interdit le « parse partiel
 * silencieux ». Un candidat écarté est compté et sa raison journalisée, pour
 * qu'un rejet massif se voie.
 */
export interface RejectedCandidate {
  readonly reason: 'unknown_evidence' | 'quote_not_found' | 'empty_value' | 'unusable_identity';
  /** Identité proposée, pour le journal. Jamais le contenu du document. */
  readonly subjectKey: string;
}
