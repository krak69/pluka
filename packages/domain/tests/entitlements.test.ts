import { beforeEach, describe, expect, it } from 'vitest';

import {
  authorizeCapability,
  can,
  CAPABILITIES,
  capabilitiesForTier,
  capabilitiesMissingFromPlus,
  consumeLinkedOutingQuota,
  DomainError,
  EntitlementError,
  LINKED_OUTING_QUOTA,
  linkedOutingUsageKey,
  resolveEntitlements,
  TIERS_BY_PRIORITY,
  type Capability,
  type EntitlementServiceContext,
} from '../src/index.js';
import {
  createFakeEntitlementRepositories,
  entitlementBaseState,
  grantBeta,
  grantEntitlement,
  type EntitlementState,
} from './fixtures/entitlement-repositories.js';
import {
  participationBaseState,
  PUBLIC_RACE,
  RUNNER_A,
  RUNNER_B,
  seedParticipation,
  UNLISTED_RACE,
} from './fixtures/participation-repositories.js';

/**
 * Entitlements — 04_ENTITLEMENTS.
 *
 * Les tests suivent la nomenclature de §107 à §116 (E01…E31). Ceux qui portent
 * sur le paiement (E22 à E25) n'ont pas de producteur dans ce lot : aucun
 * checkout, aucun webhook n'y existe.
 */

const NOW = new Date('2026-03-01T10:00:00.000Z');

let state: EntitlementState;
/** Participation de Runner A sur la course publique — le scope de référence. */
let ownParticipation: string;
/** Sa seconde participation, pour éprouver le scope (E03, E20). */
let otherParticipation: string;
/** Participation de Runner B — jamais la sienne (E29). */
let foreignParticipation: string;

function contextFor(
  userId: string,
  overrides: Partial<EntitlementServiceContext> = {},
): EntitlementServiceContext {
  return {
    repositories: createFakeEntitlementRepositories(state),
    actor: { userId },
    now: () => NOW,
    ...overrides,
  };
}

async function decisionFor(
  capability: Capability,
  participantRaceId: string | null = ownParticipation,
  userId: string = RUNNER_A,
) {
  const resolved = await resolveEntitlements(contextFor(userId), { participantRaceId });

  return can(resolved, capability);
}

async function expectEntitlementError(
  promise: Promise<unknown>,
  code: EntitlementError['code'],
): Promise<EntitlementError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );

  expect(error, 'la commande aurait dû échouer').toBeInstanceOf(EntitlementError);
  expect((error as EntitlementError).code).toBe(code);

  return error as EntitlementError;
}

beforeEach(() => {
  const participation = participationBaseState();

  ownParticipation = seedParticipation(participation, {
    userId: RUNNER_A,
    raceId: PUBLIC_RACE,
  }).id;
  otherParticipation = seedParticipation(participation, {
    userId: RUNNER_A,
    raceId: UNLISTED_RACE,
  }).id;
  foreignParticipation = seedParticipation(participation, {
    userId: RUNNER_B,
    raceId: PUBLIC_RACE,
  }).id;

  state = entitlementBaseState(participation);
});

// ============================================================
// La matrice, telle que §56 à §61 la posent
// ============================================================

describe('capabilities (§56)', () => {
  it('est centralisée et ne contient rien de B2B (§62, E27)', () => {
    // « Les droits du BO organisateur ne doivent pas utiliser les tiers B2C. »
    // Race Intelligence est une fonctionnalité organisation derrière un feature
    // flag : aucun entitlement B2C ne peut l'activer, puisqu'elle n'est pas une
    // capability.
    expect(CAPABILITIES as readonly string[]).not.toContain('race_intelligence');
    expect(CAPABILITIES.filter((capability) => capability.includes('intelligence'))).toEqual([]);
  });

  it('sépare lecture et écriture partout où §55 le demande', () => {
    for (const family of ['nutrition', 'preparation', 'assistance', 'postrace', 'library']) {
      const read = CAPABILITIES.filter(
        (capability) => capability.startsWith(`${family}.`) && capability.includes('read'),
      );
      const write = CAPABILITIES.filter(
        (capability) =>
          capability.startsWith(`${family}.`) &&
          (capability.includes('edit') || capability.includes('share')),
      );

      expect(read.length, `${family} : aucune capability de lecture`).toBeGreaterThan(0);
      expect(write.length, `${family} : aucune capability d'écriture`).toBeGreaterThan(0);
    }
  });

  it('donne tout §56 à PLUKA+ (§59)', () => {
    expect(capabilitiesMissingFromPlus()).toEqual([]);
  });

  it('ordonne les droits comme §19', () => {
    expect([...TIERS_BY_PRIORITY]).toEqual([
      'beta',
      'plus',
      'organizer_included',
      'race_pass',
      'free',
    ]);
  });

  it('donne à Organizer Included le même socle que Race Pass (§60)', () => {
    expect([...capabilitiesForTier('organizer_included')].sort()).toEqual(
      [...capabilitiesForTier('race_pass')].sort(),
    );
  });

  it('réserve à PLUKA+ ce que §12 exclut d’Organizer Included', () => {
    // « Il ne donne pas : sorties personnelles illimitées ; premium sur les
    // autres courses ; toute la mémoire PLUKA+. »
    for (const capability of [
      'outing.create_personal',
      'season.memory',
      'strategy.reuse',
      'library.edit',
    ] as const) {
      expect(capabilitiesForTier('organizer_included').has(capability)).toBe(false);
      expect(capabilitiesForTier('plus').has(capability)).toBe(true);
    }
  });
});

// ============================================================
// E01 à E05 — les quatre niveaux
// ============================================================

describe('E01 — Free', () => {
  it('lit la course, ses sources et ses alertes officielles (§39, §82, §83)', async () => {
    for (const capability of [
      'course.read',
      'course.sources.read',
      'course.official_notices.read',
      'course.mandatory_equipment.read',
    ] as const) {
      await expect(decisionFor(capability)).resolves.toMatchObject({
        allowed: true,
        reason: 'free_included',
      });
    }
  });

  it('consulte le Plan initial mais ne l’édite pas (§41, §42)', async () => {
    await expect(decisionFor('plan.read')).resolves.toMatchObject({ allowed: true });
    await expect(decisionFor('plan.generate_initial')).resolves.toMatchObject({ allowed: true });
    await expect(decisionFor('plan.edit')).resolves.toMatchObject({
      allowed: false,
      reason: 'not_entitled',
    });
    await expect(decisionFor('plan.recalculate')).resolves.toMatchObject({ allowed: false });
  });

  it('n’a ni Nutrition, ni Conditions, ni sorties (§44, §57)', async () => {
    for (const capability of [
      'nutrition.edit',
      'conditions.race.read',
      'outing.create_linked',
      'outing.create_personal',
      'strategy.reuse',
      'season.memory',
    ] as const) {
      await expect(decisionFor(capability)).resolves.toMatchObject({ allowed: false });
    }
  });

  it('n’a aucune ligne d’entitlement : Free est implicite (§8)', async () => {
    const resolved = await resolveEntitlements(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
    });

    expect(state.entitlements).toEqual([]);
    expect(resolved.effectiveTier).toBe('free');
    expect(resolved.sourceEntitlements).toEqual([]);
  });
});

describe('E02 / E03 — Race Pass et son scope', () => {
  beforeEach(() => {
    grantEntitlement(state, {
      kind: 'race_pass',
      userId: RUNNER_A,
      participantRaceId: ownParticipation,
    });
  });

  it('E02 — ouvre le premium sur la course couverte', async () => {
    for (const capability of [
      'plan.edit',
      'plan.recalculate',
      'nutrition.edit',
      'preparation.edit_advanced',
      'assistance.edit',
      'assistance.share',
      'conditions.race.read',
      'postrace.edit_advanced',
    ] as const) {
      await expect(decisionFor(capability)).resolves.toMatchObject({
        allowed: true,
        reason: 'race_pass',
      });
    }
  });

  it('E03 — répond wrong_scope sur une autre course (§9, §10)', async () => {
    const decision = await decisionFor('plan.edit', otherParticipation);

    expect(decision).toEqual({
      allowed: false,
      reason: 'wrong_scope',
      sourceEntitlementId: null,
    });
  });

  it('n’ouvre pas les capacités réservées à PLUKA+ (§58)', async () => {
    for (const capability of [
      'outing.create_personal',
      'strategy.reuse',
      'season.memory',
      'library.edit',
    ] as const) {
      await expect(decisionFor(capability)).resolves.toMatchObject({ allowed: false });
    }
  });

  it('nomme la source du droit (§18)', async () => {
    const decision = await decisionFor('nutrition.edit');

    expect(decision.sourceEntitlementId).toBe(state.entitlements[0]?.id);
  });
});

describe('E04 — PLUKA+', () => {
  beforeEach(() => {
    grantEntitlement(state, { kind: 'plus', userId: RUNNER_A });
  });

  it('ouvre le premium sur n’importe quelle course (§11)', async () => {
    for (const scope of [ownParticipation, otherParticipation]) {
      await expect(decisionFor('plan.edit', scope)).resolves.toMatchObject({
        allowed: true,
        reason: 'plus',
      });
    }
  });

  it('ouvre les sorties personnelles et la bibliothèque (§59)', async () => {
    for (const capability of [
      'outing.create_personal',
      'library.edit',
      'strategy.reuse',
      'season.memory',
    ] as const) {
      await expect(decisionFor(capability)).resolves.toMatchObject({ allowed: true });
    }
  });

  it('vaut aussi hors de toute course pour ce qui n’est pas scopé', async () => {
    await expect(decisionFor('outing.create_personal', null)).resolves.toMatchObject({
      allowed: true,
    });
  });
});

describe('E05 / E20 — Organizer Included', () => {
  beforeEach(() => {
    grantEntitlement(state, {
      kind: 'organizer_included',
      userId: RUNNER_A,
      participantRaceId: ownParticipation,
      source: 'organization',
      organizationId: 'aaaaaaaa-0000-4000-8000-000000000001',
    });
  });

  it('E05 — ouvre le premium sur la seule course couverte', async () => {
    await expect(decisionFor('nutrition.edit')).resolves.toMatchObject({
      allowed: true,
      reason: 'organizer_included',
    });
  });

  it('E20 — ne s’applique pas à une autre course (§12)', async () => {
    await expect(decisionFor('nutrition.edit', otherParticipation)).resolves.toMatchObject({
      allowed: false,
      reason: 'wrong_scope',
    });
  });

  it('ne donne pas les sorties personnelles (§12)', async () => {
    await expect(decisionFor('outing.create_personal')).resolves.toMatchObject({
      allowed: false,
    });
  });
});

// ============================================================
// E06 à E08 — cumul
// ============================================================

describe('cumul de droits (§20, §21)', () => {
  it('E06 — Race Pass + PLUKA+ : le tier effectif est PLUS', async () => {
    grantEntitlement(state, {
      kind: 'race_pass',
      userId: RUNNER_A,
      participantRaceId: ownParticipation,
    });
    grantEntitlement(state, { kind: 'plus', userId: RUNNER_A });

    const resolved = await resolveEntitlements(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
    });

    expect(resolved.effectiveTier).toBe('plus');
    expect(resolved.participantRaceAccess.racePass).toBe(true);
    expect(resolved.globalAccess.plus).toBe(true);
    // §21 : « le Race Pass reste dans l'historique » — il n'est pas écrasé.
    expect(resolved.sourceEntitlements).toHaveLength(2);
  });

  it('E07 — Organizer Included + PLUKA+ : PLUS ne perd rien (§20)', async () => {
    grantEntitlement(state, {
      kind: 'organizer_included',
      userId: RUNNER_A,
      participantRaceId: ownParticipation,
      source: 'organization',
    });
    grantEntitlement(state, { kind: 'plus', userId: RUNNER_A });

    const resolved = await resolveEntitlements(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
    });

    expect(resolved.effectiveTier).toBe('plus');
    expect(can(resolved, 'outing.create_personal').allowed).toBe(true);
  });

  it('E08 — bêta global vaut PLUKA+ le temps du test (§61)', async () => {
    grantBeta(state, { userId: RUNNER_A, scopeType: 'global' });

    const resolved = await resolveEntitlements(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
    });

    expect(resolved.effectiveTier).toBe('beta');
    expect(can(resolved, 'outing.create_personal')).toMatchObject({
      allowed: true,
      reason: 'beta_access',
    });
  });

  it('E08 — bêta limité à une course vaut Race Pass, pas PLUKA+ (§61)', async () => {
    grantBeta(state, {
      userId: RUNNER_A,
      scopeType: 'participant_race',
      participantRaceId: ownParticipation,
    });

    const resolved = await resolveEntitlements(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
    });

    expect(can(resolved, 'nutrition.edit').allowed).toBe(true);
    expect(can(resolved, 'outing.create_personal').allowed).toBe(false);
  });

  it('n’attribue jamais un grant bêta à une source commerciale (§14, §61)', async () => {
    grantBeta(state, { userId: RUNNER_A, scopeType: 'global' });

    const resolved = await resolveEntitlements(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
    });

    expect(resolved.sourceEntitlements).toEqual([]);
  });
});

// ============================================================
// E09, E10, E31 — validité dans le temps
// ============================================================

describe('validité (§22, §23, §24)', () => {
  it('E09 — un PLUKA+ expiré refuse les nouvelles actions premium', async () => {
    grantEntitlement(state, {
      kind: 'plus',
      userId: RUNNER_A,
      startsAt: '2025-01-01T00:00:00.000Z',
      endsAt: '2026-01-01T00:00:00.000Z',
    });

    await expect(decisionFor('plan.edit')).resolves.toMatchObject({
      allowed: false,
      reason: 'expired',
    });
  });

  it('E31 — mais laisse relire ce qui a été créé (§53, §54)', async () => {
    grantEntitlement(state, {
      kind: 'plus',
      userId: RUNNER_A,
      endsAt: '2026-01-01T00:00:00.000Z',
    });

    await expect(decisionFor('nutrition.read')).resolves.toMatchObject({ allowed: true });
    await expect(decisionFor('outing.read')).resolves.toMatchObject({ allowed: true });
    await expect(decisionFor('nutrition.edit')).resolves.toMatchObject({
      allowed: false,
      reason: 'expired',
    });
  });

  it('E10 — un Race Pass sans fin reste attaché à sa participation (§51)', async () => {
    grantEntitlement(state, {
      kind: 'race_pass',
      userId: RUNNER_A,
      participantRaceId: ownParticipation,
      startsAt: '2025-06-01T00:00:00.000Z',
      endsAt: null,
    });

    await expect(decisionFor('postrace.edit_advanced')).resolves.toMatchObject({ allowed: true });
  });

  it('refuse un droit révoqué, et le dit (§24)', async () => {
    grantEntitlement(state, {
      kind: 'race_pass',
      userId: RUNNER_A,
      participantRaceId: ownParticipation,
      status: 'revoked',
      revokedAt: '2026-02-01T00:00:00.000Z',
    });

    await expect(decisionFor('plan.edit')).resolves.toMatchObject({
      allowed: false,
      reason: 'revoked',
    });
  });

  it('refuse une ligne dont seule la date de révocation est posée', async () => {
    // Le statut n'a pas encore été mis à jour : la révocation prime quand même.
    grantEntitlement(state, {
      kind: 'plus',
      userId: RUNNER_A,
      status: 'active',
      revokedAt: '2026-02-01T00:00:00.000Z',
    });

    await expect(decisionFor('plan.edit')).resolves.toMatchObject({ reason: 'revoked' });
  });

  it('expire sur les dates même quand le statut dit encore « active »', async () => {
    // Sinon un droit dépendrait du passage d'un job de maintenance.
    grantEntitlement(state, {
      kind: 'plus',
      userId: RUNNER_A,
      status: 'active',
      endsAt: '2026-02-01T00:00:00.000Z',
    });

    await expect(decisionFor('plan.edit')).resolves.toMatchObject({ reason: 'expired' });
  });

  it('n’ouvre rien avant sa date de début', async () => {
    grantEntitlement(state, {
      kind: 'plus',
      userId: RUNNER_A,
      startsAt: '2026-06-01T00:00:00.000Z',
    });

    // Rien ne s'est encore passé : ce n'est ni expiré ni révoqué.
    await expect(decisionFor('plan.edit')).resolves.toMatchObject({
      allowed: false,
      reason: 'not_entitled',
    });
  });
});

// ============================================================
// E11 à E15, E21 — quota de sorties liées
// ============================================================

describe('quota de sorties liées (§27 à §34)', () => {
  beforeEach(() => {
    grantEntitlement(state, {
      kind: 'race_pass',
      userId: RUNNER_A,
      participantRaceId: ownParticipation,
    });
  });

  it('E11 — Race Pass sans sortie : 2 restantes', async () => {
    await expect(decisionFor('outing.create_linked')).resolves.toMatchObject({
      allowed: true,
      reason: 'quota_available',
      limits: { max: LINKED_OUTING_QUOTA, used: 0, remaining: 2 },
    });
  });

  it('E12 — une sortie consommée : 1 restante', async () => {
    await consumeLinkedOutingQuota(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      outingId: 'eeee1111-0000-4000-8000-000000000001',
    });

    await expect(decisionFor('outing.create_linked')).resolves.toMatchObject({
      limits: { used: 1, remaining: 1 },
    });
  });

  it('E13 / E21 — deux sorties : quota épuisé', async () => {
    for (const outingId of [
      'eeee1111-0000-4000-8000-000000000001',
      'eeee1111-0000-4000-8000-000000000002',
    ]) {
      await consumeLinkedOutingQuota(contextFor(RUNNER_A), {
        participantRaceId: ownParticipation,
        outingId,
      });
    }

    await expect(decisionFor('outing.create_linked')).resolves.toMatchObject({
      allowed: false,
      reason: 'quota_exceeded',
      limits: { max: 2, used: 2, remaining: 0 },
    });

    await expectEntitlementError(
      consumeLinkedOutingQuota(contextFor(RUNNER_A), {
        participantRaceId: ownParticipation,
        outingId: 'eeee1111-0000-4000-8000-000000000003',
      }),
      'QUOTA_EXCEEDED',
    );
  });

  it('E14 — le ledger conserve la consommation d’une sortie supprimée (§32)', async () => {
    const outingId = 'eeee1111-0000-4000-8000-000000000001';

    await consumeLinkedOutingQuota(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      outingId,
    });

    // La sortie disparaît ; le ledger, lui, ne bouge pas — sans quoi le cycle
    // « créer → utiliser la météo → supprimer → recréer » contournerait le
    // quota indéfiniment.
    state.participation.participants = state.participation.participants.filter(
      (row) => row.id !== outingId,
    );

    await expect(decisionFor('outing.create_linked')).resolves.toMatchObject({
      limits: { used: 1, remaining: 1 },
    });
    expect(state.usage).toHaveLength(1);
  });

  it('ne consomme qu’une fois pour la même sortie (§34)', async () => {
    const outingId = 'eeee1111-0000-4000-8000-000000000001';
    const command = { participantRaceId: ownParticipation, outingId };

    const first = await consumeLinkedOutingQuota(contextFor(RUNNER_A), command);
    const replay = await consumeLinkedOutingQuota(contextFor(RUNNER_A), command);

    expect(first.limits).toMatchObject({ used: 1, remaining: 1 });
    expect(replay.limits).toMatchObject({ used: 1, remaining: 1 });
    expect(state.usage).toHaveLength(1);
    expect(state.usage[0]?.usageKey).toBe(linkedOutingUsageKey(outingId));
  });

  it('rattache la consommation au droit qui l’autorise (§33)', async () => {
    await consumeLinkedOutingQuota(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      outingId: 'eeee1111-0000-4000-8000-000000000001',
    });

    expect(state.usage[0]?.entitlementId).toBe(state.entitlements[0]?.id);
    expect(state.usage[0]?.capability).toBe('outing.create_linked');
  });

  it('compte le quota par participation, pas par utilisateur', async () => {
    grantEntitlement(state, {
      kind: 'race_pass',
      userId: RUNNER_A,
      participantRaceId: otherParticipation,
    });

    await consumeLinkedOutingQuota(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      outingId: 'eeee1111-0000-4000-8000-000000000001',
    });

    await expect(decisionFor('outing.create_linked', otherParticipation)).resolves.toMatchObject({
      limits: { used: 0, remaining: 2 },
    });
  });
});

describe('E15 — PLUKA+ n’a pas de quota commercial (§29)', () => {
  beforeEach(() => {
    grantEntitlement(state, { kind: 'plus', userId: RUNNER_A });
  });

  it('n’expose aucune limite', async () => {
    const decision = await decisionFor('outing.create_linked');

    expect(decision).toMatchObject({ allowed: true, reason: 'plus' });
    expect(decision.limits).toBeUndefined();
  });

  it('n’inscrit rien au ledger : il n’y a pas de compteur à tenir', async () => {
    for (const outingId of [
      'eeee1111-0000-4000-8000-000000000001',
      'eeee1111-0000-4000-8000-000000000002',
      'eeee1111-0000-4000-8000-000000000003',
    ]) {
      await expect(
        consumeLinkedOutingQuota(contextFor(RUNNER_A), {
          participantRaceId: ownParticipation,
          outingId,
        }),
      ).resolves.toMatchObject({ allowed: true });
    }

    expect(state.usage).toEqual([]);
  });
});

// ============================================================
// E16 à E18 — Conditions : entitlement et disponibilité sont deux choses
// ============================================================

describe('Conditions (§35, §39, §40)', () => {
  it('E16 / E17 — le resolver ne connaît pas J-14', async () => {
    // §35 liste quatre conditions ; le resolver n'en porte qu'une, la
    // capability. La fenêtre J-14 et la disponibilité des données appartiennent
    // au lot Conditions, et E16 exige que « le code distingue les deux
    // raisons » : un refus météo n'est pas un refus commercial.
    grantEntitlement(state, {
      kind: 'race_pass',
      userId: RUNNER_A,
      participantRaceId: ownParticipation,
    });

    await expect(decisionFor('conditions.race.read')).resolves.toMatchObject({
      allowed: true,
      reason: 'race_pass',
    });
  });

  it('E18 — Free voit l’alerte officielle et pas la prévision personnalisée', async () => {
    await expect(decisionFor('course.official_notices.read')).resolves.toMatchObject({
      allowed: true,
    });
    await expect(decisionFor('conditions.race.read')).resolves.toMatchObject({ allowed: false });
  });
});

// ============================================================
// E26 — feature flag et entitlement sont deux contrôles (§15)
// ============================================================

describe('E26 — feature flag', () => {
  it('refuse avec feature_disabled même quand le droit est valide', async () => {
    grantEntitlement(state, { kind: 'plus', userId: RUNNER_A });

    const context = contextFor(RUNNER_A, {
      disabledCapabilities: new Set<Capability>(['season.memory']),
    });
    const resolved = await resolveEntitlements(context, { participantRaceId: ownParticipation });

    expect(can(resolved, 'season.memory')).toEqual({
      allowed: false,
      reason: 'feature_disabled',
      sourceEntitlementId: null,
    });
    // Le reste du droit n'est pas affecté : un flag éteint une fonctionnalité,
    // pas un abonnement.
    expect(can(resolved, 'strategy.reuse').allowed).toBe(true);
  });

  it('passe avant toute question commerciale (AGENTS §47)', async () => {
    // Free + fonctionnalité absente : proposer un achat serait une promesse en
    // l'air, puisqu'il n'y a rien à débloquer dans cette release.
    const context = contextFor(RUNNER_A, {
      disabledCapabilities: new Set<Capability>(['nutrition.edit']),
    });
    const resolved = await resolveEntitlements(context, { participantRaceId: ownParticipation });

    expect(can(resolved, 'nutrition.edit').reason).toBe('feature_disabled');
  });
});

// ============================================================
// E28, E29 — sécurité
// ============================================================

describe('E28 / E29 — sécurité', () => {
  it('E28 — un tier envoyé par le client est refusé, pas ignoré', async () => {
    grantEntitlement(state, { kind: 'plus', userId: RUNNER_A });

    for (const payload of [
      { participantRaceId: ownParticipation, tier: 'plus' },
      { participantRaceId: ownParticipation, isPremium: true },
      { participantRaceId: ownParticipation, userId: RUNNER_B },
    ]) {
      await expect(resolveEntitlements(contextFor(RUNNER_A), payload)).rejects.toThrow();
    }
  });

  it('E28 — aucune commande ne porte de niveau d’accès', async () => {
    await expect(
      authorizeCapability(contextFor(RUNNER_A), {
        capability: 'plan.edit',
        participantRaceId: ownParticipation,
        effectiveTier: 'plus',
      }),
    ).rejects.toThrow();
  });

  it('E29 — la participation d’un autre coureur est introuvable, pas payante', async () => {
    // 03_PRIVACY_RLS §24 : vérifier l'accès à la donnée avant d'afficher un
    // message d'upgrade. Un refus commercial confirmerait l'existence de
    // l'objet.
    const error = await resolveEntitlements(contextFor(RUNNER_A), {
      participantRaceId: foreignParticipation,
    }).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('not_found');
  });

  it('E29 — et le droit d’un autre coureur ne sert à rien', async () => {
    grantEntitlement(state, {
      kind: 'race_pass',
      userId: RUNNER_B,
      participantRaceId: foreignParticipation,
    });

    await expect(decisionFor('plan.edit')).resolves.toMatchObject({
      allowed: false,
      reason: 'not_entitled',
    });
  });

  it('refuse une capability de course demandée sans course', async () => {
    grantEntitlement(state, { kind: 'plus', userId: RUNNER_A });

    await expect(decisionFor('plan.edit', null)).resolves.toMatchObject({
      allowed: false,
      reason: 'wrong_scope',
    });
  });
});

// ============================================================
// La garde de mutation
// ============================================================

describe('authorizeCapability (§5, principe 13)', () => {
  it('laisse passer un geste couvert', async () => {
    grantEntitlement(state, {
      kind: 'race_pass',
      userId: RUNNER_A,
      participantRaceId: ownParticipation,
    });

    await expect(
      authorizeCapability(contextFor(RUNNER_A), {
        capability: 'plan.edit',
        participantRaceId: ownParticipation,
      }),
    ).resolves.toMatchObject({ allowed: true, reason: 'race_pass' });
  });

  it('traduit chaque motif de refus en code de §77', async () => {
    const cases: readonly (readonly [() => void, EntitlementError['code']])[] = [
      [() => {}, 'ENTITLEMENT_REQUIRED'],
      [
        () =>
          grantEntitlement(state, {
            kind: 'race_pass',
            userId: RUNNER_A,
            participantRaceId: otherParticipation,
          }),
        'ENTITLEMENT_WRONG_SCOPE',
      ],
      [
        () =>
          grantEntitlement(state, {
            kind: 'plus',
            userId: RUNNER_A,
            endsAt: '2026-01-01T00:00:00.000Z',
          }),
        'ENTITLEMENT_EXPIRED',
      ],
      [
        () =>
          grantEntitlement(state, {
            kind: 'plus',
            userId: RUNNER_A,
            status: 'revoked',
            revokedAt: '2026-02-01T00:00:00.000Z',
          }),
        'ENTITLEMENT_REVOKED',
      ],
    ];

    for (const [seed, code] of cases) {
      state.entitlements = [];
      seed();

      const error = await expectEntitlementError(
        authorizeCapability(contextFor(RUNNER_A), {
          capability: 'plan.edit',
          participantRaceId: ownParticipation,
        }),
        code,
      );

      expect(error.capability).toBe('plan.edit');
      expect(error.decision.allowed).toBe(false);
    }
  });

  it('porte la décision entière, pour que le paywall n’ait rien à recalculer (§78)', async () => {
    grantEntitlement(state, {
      kind: 'race_pass',
      userId: RUNNER_A,
      participantRaceId: ownParticipation,
    });

    for (const outingId of [
      'eeee1111-0000-4000-8000-000000000001',
      'eeee1111-0000-4000-8000-000000000002',
    ]) {
      await consumeLinkedOutingQuota(contextFor(RUNNER_A), {
        participantRaceId: ownParticipation,
        outingId,
      });
    }

    const error = await expectEntitlementError(
      authorizeCapability(contextFor(RUNNER_A), {
        capability: 'outing.create_linked',
        participantRaceId: ownParticipation,
      }),
      'QUOTA_EXCEEDED',
    );

    expect(error.decision.limits).toEqual({ max: 2, used: 2, remaining: 0 });
  });

  it('relit les droits à chaque appel : une révocation prend effet tout de suite (§91)', async () => {
    const entitlement = grantEntitlement(state, {
      kind: 'plus',
      userId: RUNNER_A,
    });

    await expect(
      authorizeCapability(contextFor(RUNNER_A), {
        capability: 'plan.edit',
        participantRaceId: ownParticipation,
      }),
    ).resolves.toMatchObject({ allowed: true });

    state.entitlements = state.entitlements.map((row) =>
      row.id === entitlement.id
        ? { ...row, status: 'revoked' as const, revokedAt: '2026-03-01T09:00:00.000Z' }
        : row,
    );

    await expectEntitlementError(
      authorizeCapability(contextFor(RUNNER_A), {
        capability: 'plan.edit',
        participantRaceId: ownParticipation,
      }),
      'ENTITLEMENT_REVOKED',
    );
  });
});
