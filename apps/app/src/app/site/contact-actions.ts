'use server';

import { DomainError, siteRootDomain, siteSlugFromHost, submitEventSiteContact } from '@pluka/domain';
import { headers } from 'next/headers';

import { publicEnv } from '@/lib/env';
import { eventSiteContext } from '@/lib/event-site';

/**
 * Le formulaire de contact d'un site — EVENT_SITE §6.
 *
 * Le site visé se lit dans l'hôte de la requête, jamais dans le formulaire :
 * on n'écrit qu'au site qu'on regarde. Le message est mis en file ; le worker
 * l'envoie et l'efface (0052).
 *
 * Anti-abus, sans service tiers : un champ que seuls les robots remplissent,
 * une durée minimale entre l'affichage et l'envoi, la limite de débit en base.
 * Un robot démasqué reçoit la même réponse qu'un envoi réussi : rien ne lui
 * apprend ce qui l'a trahi.
 */

export interface ContactActionState {
  readonly status?: 'sent' | 'limited' | 'error';
  readonly error?: string;
  readonly fieldErrors?: Readonly<Record<string, string>>;
}

/* Un humain met plus de trois secondes à écrire un message. */
const MIN_FILL_MS = 3000;

function text(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === 'string' ? value : '';
}

/** La première adresse de `X-Forwarded-For`, posée par l'hébergeur. */
function clientIp(list: Headers): string | null {
  const forwarded = list.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded !== undefined && forwarded !== '') return forwarded.slice(0, 64);
  return list.get('x-real-ip')?.slice(0, 64) ?? null;
}

export async function submitContactAction(
  _previous: ContactActionState,
  form: FormData,
): Promise<ContactActionState> {
  const list = await headers();
  const slug = siteSlugFromHost(list.get('host'), siteRootDomain(publicEnv().NEXT_PUBLIC_APP_URL));
  if (slug === null) return { status: 'error', error: 'Ce formulaire ne s’envoie que depuis le site.' };

  const renderedAt = Number.parseInt(text(form, 'renderedAt'), 10);
  const tooFast = !Number.isFinite(renderedAt) || Date.now() - renderedAt < MIN_FILL_MS;
  if (text(form, 'website') !== '' || tooFast) return { status: 'sent' };

  try {
    const status = await submitEventSiteContact(eventSiteContext(), {
      slug,
      clientIp: clientIp(list),
      senderName: text(form, 'name'),
      senderEmail: text(form, 'email'),
      raceSlug: text(form, 'race'),
      body: text(form, 'message'),
    });
    return { status };
  } catch (error) {
    if (error instanceof DomainError && error.code === 'validation') {
      return {
        status: 'error',
        error: 'Certaines informations sont à corriger.',
        fieldErrors: error.details,
      };
    }
    if (error instanceof DomainError && error.code === 'not_found') {
      return { status: 'error', error: 'Ce site ne reçoit pas de message pour l’instant.' };
    }
    console.error('contact : erreur non traduite', {
      name: error instanceof Error ? error.name : 'inconnu',
    });
    return { status: 'error', error: 'Le message n’est pas parti. Réessayez dans un instant.' };
  }
}
