import {
  DbError,
  createAdminActionsRepositories,
  createAdminConsoleRepositories,
  createCourseRepositories,
  createFactRepositories,
  createGpxRepositories,
  createOrganizationTeamRepositories,
  type DbErrorCode,
} from '@pluka/db';
import {
  DomainError,
  getAdminPlatformCounters,
  type AdminActionsContext,
  type AdminConsoleContext,
  type CourseContext,
  type DomainErrorCode,
  type FactReviewContext,
  type GpxImportContext,
  type OrganizationTeamContext,
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
 * Contexte des lectures de la console — migration 0028.
 *
 * Même principe, avec une nuance : ces onze lectures passent par des fonctions
 * `security definer` qui portent elles-mêmes leur condition d'accès
 * (03_PRIVACY_RLS §8). La troisième barrière n'est donc pas la RLS mais la
 * garde de la fonction, et le refus remonte en `42501` plutôt qu'en résultat
 * vide — c'est `redirectOnReadError` qui le
 * traduit.
 */
export function adminConsoleContext(session: Session): AdminConsoleContext {
  return {
    repositories: createAdminConsoleRepositories({
      client: createDataClient(session.accessToken),
    }),
    actor: { userId: session.userId },
  };
}

export async function requireAdminConsoleContext(returnTo: string): Promise<AdminConsoleContext> {
  const session = await requireSession(returnTo);

  return adminConsoleContext(session);
}

/**
 * Contexte des écritures de la console — migration 0029.
 *
 * Même câblage que les lectures : jeton de la session, aucune clé de service.
 * La garde `pluka_admin` et l'écriture du journal d'audit vivent dans chaque
 * fonction SQL ; le domaine valide l'entrée et traduit les refus. Cette
 * application ne fait que dire *qui* agit, et sur quoi.
 */
/**
 * Équipe d'une organisation — migration 0033. Même câblage : la garde
 * (pluka_admin ou owner) et l'audit sont dans chaque fonction SQL.
 */
export function organizationTeamContext(session: Session): OrganizationTeamContext {
  return {
    repositories: createOrganizationTeamRepositories({
      client: createDataClient(session.accessToken),
    }),
    actor: { userId: session.userId },
  };
}

export function adminActionsContext(session: Session): AdminActionsContext {
  return {
    repositories: createAdminActionsRepositories({
      client: createDataClient(session.accessToken),
    }),
    actor: { userId: session.userId },
  };
}

/**
 * Garde d'un onglet de console qui ne lit rien.
 *
 * `/produits/signalements` est un état vide : la fonctionnalité n'existe pas en
 * base, et la page n'a donc aucune lecture à faire. Sans garde, elle serait le
 * seul onglet de la console qu'un compte sans droit pourrait ouvrir — les neuf
 * autres se refusent d'eux-mêmes, parce que leur RPC lève `42501`.
 *
 * La garde passe donc par la lecture la moins chère de la console, celle des
 * compteurs : elle ne touche aucune donnée personnelle et n'est pas
 * journalisée (décision du lot 4a). Son résultat est jeté — ce qu'on cherche
 * est le refus, pas les chiffres.
 */
export async function requireAdminConsoleGate(returnTo: string): Promise<void> {
  const context = await requireAdminConsoleContext(returnTo);

  await getAdminPlatformCounters(context).catch(redirectOnReadError);
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

/**
 * Traduit le refus d'une lecture de console.
 *
 * Les fonctions de 0028 lèvent `42501` quand l'appelant n'est pas
 * `pluka_admin`, et `mapPostgrestError` en fait un `DbError` de code
 * `permission_denied`. Sans ce cas, l'écran rendrait une erreur serveur là où
 * la réponse juste est « réservé » : un non-administrateur n'a pas à apprendre
 * ce que l'écran aurait montré.
 *
 * `not_found` reste un 404 — un identifiant inexistant dans une URL est un cas
 * ordinaire.
 */
export function redirectOnReadError(error: unknown): never {
  if (error instanceof DbError && error.code === 'permission_denied') {
    redirect('/refuse');
  }

  if (error instanceof DomainError && error.code === 'forbidden') {
    redirect('/refuse');
  }

  if ((error instanceof DomainError || error instanceof DbError) && error.code === 'not_found') {
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
  invalid_state: 'Cette transition n’est pas autorisée dans l’état actuel.',
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
