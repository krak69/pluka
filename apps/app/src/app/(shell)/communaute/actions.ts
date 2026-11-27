'use server';

import {
  createCommunityThread,
  deleteCommunityContent,
  DomainError,
  replyToCommunityThread,
  reportCommunityContent,
  setCommunityUseful,
} from '@pluka/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { communityContext, communityEnabled } from '@/lib/community';
import { underRateLimit } from '@/lib/rate-limit';
import { requireSession } from '@/lib/session';

/**
 * Gestes de la Communauté — 0114. Chaque geste passe par le domaine, puis par
 * une fonction serveur qui revérifie la participation (AGENTS §27). Rien ici
 * n'écrit directement en base.
 *
 * La limite de débit freine un compte qui publierait en rafale ; la base,
 * elle, rend le même sujet ou la même réponse à un double envoi (0114).
 */

export interface CommunityFormState {
  readonly error?: string;
  /** Un message par champ, rattaché à son `Input` (AGENTS §61). */
  readonly fieldErrors?: Readonly<Record<string, string>>;
  /**
   * La saisie refusée, rendue au formulaire : React 19 le vide après chaque
   * action, et un titre trop court ne doit pas faire perdre le texte écrit.
   */
  readonly values?: Readonly<Record<string, string>>;
  readonly saved?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const HOUR = 60 * 60 * 1000;

const LIMITS = {
  thread: { limit: 10, windowMs: HOUR },
  reply: { limit: 30, windowMs: HOUR },
  report: { limit: 20, windowMs: HOUR },
} as const;

const TOO_FAST = 'Tu publies beaucoup en peu de temps. Réessaie dans quelques minutes.';
const CLOSED = 'La communauté n’est pas ouverte pour l’instant.';

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

/** Un identifiant d'URL : il ne sert à bâtir un chemin que s'il en a la forme. */
function uuidOrNull(value: string): string | null {
  return UUID.test(value) ? value : null;
}

function threadPath(threadId: string | null): string {
  return threadId === null ? '/communaute' : `/communaute/sujets/${threadId}`;
}

/** La cible d'un geste : une réponse quand le formulaire en nomme une, sinon le sujet. */
function targetOf(form: FormData): { threadId: string } | { postId: string } {
  const postId = text(form, 'postId');
  return postId === '' ? { threadId: text(form, 'threadId') } : { postId };
}

function failure(error: unknown, action: string, fallback: string): CommunityFormState {
  if (error instanceof DomainError) {
    switch (error.code) {
      case 'validation':
        return Object.keys(error.details).length > 0
          ? { error: 'Vérifie les champs signalés.', fieldErrors: error.details }
          : { error: 'Ton message dépasse la longueur admise.' };
      case 'forbidden':
        return { error: 'Cette communauté est réservée aux participants de l’édition.' };
      case 'not_found':
        return { error: 'Ce sujet n’est plus disponible.' };
      case 'invalid_state':
        return { error: 'Ce sujet ne reçoit plus de réponses.' };
      default:
        break;
    }
  }
  console.error(`communauté : ${action} refusé`, {
    code: error instanceof DomainError ? error.code : 'inconnu',
  });
  return { error: fallback };
}

export async function createCommunityThreadAction(
  _previous: CommunityFormState,
  form: FormData,
): Promise<CommunityFormState> {
  if (!communityEnabled()) return { error: CLOSED };
  const session = await requireSession('/communaute/nouveau');
  if (
    !underRateLimit(
      `community:thread:${session.userId}`,
      LIMITS.thread.limit,
      LIMITS.thread.windowMs,
    )
  ) {
    return { error: TOO_FAST };
  }

  const values = {
    category: text(form, 'category'),
    raceId: text(form, 'raceId'),
    waypointId: text(form, 'waypointId'),
    title: text(form, 'title'),
    body: text(form, 'body'),
  };
  let threadId: string;
  try {
    ({ threadId } = await createCommunityThread(communityContext(session), {
      editionId: text(form, 'editionId'),
      category: values.category,
      title: values.title,
      body: values.body,
      raceId: values.raceId === '' ? null : values.raceId,
      // Sans course choisie, la base retient celle du point (0114).
      waypointId: values.waypointId === '' ? null : values.waypointId,
    }));
  } catch (error) {
    return {
      ...failure(error, 'sujet', 'Ton sujet n’a pas pu être publié. Réessaie dans un instant.'),
      values,
    };
  }

  revalidatePath('/communaute');
  redirect(threadPath(threadId));
}

export async function replyToCommunityThreadAction(
  _previous: CommunityFormState,
  form: FormData,
): Promise<CommunityFormState> {
  if (!communityEnabled()) return { error: CLOSED };
  const threadId = text(form, 'threadId');
  const session = await requireSession(threadPath(uuidOrNull(threadId)));
  if (
    !underRateLimit(`community:reply:${session.userId}`, LIMITS.reply.limit, LIMITS.reply.windowMs)
  ) {
    return { error: TOO_FAST };
  }

  const body = text(form, 'body');
  try {
    await replyToCommunityThread(communityContext(session), { threadId, body });
  } catch (error) {
    return {
      ...failure(error, 'réponse', 'Ta réponse n’a pas pu être publiée. Réessaie dans un instant.'),
      values: { body },
    };
  }

  revalidatePath(threadPath(uuidOrNull(threadId)));
  revalidatePath('/communaute');
  return { saved: true };
}

/** « Utile », posé ou retiré. Sans retour à afficher : la page se relit. */
export async function setCommunityUsefulAction(form: FormData): Promise<void> {
  if (!communityEnabled()) return;
  const path = threadPath(uuidOrNull(text(form, 'threadId')));
  const session = await requireSession(path);

  await setCommunityUseful(communityContext(session), {
    target: targetOf(form),
    useful: text(form, 'useful') === 'true',
  }).catch((error: unknown) => {
    failure(error, 'utile', '');
  });
  revalidatePath(path);
}

export async function reportCommunityContentAction(
  _previous: CommunityFormState,
  form: FormData,
): Promise<CommunityFormState> {
  if (!communityEnabled()) return { error: CLOSED };
  const session = await requireSession(threadPath(uuidOrNull(text(form, 'threadId'))));
  if (
    !underRateLimit(
      `community:report:${session.userId}`,
      LIMITS.report.limit,
      LIMITS.report.windowMs,
    )
  ) {
    return { error: TOO_FAST };
  }

  const values = { reason: text(form, 'reason'), details: text(form, 'details') };
  try {
    await reportCommunityContent(communityContext(session), {
      target: targetOf(form),
      reason: values.reason,
      details: values.details,
    });
  } catch (error) {
    return {
      ...failure(
        error,
        'signalement',
        'Le signalement n’a pas pu être envoyé. Réessaie dans un instant.',
      ),
      values,
    };
  }
  return { saved: true };
}

/**
 * L'auteur retire son sujet ou sa réponse, sans retour (03_PRIVACY_RLS §55).
 * Un sujet retiré n'a plus de page : on revient à sa communauté.
 */
export async function deleteCommunityContentAction(form: FormData): Promise<void> {
  if (!communityEnabled()) return;
  const threadId = uuidOrNull(text(form, 'threadId'));
  const session = await requireSession(threadPath(threadId));
  const target = targetOf(form);

  try {
    await deleteCommunityContent(communityContext(session), { target });
  } catch (error) {
    failure(error, 'suppression', '');
    revalidatePath(threadPath(threadId));
    return;
  }

  revalidatePath('/communaute');
  if ('threadId' in target) {
    const editionId = uuidOrNull(text(form, 'editionId'));
    redirect(editionId === null ? '/communaute' : `/communaute?edition=${editionId}`);
  }
  revalidatePath(threadPath(threadId));
}
