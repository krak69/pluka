'use client';

import { useActionState, useId, useState } from 'react';

import { submitContactAction, type ContactActionState } from '@/app/site/contact-actions';

/**
 * Le formulaire de contact d'un site — EVENT_SITE §6.
 *
 * Client pour `useActionState` : le refus ou la confirmation s'affichent à la
 * place du geste. Aucune règle ici ; le champ `website` est un pot de miel,
 * caché aux humains et aux lecteurs d'écran.
 */

const INITIAL: ContactActionState = {};

export function SiteContactForm({
  eventName,
  races,
}: {
  readonly eventName: string;
  readonly races: readonly { readonly slug: string; readonly name: string }[];
}) {
  const [state, action, pending] = useActionState(submitContactAction, INITIAL);
  const [renderedAt] = useState(() => String(Date.now()));
  const id = useId();
  const errors = state.fieldErrors ?? {};

  if (state.status === 'sent') {
    return (
      <p className="es-contact-done" role="status">
        Message envoyé à l’équipe de {eventName}. Elle vous répondra à l’adresse indiquée.
      </p>
    );
  }

  return (
    <form action={action} className="es-contact-form" noValidate>
      <input type="hidden" name="renderedAt" value={renderedAt} />
      <div className="es-honeypot" aria-hidden="true">
        <label htmlFor={`${id}-website`}>Ne pas remplir</label>
        <input id={`${id}-website`} name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="es-contact-row">
        <Field id={`${id}-name`} label="Nom" error={errors['senderName']}>
          <input id={`${id}-name`} name="name" autoComplete="name" required maxLength={120} />
        </Field>
        <Field id={`${id}-email`} label="E-mail" error={errors['senderEmail']}>
          <input id={`${id}-email`} name="email" type="email" autoComplete="email" required maxLength={254} />
        </Field>
      </div>

      {races.length === 0 ? null : (
        <Field id={`${id}-race`} label="Épreuve concernée (facultatif)">
          <select id={`${id}-race`} name="race" defaultValue="">
            <option value="">Aucune en particulier</option>
            {races.map((race) => (
              <option key={race.slug} value={race.slug}>
                {race.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field id={`${id}-message`} label="Message" error={errors['body']}>
        <textarea id={`${id}-message`} name="message" rows={5} required maxLength={5000} />
      </Field>

      <div className="es-contact-actions">
        <button type="submit" className="es-submit" disabled={pending}>
          {pending ? 'Envoi…' : 'Envoyer le message'}
        </button>
        {state.status === 'limited' ? (
          <p className="es-contact-error" role="alert">
            Trop de messages envoyés depuis cette connexion. Réessayez dans une heure.
          </p>
        ) : null}
        {state.status === 'error' && state.fieldErrors === undefined ? (
          <p className="es-contact-error" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly error?: string | undefined;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="es-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error === undefined ? null : (
        <p className="es-contact-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}
