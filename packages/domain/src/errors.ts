import { z } from 'zod';

/**
 * Erreurs de domaine.
 *
 * Codes stables, destinés à être traduits par la couche appelante — jamais
 * affichés bruts. §4.1 en nomme un explicitement : « toute autre [transition]
 * est refusée avec `invalid_state` ».
 *
 * Aucun code ne parle d'entitlement : le droit commercial est résolu par son
 * propre service (01_ARCHITECTURE §11), et un refus de Privacy ne doit jamais
 * pouvoir se confondre avec un refus commercial (03_PRIVACY_RLS §24).
 */
export const DOMAIN_ERROR_CODES = [
  'validation',
  'forbidden',
  'not_found',
  'conflict',
  'invalid_state',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export interface DomainErrorParams {
  readonly code: DomainErrorCode;
  readonly useCase: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, string>>;
  readonly cause?: unknown;
}

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly useCase: string;
  readonly details: Readonly<Record<string, string>>;

  constructor(params: DomainErrorParams) {
    super(`[${params.useCase}] ${params.code} : ${params.message}`, {
      ...(params.cause === undefined ? {} : { cause: params.cause }),
    });
    this.name = 'DomainError';
    this.code = params.code;
    this.useCase = params.useCase;
    this.details = params.details ?? {};
  }
}

export function validationError(
  useCase: string,
  message: string,
  details?: Readonly<Record<string, string>>,
): DomainError {
  return new DomainError({
    code: 'validation',
    useCase,
    message,
    ...(details === undefined ? {} : { details }),
  });
}

/**
 * Messages de validation en français.
 *
 * Passé à chaque `safeParse` plutôt qu'installé globalement par `z.config()` :
 * ce paquet est une bibliothèque, et changer une configuration partagée
 * depuis un import affecterait tout le processus — worker compris.
 *
 * Un message écrit dans un schéma reste prioritaire : Zod préfère toujours
 * l'`error` du schéma à celui de la locale. « slug attendu en minuscules,
 * tirets simples » survit donc à cette traduction.
 */
const FRENCH_ISSUES = z.locales.fr().localeError;

/**
 * Valide l'entrée d'un use case — étape 1 de 01_ARCHITECTURE §7.
 *
 * Remplace `schema.parse()`, dont la `ZodError` n'est pas une erreur de
 * domaine : elle traverse la couche appelante sans être reconnue, et celle-ci,
 * qui ne sait traduire que des codes de refus, la reçoit comme une panne. Un
 * formulaire dont un champ est invalide affichait donc « une erreur inattendue
 * est survenue », sans dire lequel.
 *
 * Le refus rendu ici est un `validation` ordinaire, et son `details` nomme le
 * champ fautif — c'est ce qui permet à un écran de rattacher le message à
 * l'`Input` concerné plutôt qu'au formulaire entier.
 */
export function parseCommand<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
  useCase: string,
): z.output<TSchema> {
  const result = schema.safeParse(input, { error: FRENCH_ISSUES });
  if (result.success) return result.data;

  throw validationErrorOf(useCase, result.error.issues);
}

/**
 * Refus de validation construit à partir des problèmes signalés par Zod.
 *
 * Un seul message par champ : Zod en produit parfois plusieurs pour la même
 * saisie — type, puis longueur — et les empiler n'aide personne. Le premier
 * est celui qui décrit la cause.
 *
 * Les problèmes sans chemin — un `refine` porté par l'objet entier, comme
 * « aucune modification demandée » — n'ont aucun champ à nommer : ils entrent
 * dans le message, pas dans `details`.
 */
function validationErrorOf(useCase: string, issues: readonly z.core.$ZodIssue[]): DomainError {
  const details: Record<string, string> = {};
  const parts: string[] = [];

  for (const issue of issues) {
    const field = issue.path.map(String).join('.');

    if (field === '') {
      parts.push(issue.message);
      continue;
    }

    if (details[field] !== undefined) continue;

    details[field] = issue.message;
    parts.push(`${field} : ${issue.message}`);
  }

  return validationError(useCase, parts.join(' ; '), details);
}

/**
 * Refus d'accès.
 *
 * Volontairement pauvre en détail : préciser « vous n'êtes pas admin de cette
 * organisation » confirmerait l'existence de l'objet visé, et le rôle qu'il
 * aurait fallu avoir (03_PRIVACY_RLS §120).
 */
export function forbiddenError(
  useCase: string,
  details?: Readonly<Record<string, string>>,
): DomainError {
  return new DomainError({
    code: 'forbidden',
    useCase,
    message: 'action non autorisée',
    ...(details === undefined ? {} : { details }),
  });
}

export function notFoundError(useCase: string, subject: string): DomainError {
  return new DomainError({ code: 'not_found', useCase, message: `${subject} introuvable` });
}

export function conflictError(
  useCase: string,
  message: string,
  details?: Readonly<Record<string, string>>,
): DomainError {
  return new DomainError({
    code: 'conflict',
    useCase,
    message,
    ...(details === undefined ? {} : { details }),
  });
}

export function invalidStateError(
  useCase: string,
  message: string,
  details?: Readonly<Record<string, string>>,
): DomainError {
  return new DomainError({
    code: 'invalid_state',
    useCase,
    message,
    ...(details === undefined ? {} : { details }),
  });
}
