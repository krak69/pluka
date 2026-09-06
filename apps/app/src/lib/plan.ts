import { createEntitlementRepositories, createPlanRepositories } from '@pluka/db';
import { DomainError, EntitlementError, type PlanContext } from '@pluka/domain';
import { notFound, redirect } from 'next/navigation';

import { requireSession, type Session } from '@/lib/session';
import { createDataClient } from '@/lib/supabase/data';

/**
 * Contexte d'exécution des use cases du Plan.
 *
 * `actor` ne porte qu'un `userId`. La propriété de la participation, les
 * droits commerciaux et la version du moteur sont résolus par
 * `@pluka/domain` : cette application ne peut ni se déclarer propriétaire, ni
 * se déclarer premium, ni choisir sa courbe de pente
 * (03_PRIVACY_RLS §11, PLAN_ENGINE §14, §45).
 *
 * `engineConfig` n'est volontairement pas fourni : le domaine retient
 * `plan-v1.0.0`. §14 — « le client ne peut jamais fournir cette configuration
 * arbitrairement ».
 */
export function planContext(session: Session): PlanContext {
  const client = createDataClient(session.accessToken);

  return {
    repositories: {
      ...createPlanRepositories({ client }),
      ...createEntitlementRepositories({ client }),
    },
    actor: { userId: session.userId },
    now: () => new Date(),
  };
}

export async function requirePlanContext(returnTo: string): Promise<PlanContext> {
  return planContext(await requireSession(returnTo));
}

/**
 * Traduit un refus du domaine en réponse d'écran.
 *
 * `not_found` rend un 404 : une participation qui n'est pas la sienne est
 * introuvable, jamais interdite (03_PRIVACY_RLS §120). Confondre les deux
 * confirmerait l'existence de l'objet d'un autre coureur.
 */
export function redirectOnDomainError(error: unknown): never {
  if (error instanceof DomainError && error.code === 'not_found') {
    notFound();
  }

  if (error instanceof DomainError && error.code === 'forbidden') {
    redirect('/');
  }

  throw error;
}

/**
 * Message d'un refus commercial — 04_ENTITLEMENTS §78.
 *
 * « Le paywall est une conséquence UI d'un EntitlementDecision.allowed = false.
 * Il ne calcule pas les droits. Il reçoit reason, upgrade target, contexte. »
 *
 * L'écran ne masque donc pas les actions premium : §45 du moteur refuse le
 * « bouton masqué côté UI seulement », et un refus lisible apprend au coureur
 * ce qui lui manque, là où un bouton absent le laisse deviner.
 */
export function entitlementMessage(error: EntitlementError): string {
  const messages: Readonly<Record<EntitlementError['code'], string>> = {
    ENTITLEMENT_REQUIRED: 'Cette modification demande le Race Pass sur cette course.',
    ENTITLEMENT_EXPIRED: 'Le droit qui couvrait cette course a expiré.',
    ENTITLEMENT_REVOKED: 'Le droit qui couvrait cette course a été retiré.',
    ENTITLEMENT_WRONG_SCOPE: 'Le droit dont vous disposez couvre une autre épreuve.',
    FEATURE_DISABLED: 'Cette fonctionnalité n’est pas disponible dans cette version.',
    QUOTA_EXCEEDED: 'Le nombre de sorties liées incluses est atteint.',
  };

  const decision = error.decision;
  if (decision.limits === undefined) return messages[error.code];

  return `${messages[error.code]} (${decision.limits.used} sur ${decision.limits.max})`;
}

/**
 * Message affichable d'une erreur, sans détail interne.
 *
 * Les deux familles restent distinctes : 03_PRIVACY_RLS §24 sépare « puis-je
 * accéder à cette donnée » de « ai-je le droit d'utiliser cette
 * fonctionnalité », et confondre les deux proposerait un achat pour l'objet de
 * quelqu'un d'autre.
 */
export function planErrorMessage(error: unknown): string {
  if (error instanceof EntitlementError) return entitlementMessage(error);

  if (error instanceof DomainError) {
    const messages: Readonly<Record<DomainError['code'], string>> = {
      validation: 'Les informations saisies sont invalides.',
      forbidden: 'Action non autorisée.',
      not_found: 'Objet introuvable.',
      conflict: 'Cette valeur est déjà utilisée.',
      invalid_state: 'Cette action n’est pas possible dans l’état actuel du Plan.',
    };

    return `${messages[error.code]} ${error.message.replace(/^\[[^\]]+\]\s*\w+\s*:\s*/, '')}`.trim();
  }

  return 'Une erreur inattendue est survenue.';
}
