import type {
  FactCandidateReviewRecord,
  FactCandidateScopeRecord,
  FactRepositories,
  PublishedFactRecord,
} from '@pluka/db';

import type { Actor } from '../authorization/organization-role.js';
import { conflictError, forbiddenError, invalidStateError, notFoundError } from '../errors.js';
import {
  decideFactCandidateCommandSchema,
  listCandidatesForReviewQuerySchema,
  publishFactCommandSchema,
} from './commands.js';
import { canReviewFacts, refusalForTrustLevel, resolvePublicationAuthority } from './trust.js';

/**
 * Use cases de revue et de publication de facts — SOURCES_EXTRACTION §30 à §33.
 *
 * Chaque commande suit l'ordre de 01_ARCHITECTURE §7 : valider l'entrée,
 * vérifier l'autorisation, appliquer les invariants, écrire.
 *
 * Ce qui est décidé ici n'est jamais ce qui protège la donnée. La migration
 * 0012 refuse indépendamment toute publication anonyme, non autorisée, ou
 * qualifiée d'officielle par quelqu'un d'autre que l'organisation
 * gestionnaire. Le use case existe pour rendre le refus *lisible* — un
 * relecteur doit savoir qu'il lui manque une appartenance, pas recevoir une
 * erreur SQL — et pour appliquer les invariants de §31 et §38 avant de
 * consommer un aller-retour.
 *
 * Aucun chemin ici ne publie sans acteur : `context.actor` est requis, et la
 * base vérifie de son côté que cet acteur est bien celui de la session.
 */
export interface FactReviewContext {
  readonly repositories: FactRepositories;
  readonly actor: Actor;
}

/** États depuis lesquels une décision de revue est encore possible (§25, §31). */
const REVIEWABLE = new Set<FactCandidateScopeRecord['status']>([
  'detected',
  'needs_review',
  'conflict',
]);

/**
 * Charge la portée d'un candidat et vérifie l'autorité de l'acteur.
 *
 * La course n'est jamais reçue de l'appelant : elle est lue à partir du seul
 * identifiant de candidat. Sans cela, une commande pourrait désigner une
 * course sur laquelle son auteur a des droits pour agir sur un candidat qui
 * appartient à une autre.
 */
async function loadReviewScope(
  context: FactReviewContext,
  candidateId: string,
  useCase: string,
): Promise<{
  scope: FactCandidateScopeRecord;
  authority: Awaited<ReturnType<typeof resolvePublicationAuthority>>;
}> {
  const scope = await context.repositories.factReview.findCandidateScope(candidateId);

  // La lecture est elle-même filtrée en base : un candidat qu'on n'a pas le
  // droit de voir revient absent. §120 de 03_PRIVACY_RLS veut ce silence —
  // répondre « interdit » confirmerait son existence.
  if (scope === null) throw notFoundError(useCase, 'candidat');

  const authority = await resolvePublicationAuthority(
    context.repositories,
    context.actor,
    scope.organizationId,
  );

  if (!canReviewFacts(authority)) throw forbiddenError(useCase);

  return { scope, authority };
}

/**
 * L'écran de revue — §30.
 *
 * « La revue doit afficher : valeur proposée ; type ; source ; extrait ;
 * page / section ; anciennes valeurs ; contradictions ; action proposée. »
 */
export async function listCandidatesForReview(
  context: FactReviewContext,
  input: unknown,
): Promise<readonly FactCandidateReviewRecord[]> {
  const parsed = listCandidatesForReviewQuerySchema.parse(input);

  return context.repositories.factReview.listForReview(parsed.raceId, parsed.limit);
}

/**
 * Publier un candidat — §33.
 *
 * Les huit étapes sont exécutées par la base, en une transaction. Ce use case
 * décide *si* elles doivent l'être.
 */
export async function publishFactCandidate(
  context: FactReviewContext,
  input: unknown,
): Promise<PublishedFactRecord> {
  const useCase = 'publishFactCandidate';
  const parsed = publishFactCommandSchema.parse(input);

  const { scope, authority } = await loadReviewScope(context, parsed.candidateId, useCase);

  // §25 : un candidat déjà tranché ne se retranche pas. Republier créerait une
  // seconde version identique sans décision nouvelle.
  if (!REVIEWABLE.has(scope.status)) {
    throw invalidStateError(useCase, `candidat déjà tranché (${scope.status})`, {
      status: scope.status,
    });
  }

  // §20 et §34 : une version publiée doit pouvoir revenir à sa preuve.
  if (scope.evidenceCount === 0) {
    throw invalidStateError(useCase, 'candidat sans preuve', {
      reason: 'FACT_SOURCE_MISSING',
    });
  }

  // §38 : « il ne choisit pas automatiquement une valeur ». Publier par-dessus
  // une valeur contradictoire demande de le dire.
  if (scope.status === 'conflict' && !parsed.resolveConflict) {
    throw conflictError(useCase, 'ce candidat contredit une valeur publiée', {
      reason: 'FACT_CONFLICT_UNRESOLVED',
      publishedFactId: scope.matchedFactId ?? '',
    });
  }

  // §32 et §4.2.
  const refusal = refusalForTrustLevel(authority, parsed.trustLevel);

  if (refusal !== null) {
    throw forbiddenError(useCase, { reason: refusal, trustLevel: parsed.trustLevel });
  }

  return context.repositories.factReview.publish({
    candidateId: parsed.candidateId,
    actorUserId: context.actor.userId,
    trustLevel: parsed.trustLevel,
    valueText: parsed.valueText ?? null,
    valueNumber: parsed.valueNumber ?? null,
    valueJson: parsed.valueJson ?? null,
    unit: parsed.unit ?? null,
    note: parsed.note ?? null,
    resolveConflict: parsed.resolveConflict,
  });
}

/**
 * Rejeter, marquer doublon, renvoyer en revue — §31.
 *
 * Ces décisions ne créent aucune version. Elles sont journalisées au même
 * titre : un candidat écarté sans trace serait une décision invisible.
 */
export async function decideFactCandidate(
  context: FactReviewContext,
  input: unknown,
): Promise<FactCandidateScopeRecord['status']> {
  const useCase = 'decideFactCandidate';
  const parsed = decideFactCandidateCommandSchema.parse(input);

  const { scope } = await loadReviewScope(context, parsed.candidateId, useCase);

  // §37 : « une information publiée ne doit pas disparaître uniquement parce
  // qu'elle n'a pas été réextraite ». Rejeter après coup le candidat qui l'a
  // produite ne dépublie rien : le retrait passe par une nouvelle version.
  if (scope.status === 'accepted') {
    throw invalidStateError(useCase, 'candidat déjà publié', { status: scope.status });
  }

  if (!REVIEWABLE.has(scope.status)) {
    throw invalidStateError(useCase, `candidat déjà tranché (${scope.status})`, {
      status: scope.status,
    });
  }

  const status = await context.repositories.factReview.decide(
    parsed.candidateId,
    context.actor.userId,
    parsed.decision,
    parsed.note ?? null,
  );

  return status as FactCandidateScopeRecord['status'];
}
