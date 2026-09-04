import { z } from 'zod';

import { nonEmptyStringSchema } from '../primitives/ids.js';

/**
 * Contrat provider IA — `01_ARCHITECTURE.md` §14.2 et §28.
 *
 * L'IA sert à interpréter un document et à répondre à partir de preuves. Elle
 * ne publie jamais un fait, ne décide ni pacing, ni entitlement, ni règle de
 * sécurité (AGENTS §12, ACCEPTANCE AC-SRC-06). Un résultat obtenu ici est un
 * *candidat* : la publication reste un workflow humain.
 *
 * Les schémas propres à l'extraction de facts (candidats, catégories,
 * provenance) appartiennent à `packages/sources`
 * (SOURCES_EXTRACTION §56) : ce paquet ne décrit que la frontière provider.
 */
export const aiModelDescriptorSchema = z.object({
  provider: nonEmptyStringSchema,
  model: nonEmptyStringSchema,
  // Un prompt non versionné n'est pas auditable (SOURCES_EXTRACTION §26).
  promptVersion: nonEmptyStringSchema,
});

export type AIModelDescriptor = z.infer<typeof aiModelDescriptorSchema>;

/** Consommation d'un appel, pour la mesure de coût (01_ARCHITECTURE §34.3). */
export const aiUsageSchema = z.object({
  inputTokens: z.number().int().min(0).optional(),
  outputTokens: z.number().int().min(0).optional(),
  costEstimate: z.number().min(0).optional(),
});

export type AIUsage = z.infer<typeof aiUsageSchema>;

/**
 * Extraction structurée.
 *
 * L'appelant fournit le schéma attendu : c'est le domaine qui décide de la
 * forme, pas le modèle. L'adapter valide la sortie contre ce schéma et lève
 * `ProviderError('invalid_response')` si elle ne passe pas — jamais de parse
 * partiel, jamais de champ complété d'office (SOURCES_EXTRACTION §27).
 */
export interface AIStructuredExtractionRequest<T> {
  readonly instructions: string;
  /**
   * Contenu à interpréter. Contenu de source, donc non fiable : il ne peut pas
   * donner d'instruction exécutable au système (ACCEPTANCE AC-SRC-14).
   */
  readonly input: string;
  readonly schema: z.ZodType<T>;
  readonly schemaName: string;
  readonly maxOutputTokens?: number;
}

export interface AIStructuredExtractionResult<T> {
  readonly data: T;
  readonly model: AIModelDescriptor;
  readonly usage: AIUsage | null;
}

/** Une preuve soumise au modèle. L'identifiant permet de recomposer la citation. */
export const aiEvidenceSchema = z.object({
  evidenceId: nonEmptyStringSchema,
  content: nonEmptyStringSchema,
});

export type AIEvidence = z.infer<typeof aiEvidenceSchema>;

export interface AIGroundedAnswerRequest {
  readonly question: string;
  readonly evidence: readonly AIEvidence[];
  readonly maxOutputTokens?: number;
}

/**
 * Réponse sourcée.
 *
 * `not_found` est un résultat de plein droit : sans information fiable dans les
 * preuves fournies, PLUKA répond qu'il ne l'a pas trouvée plutôt que d'inventer
 * (01_ARCHITECTURE §19, ACCEPTANCE AC-ASK-02).
 */
export const aiGroundedAnswerSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('answered'),
    text: nonEmptyStringSchema,
    citedEvidenceIds: z.array(nonEmptyStringSchema).min(1),
  }),
  z.object({
    status: z.literal('not_found'),
  }),
]);

export type AIGroundedAnswer = z.infer<typeof aiGroundedAnswerSchema>;

export interface AIGroundedAnswerResult {
  readonly answer: AIGroundedAnswer;
  readonly model: AIModelDescriptor;
  readonly usage: AIUsage | null;
}

export interface AIProvider {
  readonly name: string;

  extractStructured<T>(
    request: AIStructuredExtractionRequest<T>,
  ): Promise<AIStructuredExtractionResult<T>>;

  answerFromEvidence(request: AIGroundedAnswerRequest): Promise<AIGroundedAnswerResult>;
}
