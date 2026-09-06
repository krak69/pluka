import type { Capability } from './capabilities.js';
import type { DecisionReason, EntitlementDecision } from './resolver.js';

/**
 * Erreurs commerciales — 04_ENTITLEMENTS §77.
 *
 * Séparées des `DomainError` à dessein. `errors.ts` du domaine le dit :
 * « aucun code ne parle d'entitlement […] un refus de Privacy ne doit jamais
 * pouvoir se confondre avec un refus commercial ». 03_PRIVACY_RLS §24 pose la
 * même frontière dans l'autre sens : « un entitlement ne peut jamais outrepasser
 * la Privacy. Vérifier l'accès à la donnée avant d'afficher un message
 * d'upgrade. »
 *
 * Concrètement : un objet qui appartient à quelqu'un d'autre donne un
 * `not_found` de domaine, jamais une proposition d'achat.
 *
 * §77 liste dix codes. Les six ci-dessous sont ceux que ce lot peut produire.
 * `OUTING_NOT_LINKED` appartient au lot Sorties,
 * `ORGANIZER_INCLUDED_SCOPE_MISMATCH` au lot B2B, `PURCHASE_NOT_CONFIRMED` et
 * `DUPLICATE_PURCHASE` au lot Billing — aucun paiement n'existe ici. Les
 * déclarer maintenant serait annoncer des refus que rien ne lève.
 */
export const ENTITLEMENT_ERROR_CODES = [
  'ENTITLEMENT_REQUIRED',
  'ENTITLEMENT_EXPIRED',
  'ENTITLEMENT_REVOKED',
  'ENTITLEMENT_WRONG_SCOPE',
  'FEATURE_DISABLED',
  'QUOTA_EXCEEDED',
] as const;

export type EntitlementErrorCode = (typeof ENTITLEMENT_ERROR_CODES)[number];

const CODE_BY_REASON: Readonly<Partial<Record<DecisionReason, EntitlementErrorCode>>> = {
  feature_disabled: 'FEATURE_DISABLED',
  quota_exceeded: 'QUOTA_EXCEEDED',
  wrong_scope: 'ENTITLEMENT_WRONG_SCOPE',
  expired: 'ENTITLEMENT_EXPIRED',
  revoked: 'ENTITLEMENT_REVOKED',
  not_entitled: 'ENTITLEMENT_REQUIRED',
};

export function entitlementErrorCode(reason: DecisionReason): EntitlementErrorCode {
  return CODE_BY_REASON[reason] ?? 'ENTITLEMENT_REQUIRED';
}

/**
 * Refus commercial.
 *
 * Porte la décision entière : §78 veut qu'un paywall « ne calcule pas les
 * droits » mais « reçoive reason, upgrade target, contexte ». Il trouve ici de
 * quoi choisir son wording sans refaire le raisonnement — et sans pouvoir
 * l'infirmer.
 */
export class EntitlementError extends Error {
  readonly code: EntitlementErrorCode;
  readonly capability: Capability;
  readonly decision: EntitlementDecision;

  constructor(capability: Capability, decision: EntitlementDecision) {
    super(`[${capability}] ${entitlementErrorCode(decision.reason)} : ${decision.reason}`);
    this.name = 'EntitlementError';
    this.code = entitlementErrorCode(decision.reason);
    this.capability = capability;
    this.decision = decision;
  }
}
