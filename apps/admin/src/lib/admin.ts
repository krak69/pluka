import {
  DbError,
  createCourseRepositories,
  createFactRepositories,
  createGpxRepositories,
  type DbErrorCode,
} from '@pluka/db';
import {
  DomainError,
  type CourseContext,
  type DomainErrorCode,
  type FactReviewContext,
  type GpxImportContext,
} from '@pluka/domain';
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
 * Contexte d'import GPX.
 *
 * Même principe que `courseContext` : l'acteur n'est qu'un `userId`, et le
 * client de données porte le jeton de la session. Le dépôt du fichier passe
 * donc par la policy du bucket `race-sources` sous l'identité de
 * l'administrateur — aucune clé de service n'entre ici (03_PRIVACY_RLS §8).
 */
export function gpxImportContext(session: Session): GpxImportContext {
  return {
    repositories: createGpxRepositories({ client: createDataClient(session.accessToken) }),
    actor: { userId: session.userId },
  };
}

export async function requireGpxImportContext(returnTo: string): Promise<GpxImportContext> {
  const session = await requireSession(returnTo);

  return gpxImportContext(session);
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

const UNEXPECTED = 'Une erreur inattendue est survenue.';

/**
 * Refus du domaine, par code.
 *
 * `forbidden` ne se complète d'aucun détail : `forbiddenError` n'en porte
 * volontairement pas — dire *sur quoi* le droit manque confirmerait
 * l'existence de l'objet visé (03_PRIVACY_RLS §120). La phrase dit donc quoi
 * faire, pas ce qui a été refusé.
 */
const DOMAIN_MESSAGES: Readonly<Record<DomainErrorCode, string>> = {
  validation: 'Les informations saisies sont invalides.',
  forbidden: 'Action non autorisée : votre compte n’a pas ce droit.',
  not_found: 'Objet introuvable.',
  conflict: 'Cette valeur est déjà utilisée.',
  invalid_state: 'Cette transition n’est pas autorisée dans l’état actuel.',
};

/**
 * Refus de la base — 03_PRIVACY_RLS §8.
 *
 * Une `DbError` n'est pas une panne : une policy RLS qui refuse une écriture,
 * une contrainte d'unicité violée, sont des réponses. Les laisser tomber dans
 * le message générique rendait indiscernables « la base a dit non » et « le
 * serveur a cassé » — c'est-à-dire précisément le diagnostic qu'un écran doit
 * permettre.
 *
 * Les codes absents de cette table — `unknown`, `invalid_configuration` — sont
 * les seuls qui restent génériques, et ce sont bien des pannes.
 */
const DB_MESSAGES: Partial<Readonly<Record<DbErrorCode, string>>> = {
  permission_denied: 'Action non autorisée : la base a refusé l’opération.',
  conflict: 'Cette valeur est déjà utilisée.',
  constraint_violation: 'Les informations saisies violent une contrainte de la base.',
  not_found: 'Objet introuvable.',
  unavailable: 'Base de données momentanément indisponible. Réessayez.',
};

/** Message affichable d'une erreur, sans détail interne. */
export function domainErrorMessage(error: unknown): string {
  if (error instanceof DomainError) {
    return `${DOMAIN_MESSAGES[error.code]} ${reason(error)}`.trim();
  }

  if (error instanceof DbError) return DB_MESSAGES[error.code] ?? UNEXPECTED;

  return UNEXPECTED;
}

/**
 * Partie lisible du message de domaine.
 *
 * `DomainError` préfixe son message du use case et du code — utile en logs,
 * illisible dans un formulaire. Le préfixe saute ; `forbidden`, dont le
 * message n'est que « action non autorisée », n'ajouterait qu'une redite.
 */
function reason(error: DomainError): string {
  if (error.code === 'forbidden') return '';

  return error.message.replace(/^\[[^\]]+\]\s*\w+\s*:\s*/, '');
}

/**
 * Réponse d'une Server Action qui a échoué.
 *
 * `fieldErrors` porte les refus de validation champ par champ, tels que
 * `parseCommand` les a nommés. C'est ce qui permet à un formulaire de poser le
 * message contre l'`Input` fautif (06_DESIGN_SYSTEM §35) au lieu de renvoyer
 * l'utilisateur à une phrase unique valable pour tout l'écran.
 *
 * Une erreur qu'aucune couche n'a nommée reste générique côté écran, mais elle
 * est journalisée : sans cette trace, un refus inattendu ne laisse rien à
 * diagnostiquer.
 */
export interface ActionFailure {
  readonly error: string;
  readonly fieldErrors?: Readonly<Record<string, string>>;
}

export function actionFailure(error: unknown): ActionFailure {
  if (!(error instanceof DomainError) && !(error instanceof DbError)) {
    console.error('Server Action : erreur non traduite', error);
  }

  const fieldErrors = validationFields(error);

  return fieldErrors === undefined
    ? { error: domainErrorMessage(error) }
    : { error: domainErrorMessage(error), fieldErrors };
}

function validationFields(error: unknown): Readonly<Record<string, string>> | undefined {
  if (!(error instanceof DomainError) || error.code !== 'validation') return undefined;

  return Object.keys(error.details).length === 0 ? undefined : error.details;
}

/**
 * Contexte de revue et de publication des facts.
 *
 * Même principe que `courseContext` : l'acteur n'est qu'un `userId`, et
 * l'autorité est relue en base par `@pluka/domain` à chaque commande. Cette
 * application ne peut donc pas se déclarer autorisée à publier — elle dit
 * seulement *qui* décide, et la base vérifie que ce « qui » est bien celui de
 * la session (migration 0012).
 */
export function factReviewContext(session: Session): FactReviewContext {
  return {
    repositories: createFactRepositories({ client: createDataClient(session.accessToken) }),
    actor: { userId: session.userId },
  };
}

export async function requireFactReviewContext(returnTo: string): Promise<FactReviewContext> {
  const session = await requireSession(returnTo);

  return factReviewContext(session);
}
