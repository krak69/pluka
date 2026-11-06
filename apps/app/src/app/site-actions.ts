'use server';

import {
  DomainError,
  addEventSiteGalleryPhoto,
  removeEventSiteGalleryPhoto,
  removeEventSiteImage,
  saveEventSite,
  setEventSiteDocumentPublic,
  setEventSiteStatus,
  uploadEventSiteImage,
} from '@pluka/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { SITE_PROGRAM_VISIBLE } from '@/app/site/program';
import { sessionEventSiteContext } from '@/lib/event-site-editing';
import { requireSession } from '@/lib/session';

/**
 * L'éditeur du site d'un événement — EVENT_SITE §4, §5, §8.
 *
 * Ces actions transmettent une intention et un acteur. Le domaine vérifie le
 * rôle, la forme et le contraste ; la base revérifie le rôle et journalise.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export interface SiteActionState {
  readonly error?: string;
  readonly fieldErrors?: Readonly<Record<string, string>>;
}

function text(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === 'string' ? value : '';
}

function texts(form: FormData, field: string): string[] {
  return form.getAll(field).map((value) => (typeof value === 'string' ? value : ''));
}

const FORBIDDEN: Readonly<Record<string, string>> = {
  saveEventSite: 'Votre rôle permet de voir le site, pas de le modifier.',
  uploadEventSiteImage: 'Votre rôle permet de voir le site, pas de le modifier.',
  removeEventSiteImage: 'Votre rôle permet de voir le site, pas de le modifier.',
  addEventSiteGalleryPhoto: 'Votre rôle permet de voir le site, pas de le modifier.',
  removeEventSiteGalleryPhoto: 'Votre rôle permet de voir le site, pas de le modifier.',
  setEventSiteStatus: 'Seuls un propriétaire ou un administrateur mettent le site en ligne.',
  setEventSiteDocumentPublic: 'Seuls un propriétaire ou un administrateur diffusent un document.',
};

function failure(error: unknown): SiteActionState {
  if (error instanceof DomainError) {
    if (error.code === 'forbidden') {
      return { error: FORBIDDEN[error.useCase] ?? 'Action non autorisée.' };
    }
    if (error.code === 'validation' && Object.keys(error.details).length > 0) {
      return { error: 'Certaines informations sont à corriger.', fieldErrors: error.details };
    }

    const message = error.message.replace(/^\[[^\]]+\]\s*\w+\s*:\s*/u, '');
    return { error: message.charAt(0).toUpperCase() + message.slice(1) + '.' };
  }

  console.error('site : erreur non traduite', {
    name: error instanceof Error ? error.name : 'inconnu',
  });
  return { error: 'Une erreur est survenue. Réessayez dans un instant.' };
}

function sitePath(organizationId: string, eventSlug: string): string {
  if (!UUID.test(organizationId)) return '/org';
  const base = `/org/${organizationId}/parametres/site`;
  return SLUG.test(eventSlug) ? `${base}?evenement=${eventSlug}` : base;
}

/** L'onglet voyage avec le geste : le retour n'oblige pas à retrouver sa place. */
function done(form: FormData, notice: string): never {
  const path = sitePath(text(form, 'organizationId'), text(form, 'eventSlug'));
  const tab = text(form, 'onglet');
  const query = `${/^[a-z]+$/u.test(tab) ? `onglet=${tab}&` : ''}fait=${notice}`;
  revalidatePath(`/org/${text(form, 'organizationId')}/parametres/site`);
  redirect(`${path}${path.includes('?') ? '&' : '?'}${query}`);
}

async function context(form: FormData) {
  const organizationId = text(form, 'organizationId');
  const session = await requireSession(sitePath(organizationId, text(form, 'eventSlug')));
  return sessionEventSiteContext(session);
}

export async function saveSiteAction(
  _previous: SiteActionState,
  form: FormData,
): Promise<SiteActionState> {
  const titles = texts(form, 'sectionTitle');
  const bodies = texts(form, 'sectionBody');
  const moments = texts(form, 'sectionMoment');
  const topicKeys = texts(form, 'topicKey');
  const topicBodies = texts(form, 'topicBody');
  const figureValues = texts(form, 'figureValue');
  const figureLabels = texts(form, 'figureLabel');
  const programDays = texts(form, 'programDay');
  const programTimes = texts(form, 'programTime');
  const programTitles = texts(form, 'programTitle');
  const programLocations = texts(form, 'programLocation');
  const raceIds = texts(form, 'raceId');
  const raceUrls = texts(form, 'raceRegistrationUrl');
  const editionId = text(form, 'editionId');

  try {
    await saveEventSite(await context(form), {
      organizationId: text(form, 'organizationId'),
      eventId: text(form, 'eventId'),
      accentColor: text(form, 'accentColor'),
      headingFont: text(form, 'headingFont'),
      contactEmail: text(form, 'contactEmail'),
      // Une rubrique laissée vide est une rubrique qu'on n'a pas écrite.
      sections: [
        ...topicKeys
          .map((topicKey, index) => ({ topicKey, body: topicBodies[index] ?? '' }))
          .filter((section) => section.body.trim() !== ''),
        ...titles
          .map((title, index) => ({
            title,
            body: bodies[index] ?? '',
            moment: moments[index] ?? '',
            topicKey: null,
          }))
          .filter((section) => section.title.trim() !== '' || section.body.trim() !== ''),
      ],
      content: {
        presentation: text(form, 'presentation'),
        venue: text(form, 'venue'),
        video: text(form, 'video'),
        figures: figureValues
          .map((value, index) => ({ value, label: figureLabels[index] ?? '' }))
          .filter((figure) => figure.value.trim() !== '' || figure.label.trim() !== ''),
        links: {
          results: text(form, 'linkResults'),
          live: text(form, 'linkLive'),
          volunteers: text(form, 'linkVolunteers'),
          newsletter: text(form, 'linkNewsletter'),
          facebook: text(form, 'linkFacebook'),
          instagram: text(form, 'linkInstagram'),
          strava: text(form, 'linkStrava'),
        },
      },
      // Nul : masqué, le formulaire n'envoie aucune ligne, et le programme ne doit pas être vidé.
      program:
        editionId === '' || !SITE_PROGRAM_VISIBLE
          ? null
          : programTitles
              .map((title, index) => ({
                day: programDays[index] ?? '',
                time: programTimes[index] ?? '',
                title,
                location: programLocations[index] ?? '',
              }))
              // Une ligne sans heure, sans intitulé ni lieu n'a pas été écrite.
              .filter((item) => `${item.time}${item.title}${item.location}`.trim() !== ''),
      registration:
        editionId === ''
          ? null
          : {
              editionId,
              editionUrl: text(form, 'editionRegistrationUrl'),
              races: raceIds.map((raceId, index) => ({ raceId, url: raceUrls[index] ?? '' })),
            },
    });
  } catch (error) {
    return failure(error);
  }

  done(form, 'enregistre');
}

export async function setSiteStatusAction(
  _previous: SiteActionState,
  form: FormData,
): Promise<SiteActionState> {
  const status = text(form, 'status');

  try {
    await setEventSiteStatus(await context(form), {
      organizationId: text(form, 'organizationId'),
      eventId: text(form, 'eventId'),
      status,
    });
  } catch (error) {
    return failure(error);
  }

  done(form, status === 'published' ? 'en-ligne' : 'hors-ligne');
}

export async function setDocumentPublicAction(
  _previous: SiteActionState,
  form: FormData,
): Promise<SiteActionState> {
  const isPublic = text(form, 'public') === 'true';

  try {
    await setEventSiteDocumentPublic(await context(form), {
      organizationId: text(form, 'organizationId'),
      eventId: text(form, 'eventId'),
      sourceId: text(form, 'sourceId'),
      public: isPublic,
    });
  } catch (error) {
    return failure(error);
  }

  done(form, isPublic ? 'document-diffuse' : 'document-retire');
}

export async function uploadSiteImageAction(
  _previous: SiteActionState,
  form: FormData,
): Promise<SiteActionState> {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choisissez une image.', fieldErrors: { file: 'Choisissez une image.' } };
  }

  try {
    await uploadEventSiteImage(await context(form), {
      organizationId: text(form, 'organizationId'),
      eventId: text(form, 'eventId'),
      kind: text(form, 'kind'),
      contentType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  } catch (error) {
    return failure(error);
  }

  done(form, text(form, 'kind') === 'cover' ? 'couverture' : 'logo');
}

export async function removeSiteImageAction(
  _previous: SiteActionState,
  form: FormData,
): Promise<SiteActionState> {
  try {
    await removeEventSiteImage(await context(form), {
      organizationId: text(form, 'organizationId'),
      eventId: text(form, 'eventId'),
      kind: text(form, 'kind'),
    });
  } catch (error) {
    return failure(error);
  }

  done(form, 'image-retiree');
}

export async function addSitePhotoAction(
  _previous: SiteActionState,
  form: FormData,
): Promise<SiteActionState> {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choisissez une image.', fieldErrors: { file: 'Choisissez une image.' } };
  }

  try {
    await addEventSiteGalleryPhoto(await context(form), {
      organizationId: text(form, 'organizationId'),
      eventId: text(form, 'eventId'),
      alt: text(form, 'alt'),
      contentType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  } catch (error) {
    return failure(error);
  }

  done(form, 'photo');
}

export async function removeSitePhotoAction(
  _previous: SiteActionState,
  form: FormData,
): Promise<SiteActionState> {
  try {
    await removeEventSiteGalleryPhoto(await context(form), {
      organizationId: text(form, 'organizationId'),
      eventId: text(form, 'eventId'),
      photoId: text(form, 'photoId'),
    });
  } catch (error) {
    return failure(error);
  }

  done(form, 'photo-retiree');
}
