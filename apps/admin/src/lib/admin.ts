import { createCourseRepositories } from '@pluka/db';
import { DomainError, type CourseContext } from '@pluka/domain';
import { notFound, redirect } from 'next/navigation';

import { requireSession, type Session } from '@/lib/session';
import { createDataClient } from '@/lib/supabase/data';

/**
 * Contexte d'exécution d'un use case du domaine.
 *
 * `actor` ne porte qu'un `userId` : le rôle plateforme est relu en base par
 * `@pluka/domain` à chaque commande, jamais transmis d'ici
 * (03_PRIVACY_RLS §11, §178). Cette application ne peut donc pas se déclarer
 * administratrice — elle ne fait que dire *qui* agit.
 */
export function courseContext(session: Session): CourseContext {
  return {
    repositories: createCourseRepositories({ client: createDataClient(session.accessToken) }),
    actor: { userId: session.userId },
  };
}

/**
 * Garde de l'application d'administration.
 *
 * Trois barrières superposées, et c'est délibéré :
 *
 * 1. la session, sans laquelle il n'y a pas d'acteur ;
 * 2. **le use case du domaine**, qui relit `users.platform_role` en base et
 *    refuse un non-admin — c'est la vérification côté serveur qui fait
 *    autorité ;
 * 3. la RLS, qui limite ce que la requête peut atteindre même si les deux
 *    premières étaient contournées (01_ARCHITECTURE §9).
 *
 * Cette fonction ne teste elle-même aucun rôle. Elle exécute une lecture
 * d'administration et laisse le domaine trancher : dupliquer ici la règle
 * « est-ce un pluka_admin » créerait une seconde vérité, qui finirait par
 * diverger de la première.
 */
export async function requireAdminContext(returnTo: string): Promise<CourseContext> {
  const session = await requireSession(returnTo);

  return courseContext(session);
}

/**
 * Traduit un refus du domaine en réponse d'écran.
 *
 * `forbidden` renvoie vers une page qui n'en dit pas plus que « réservé » :
 * un non-administrateur ne doit pas apprendre ce que l'écran aurait montré.
 *
 * `not_found` rend un 404 plutôt qu'une erreur serveur — un identifiant
 * inexistant dans une URL est un cas ordinaire, pas une panne.
 */
export function redirectOnDomainError(error: unknown): never {
  if (error instanceof DomainError && error.code === 'forbidden') {
    redirect('/refuse');
  }

  if (error instanceof DomainError && error.code === 'not_found') {
    notFound();
  }

  throw error;
}

/** Message affichable d'une erreur de domaine, sans détail interne. */
export function domainErrorMessage(error: unknown): string {
  if (!(error instanceof DomainError)) return 'Une erreur inattendue est survenue.';

  const messages: Readonly<Record<DomainError['code'], string>> = {
    validation: 'Les informations saisies sont invalides.',
    forbidden: 'Action non autorisée.',
    not_found: 'Objet introuvable.',
    conflict: 'Cette valeur est déjà utilisée.',
    invalid_state: 'Cette transition n’est pas autorisée dans l’état actuel.',
  };

  // Le message du domaine est déjà rédigé pour être lu — il ne contient ni
  // requête, ni identifiant technique (AGENTS : jamais d'erreur brute).
  return `${messages[error.code]} ${error.message.replace(/^\[[^\]]+\]\s*\w+\s*:\s*/, '')}`.trim();
}
