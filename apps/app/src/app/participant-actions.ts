'use server';

import {
  DomainError,
  OTHER_EMAIL_REASON,
  acceptParticipantInvitation,
  commitParticipantImport,
  declineParticipantInvitation,
  correctParticipant,
  createParticipantImport,
  discardParticipantImport,
  getOrganizerCourse,
  sendParticipantInvitations,
  setParticipantWithdrawn,
  validateParticipantImport,
} from '@pluka/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { sessionEventSiteContext } from '@/lib/event-site-editing';
import { participantImportContext } from '@/lib/organizer-course';
import {
  anonymousParticipantInvitationContext,
  participantInvitationsEnabled,
  sessionParticipantInvitationContext,
} from '@/lib/participant-invitations';
import { requireSession } from '@/lib/session';

/**
 * Participants · Import — 00_PRODUCT_SPEC §29.1. Une intention, et la base qui
 * revérifie le rôle à chaque geste (0060). Aucune donnée de participant dans les
 * journaux : seul le nom de l'erreur y va (AGENTS §62).
 */

export interface ParticipantActionState {
  readonly error?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEARCH = /^[a-z0-9=&-]*$/iu;

function text(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === 'string' ? value : '';
}

function pagePath(form: FormData): string {
  const organizationId = text(form, 'organizationId');
  return UUID.test(organizationId) ? `/org/${organizationId}/participants` : '/org';
}

function selectionOf(form: FormData): string {
  const selection = text(form, 'selection');
  return SEARCH.test(selection) ? selection : '';
}

function failure(error: unknown): ParticipantActionState {
  if (error instanceof DomainError) {
    if (error.code === 'forbidden') {
      return { error: 'Seuls un propriétaire ou un administrateur importent des participants.' };
    }
    if (error.code === 'validation') {
      const detail = Object.values(error.details)[0];
      if (typeof detail === 'string') return { error: detail };
    }
    if (error.code === 'invalid_state') return { error: 'Cet import est déjà terminé.' };
    if (error.code === 'not_found') return { error: 'Cet import n’existe plus.' };
  }

  console.error('participants : erreur non traduite', {
    name: error instanceof Error ? error.name : 'inconnu',
  });
  return { error: 'Une erreur est survenue. Réessayez dans un instant.' };
}

export async function createImportAction(
  _previous: ParticipantActionState,
  form: FormData,
): Promise<ParticipantActionState> {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choisissez un fichier.' };

  let importId: string;
  try {
    const session = await requireSession(pagePath(form));
    ({ importId } = await createParticipantImport(participantImportContext(session), {
      editionId: text(form, 'editionId'),
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    }));
  } catch (error) {
    return failure(error);
  }

  const selection = selectionOf(form);
  redirect(`${pagePath(form)}?${selection === '' ? '' : `${selection}&`}import=${importId}`);
}

export async function validateImportAction(
  _previous: ParticipantActionState,
  form: FormData,
): Promise<ParticipantActionState> {
  const organizationId = text(form, 'organizationId');
  const importId = text(form, 'importId');
  const columns = Object.fromEntries(
    [...form.entries()].flatMap(([key, value]) =>
      key.startsWith('column.') && typeof value === 'string' && value !== ''
        ? [[key.slice('column.'.length), value]]
        : [],
    ),
  );

  try {
    const session = await requireSession(pagePath(form));
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
    const eventSlug = text(form, 'eventSlug');
    // Les épreuves viennent de la base : un formulaire ne désigne pas celles d'une autre édition.
    const course = await getOrganizerCourse(sessionEventSiteContext(session), {
      organizationId,
      today,
      ...(eventSlug === '' ? {} : { eventSlug }),
      year: Number(text(form, 'year')),
    });
    await validateParticipantImport(participantImportContext(session), {
      importId,
      columns,
      races: course.races.map((race) => ({ id: race.id, name: race.name, slug: race.slug })),
    });
  } catch (error) {
    return failure(error);
  }

  revalidatePath(pagePath(form));
  return {};
}

export async function commitImportAction(
  _previous: ParticipantActionState,
  form: FormData,
): Promise<ParticipantActionState> {
  let result: Awaited<ReturnType<typeof commitParticipantImport>>;
  try {
    result = await commitParticipantImport(
      participantImportContext(await requireSession(pagePath(form))),
      { importId: text(form, 'importId') },
    );
  } catch (error) {
    return failure(error);
  }

  revalidatePath(pagePath(form));
  const selection = selectionOf(form);
  // L'import reste dans l'adresse : ses lignes refusées se lisent encore après coup.
  redirect(
    `${pagePath(form)}?${selection === '' ? '' : `${selection}&`}import=${text(form, 'importId')}&importes=${String(result.created)}&majs=${String(result.updated)}&ignores=${String(result.skipped)}&gardes=${String(result.kept)}&retires=${String(result.withdrawn)}`,
  );
}

function participantFailure(error: unknown): ParticipantActionState {
  if (error instanceof DomainError && error.code === 'invalid_state') {
    return { error: 'Ce participant ne peut pas être modifié dans cet état.' };
  }
  if (error instanceof DomainError && error.code === 'forbidden') {
    return { error: 'Seuls un propriétaire ou un administrateur modifient la liste.' };
  }
  if (error instanceof DomainError && error.code === 'not_found') {
    return { error: 'Ce participant n’existe plus.' };
  }
  return failure(error);
}

export async function correctParticipantAction(
  _previous: ParticipantActionState,
  form: FormData,
): Promise<ParticipantActionState> {
  try {
    await correctParticipant(participantImportContext(await requireSession(pagePath(form))), {
      participantRaceId: text(form, 'participantRaceId'),
      bib: text(form, 'bib'),
      wave: text(form, 'wave'),
    });
  } catch (error) {
    return participantFailure(error);
  }

  revalidatePath(pagePath(form));
  return {};
}

export async function setParticipantWithdrawnAction(
  _previous: ParticipantActionState,
  form: FormData,
): Promise<ParticipantActionState> {
  try {
    await setParticipantWithdrawn(participantImportContext(await requireSession(pagePath(form))), {
      participantRaceId: text(form, 'participantRaceId'),
      withdrawn: text(form, 'withdrawn') === 'true',
    });
  } catch (error) {
    return participantFailure(error);
  }

  revalidatePath(pagePath(form));
  return {};
}

/**
 * Inviter les participants — migration 0069. Sans participant désigné : tous
 * ceux qui peuvent l'être ; avec : un renvoi, qui remplace le lien précédent.
 */
export async function sendParticipantInvitationsAction(
  _previous: ParticipantActionState,
  form: FormData,
): Promise<ParticipantActionState> {
  if (!participantInvitationsEnabled())
    return { error: 'Les invitations ne sont pas encore ouvertes.' };

  const participantRaceId = text(form, 'participantRaceId');
  let sent: number;

  try {
    sent = await sendParticipantInvitations(
      sessionParticipantInvitationContext(await requireSession(pagePath(form))),
      {
        editionId: text(form, 'editionId'),
        ...(participantRaceId === '' ? {} : { participantRaceIds: [participantRaceId] }),
      },
    );
  } catch (error) {
    if (error instanceof DomainError && error.code === 'forbidden') {
      return { error: 'Seuls un propriétaire ou un administrateur invitent les participants.' };
    }
    return failure(error);
  }

  revalidatePath(pagePath(form));
  const selection = selectionOf(form);
  redirect(
    `${pagePath(form)}?${selection === '' ? '' : `${selection}&`}invitations=${String(sent)}`,
  );
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/u;

/**
 * Refuser d'être contacté, depuis `/invitation/[token]?refus=1` (0075). Un
 * bouton, jamais l'ouverture du lien : un antivirus qui suit les liens d'un
 * e-mail ne doit pas refuser à la place du coureur.
 */
export async function declineParticipantInvitationAction(form: FormData): Promise<void> {
  const raw = form.get('token');
  const token = typeof raw === 'string' && TOKEN.test(raw) ? raw : null;

  if (token === null || !participantInvitationsEnabled()) redirect('/');

  const outcome = await declineParticipantInvitation(
    anonymousParticipantInvitationContext(),
    { token },
  ).catch(() => 'unknown' as const);
  redirect(`/invitation/${token}?etat=${outcome === 'declined' ? 'refusee' : 'impossible'}`);
}

/** Activer une invitation, depuis `/invitation/[token]` (§116). */
export async function acceptParticipantInvitationAction(form: FormData): Promise<void> {
  const raw = form.get('token');
  const token = typeof raw === 'string' && TOKEN.test(raw) ? raw : null;

  if (token === null || !participantInvitationsEnabled()) redirect('/');

  const page = `/invitation/${token}`;
  const context = sessionParticipantInvitationContext(await requireSession(page));
  let target: string;

  try {
    const { participantRaceId } = await acceptParticipantInvitation(context, { token });
    target = `${page}?etat=activee&participation=${participantRaceId}`;
  } catch (error) {
    if (error instanceof DomainError && error.details['reason'] === OTHER_EMAIL_REASON) {
      target = `${page}?etat=autre-adresse`;
    } else if (error instanceof DomainError) {
      target = `${page}?etat=impossible`;
    } else {
      console.error('activation d’invitation : erreur non traduite', {
        name: error instanceof Error ? error.name : 'inconnu',
      });
      target = `${page}?etat=erreur`;
    }
  }

  redirect(target);
}

export async function discardImportAction(
  _previous: ParticipantActionState,
  form: FormData,
): Promise<ParticipantActionState> {
  try {
    await discardParticipantImport(participantImportContext(await requireSession(pagePath(form))), {
      importId: text(form, 'importId'),
    });
  } catch (error) {
    return failure(error);
  }

  const selection = selectionOf(form);
  redirect(`${pagePath(form)}${selection === '' ? '' : `?${selection}`}`);
}
