import { describe, expect, it } from 'vitest';

import {
  DomainError,
  decideFactCandidate,
  publishFactCandidate,
  publishFactCommandSchema,
  refusalForTrustLevel,
  type FactReviewContext,
} from '../src/index.js';
import {
  CANDIDATE_ACCEPTED,
  CANDIDATE_CONFLICT,
  CANDIDATE_NEW,
  CANDIDATE_NO_EVIDENCE,
  baseFactState,
  createFactRepositoriesFake,
  type FactFakeState,
} from './fixtures/fact-repositories.js';
import { EDITOR_A, ORG_A, OUTSIDER, PLUKA_ADMIN, VIEWER_A } from './fixtures/repositories.js';

/**
 * Publication d'un fact — SOURCES_EXTRACTION §25, §30, §31, §32, §34, §38.
 *
 * Ces tests portent sur ce que le use case *décide*. Ce qu'il décide n'est
 * jamais ce qui protège la donnée : la migration 0012 refuse indépendamment
 * toute publication anonyme ou non autorisée, et le fichier pgTAP 09 le
 * prouve en attaquant la table directement. Ici on vérifie que le refus
 * arrive tôt, et qu'il est lisible.
 */

function contextFor(userId: string, state: FactFakeState): FactReviewContext {
  return { repositories: createFactRepositoriesFake(state, userId), actor: { userId } };
}

async function failure(promise: Promise<unknown>): Promise<DomainError> {
  const error = await promise.catch((thrown: unknown) => thrown);

  if (!(error instanceof DomainError)) throw new Error('une DomainError était attendue');

  return error;
}

// ============================================================
// §32 et §4.2 — qui confère quel niveau
// ============================================================

describe('niveaux de confiance', () => {
  it("réserve « officielle » à l'organisation gestionnaire", () => {
    // §32 : PLUKA « ne peut pas se substituer silencieusement à l'organisateur
    // pour qualifier une décision d'"Officielle" ».
    expect(
      refusalForTrustLevel({ isPlatformAdmin: true, organizationRole: null }, 'official'),
    ).toBe('OFFICIAL_AUTHORIZATION_REQUIRED');

    expect(
      refusalForTrustLevel({ isPlatformAdmin: false, organizationRole: 'editor' }, 'official'),
    ).toBeNull();
  });

  it("autorise un admin PLUKA qui est aussi membre de l'organisation", () => {
    // Il publie alors au titre de son appartenance : c'est bien
    // l'organisation qui confère le niveau, par une personne qui la représente.
    expect(
      refusalForTrustLevel({ isPlatformAdmin: true, organizationRole: 'editor' }, 'official'),
    ).toBeNull();
  });

  it('refuse « officielle » à un rôle viewer', () => {
    expect(
      refusalForTrustLevel({ isPlatformAdmin: false, organizationRole: 'viewer' }, 'official'),
    ).toBe('OFFICIAL_AUTHORIZATION_REQUIRED');
  });

  it('réserve « validée PLUKA » à PLUKA', () => {
    // §4.2 : c'est une vérification faite par PLUKA. Une organisation ne se
    // décerne pas le label d'un tiers.
    expect(
      refusalForTrustLevel(
        { isPlatformAdmin: false, organizationRole: 'owner' },
        'pluka_validated',
      ),
    ).toBe('PLUKA_VALIDATION_REQUIRED');

    expect(
      refusalForTrustLevel({ isPlatformAdmin: true, organizationRole: null }, 'pluka_validated'),
    ).toBeNull();
  });
});

// ============================================================
// §25, §30 — aucune publication sans acte humain autorisé
// ============================================================

describe('autorité de publication', () => {
  it("refuse un utilisateur sans lien avec l'organisation", async () => {
    const state = baseFactState({ invisibleTo: [OUTSIDER] });

    const error = await failure(
      publishFactCandidate(contextFor(OUTSIDER, state), {
        candidateId: CANDIDATE_NEW,
        trustLevel: 'official',
        resolveConflict: false,
      }),
    );

    // §120 : un candidat qu'on n'a pas le droit de voir revient absent.
    // Répondre « interdit » confirmerait son existence.
    expect(error.code).toBe('not_found');
    expect(state.published).toEqual([]);
  });

  it('refuse un rôle viewer', async () => {
    const state = baseFactState();

    const error = await failure(
      publishFactCandidate(contextFor(VIEWER_A, state), {
        candidateId: CANDIDATE_NEW,
        trustLevel: 'official',
        resolveConflict: false,
      }),
    );

    expect(error.code).toBe('forbidden');
    expect(state.published).toEqual([]);
  });

  it('refuse « officielle » à un admin PLUKA non membre, et le dit', async () => {
    const state = baseFactState();

    const error = await failure(
      publishFactCandidate(contextFor(PLUKA_ADMIN, state), {
        candidateId: CANDIDATE_NEW,
        trustLevel: 'official',
        resolveConflict: false,
      }),
    );

    expect(error.code).toBe('forbidden');
    expect(error.details.reason).toBe('OFFICIAL_AUTHORIZATION_REQUIRED');
    expect(state.published).toEqual([]);
  });

  it('laisse un admin PLUKA publier « validée PLUKA »', async () => {
    const state = baseFactState();

    const result = await publishFactCandidate(contextFor(PLUKA_ADMIN, state), {
      candidateId: CANDIDATE_NEW,
      trustLevel: 'pluka_validated',
      resolveConflict: false,
    });

    expect(result.trustLevel).toBe('pluka_validated');
    expect(state.published).toHaveLength(1);
  });

  it("publie sous l'identité de la session, jamais sous une identité déclarée", async () => {
    // L'acteur vient du contexte. La commande n'a aucun champ pour le
    // désigner, et le schéma est strict : en ajouter un est rejeté.
    const state = baseFactState();

    await publishFactCandidate(contextFor(EDITOR_A, state), {
      candidateId: CANDIDATE_NEW,
      trustLevel: 'official',
      resolveConflict: false,
    });

    expect(state.published[0]?.actorUserId).toBe(EDITOR_A);

    expect(
      publishFactCommandSchema.safeParse({
        candidateId: CANDIDATE_NEW,
        trustLevel: 'official',
        actorUserId: PLUKA_ADMIN,
      }).success,
    ).toBe(false);
  });

  it("ne laisse pas l'appelant choisir l'action journalisée", () => {
    // §31 : `edit_and_publish` se constate, il ne se déclare pas. C'est la
    // présence d'une valeur corrigée qui le décide, en base.
    expect(
      publishFactCommandSchema.safeParse({
        candidateId: CANDIDATE_NEW,
        trustLevel: 'official',
        action: 'publish',
      }).success,
    ).toBe(false);
  });
});

// ============================================================
// §34, §38 — invariants avant écriture
// ============================================================

describe('invariants de publication', () => {
  it('refuse un candidat sans preuve', async () => {
    // §20 et §34 : une version publiée doit pouvoir revenir à sa preuve.
    const state = baseFactState();

    const error = await failure(
      publishFactCandidate(contextFor(EDITOR_A, state), {
        candidateId: CANDIDATE_NO_EVIDENCE,
        trustLevel: 'official',
        resolveConflict: false,
      }),
    );

    expect(error.code).toBe('invalid_state');
    expect(error.details.reason).toBe('FACT_SOURCE_MISSING');
    expect(state.published).toEqual([]);
  });

  it('refuse de publier par-dessus un conflit sans le dire', async () => {
    // §38 : « il ne choisit pas automatiquement une valeur ».
    const state = baseFactState();

    const error = await failure(
      publishFactCandidate(contextFor(EDITOR_A, state), {
        candidateId: CANDIDATE_CONFLICT,
        trustLevel: 'official',
        resolveConflict: false,
      }),
    );

    expect(error.code).toBe('conflict');
    expect(error.details.reason).toBe('FACT_CONFLICT_UNRESOLVED');
    expect(state.published).toEqual([]);
  });

  it('publie un conflit résolu explicitement', async () => {
    // §40 : la résolution crée une nouvelle version, et peut corriger la valeur.
    const state = baseFactState();

    const result = await publishFactCandidate(contextFor(EDITOR_A, state), {
      candidateId: CANDIDATE_CONFLICT,
      trustLevel: 'official',
      valueText: 'Veste imperméable à coutures étanchées',
      note: 'le règlement fait foi',
      resolveConflict: true,
    });

    expect(result.action).toBe('edit_and_publish');
    expect(state.published[0]?.resolveConflict).toBe(true);
    expect(state.published[0]?.note).toBe('le règlement fait foi');
  });

  it('refuse de republier un candidat déjà tranché', async () => {
    // §25 : republier créerait une seconde version identique sans décision
    // nouvelle.
    const state = baseFactState();

    const error = await failure(
      publishFactCandidate(contextFor(EDITOR_A, state), {
        candidateId: CANDIDATE_ACCEPTED,
        trustLevel: 'official',
        resolveConflict: false,
      }),
    );

    expect(error.code).toBe('invalid_state');
    expect(state.published).toEqual([]);
  });

  it('refuse une valeur vide', () => {
    expect(
      publishFactCommandSchema.safeParse({
        candidateId: CANDIDATE_NEW,
        trustLevel: 'official',
        valueText: '   ',
      }).success,
    ).toBe(false);
  });
});

// ============================================================
// §31 — les décisions qui ne publient pas
// ============================================================

describe('décisions de revue', () => {
  it('rejette un candidat, sans rien publier', async () => {
    const state = baseFactState();

    const status = await decideFactCandidate(contextFor(EDITOR_A, state), {
      candidateId: CANDIDATE_NEW,
      decision: 'reject',
      note: 'information non confirmée',
    });

    expect(status).toBe('rejected');
    expect(state.published).toEqual([]);
    expect(state.decided[0]).toMatchObject({ actorUserId: EDITOR_A, action: 'reject' });
  });

  it('marque un doublon', async () => {
    const state = baseFactState();

    expect(
      await decideFactCandidate(contextFor(EDITOR_A, state), {
        candidateId: CANDIDATE_CONFLICT,
        decision: 'mark_duplicate',
      }),
    ).toBe('duplicate');
  });

  it('ne dépublie pas en rejetant après coup', async () => {
    // §37 : « une information publiée ne doit pas disparaître uniquement parce
    // qu'elle n'a pas été réextraite ». Le retrait passe par une version.
    const state = baseFactState();

    const error = await failure(
      decideFactCandidate(contextFor(EDITOR_A, state), {
        candidateId: CANDIDATE_ACCEPTED,
        decision: 'reject',
      }),
    );

    expect(error.code).toBe('invalid_state');
    expect(state.decided).toEqual([]);
  });

  it("refuse une décision à qui n'a pas autorité", async () => {
    const state = baseFactState();

    const error = await failure(
      decideFactCandidate(contextFor(VIEWER_A, state), {
        candidateId: CANDIDATE_NEW,
        decision: 'reject',
      }),
    );

    expect(error.code).toBe('forbidden');
    expect(state.decided).toEqual([]);
  });

  it("n'accepte aucune décision hors des cinq de §31", () => {
    const state = baseFactState();

    return expect(
      decideFactCandidate(contextFor(EDITOR_A, state), {
        candidateId: CANDIDATE_NEW,
        // `publish` n'est pas une décision de ce use case : publier suit un
        // autre chemin, avec ses invariants.
        decision: 'publish' as never,
      }),
    ).rejects.toThrow();
  });
});

// ============================================================
// Autorité relue en base
// ============================================================

describe('résolution de l’autorité', () => {
  it("relit le rôle en base, sans jamais le recevoir de l'appelant", async () => {
    // 03_PRIVACY_RLS §178. Retirer l'appartenance suffit à faire tomber le
    // droit, sans que rien d'autre change dans l'appel.
    const state = baseFactState({ memberships: [] });

    const error = await failure(
      publishFactCandidate(contextFor(EDITOR_A, state), {
        candidateId: CANDIDATE_NEW,
        trustLevel: 'official',
        resolveConflict: false,
      }),
    );

    expect(error.code).toBe('forbidden');
  });

  it("lit l'appartenance de l'organisation gestionnaire du candidat", async () => {
    // La course n'est pas reçue de l'appelant : elle vient du candidat. Une
    // appartenance à une autre organisation ne donne donc rien.
    const state = baseFactState({
      memberships: [
        { organizationId: 'ffffffff-0000-4000-8000-000000000001', userId: EDITOR_A, role: 'owner' },
      ],
    });

    const error = await failure(
      publishFactCandidate(contextFor(EDITOR_A, state), {
        candidateId: CANDIDATE_NEW,
        trustLevel: 'official',
        resolveConflict: false,
      }),
    );

    expect(error.code).toBe('forbidden');
    expect(ORG_A).not.toBe('ffffffff-0000-4000-8000-000000000001');
  });
});
