import { z } from 'zod';

/**
 * Commandes de revue et de publication — SOURCES_EXTRACTION §30, §31, §40.
 *
 * Aucune commande ne porte de `raceId` ni de rôle. La course est déduite du
 * candidat, et l'autorité est relue en base : les deux règles ferment la même
 * porte — celle d'un appelant qui désignerait une portée sur laquelle il a des
 * droits pour agir sur un objet qui appartient à une autre
 * (03_PRIVACY_RLS §11, §178).
 */

const uuid = z.uuid();

/** Note interne de revue — §40 point 7. Bornée : c'est une note, pas un dossier. */
const note = z.string().trim().min(1).max(1000);

/**
 * Niveaux de confiance publiables — §4.
 *
 * `community` figure dans l'enum SQL et décrit une information issue d'un
 * participant (§4.3). Publier depuis la revue d'extraction produit au minimum
 * une information vérifiée : le niveau communautaire n'a pas de sens ici, et
 * §4.3 interdit de toute façon de le promouvoir automatiquement.
 */
export const PUBLISHABLE_TRUST_LEVELS = ['official', 'pluka_validated'] as const;

export type PublishableTrustLevel = (typeof PUBLISHABLE_TRUST_LEVELS)[number];

/**
 * Valeur publiée.
 *
 * Fournir une valeur transforme `publish` en `edit_and_publish` : §31 veut
 * qu'« une modification manuelle avant publication soit auditée », et la
 * distinction se fait sur ce seul fait — l'humain a-t-il corrigé, oui ou non.
 */
export const publishFactCommandSchema = z.strictObject({
  candidateId: uuid,
  trustLevel: z.enum(PUBLISHABLE_TRUST_LEVELS),
  valueText: z.string().trim().min(1).max(4000).nullish(),
  valueNumber: z.number().finite().nullish(),
  valueJson: z.record(z.string(), z.unknown()).nullish(),
  unit: z.string().trim().min(1).max(20).nullish(),
  note: note.nullish(),
  /**
   * Résolution explicite d'un conflit — §38, §40.
   *
   * Par défaut faux : §38 dit que le système « ne choisit pas automatiquement
   * une valeur », et publier par-dessus une valeur contradictoire sans le dire
   * reviendrait à choisir pour l'humain.
   */
  resolveConflict: z.boolean().default(false),
});

export type PublishFactCommand = z.infer<typeof publishFactCommandSchema>;

/** §31 : les décisions qui ne publient rien. */
export const REVIEW_DECISIONS = ['reject', 'mark_duplicate', 'needs_review'] as const;

export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const decideFactCandidateCommandSchema = z.strictObject({
  candidateId: uuid,
  decision: z.enum(REVIEW_DECISIONS),
  note: note.nullish(),
});

export type DecideFactCandidateCommand = z.infer<typeof decideFactCandidateCommandSchema>;

export const listCandidatesForReviewQuerySchema = z.strictObject({
  raceId: uuid,
  limit: z.number().int().min(1).max(500).default(100),
});

export type ListCandidatesForReviewQuery = z.infer<typeof listCandidatesForReviewQuerySchema>;
