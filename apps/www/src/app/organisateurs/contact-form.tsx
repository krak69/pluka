'use client';

import { ArrowRightIcon, LockSimpleIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr';
import { useActionState } from 'react';

import { requestPresentation } from '@/app/organisateurs/actions';
import { initialContactOutcome } from '@/app/organisateurs/contact-outcome';
import { contact } from '@/content/organisateurs';

/**
 * Formulaire « Parler de mon événement ».
 *
 * La composition, les cinq champs, leurs libellés et leurs exemples viennent du
 * prototype. Le champ « Participants attendus » y est explicitement facultatif,
 * les quatre autres ne le sont pas — d'où `required`, que le prototype ne pose
 * pas mais que le titre du panneau annonce (« Quatre champs suffisent »).
 *
 * L'état de sortie diffère volontairement du prototype, qui affiche un accusé
 * d'envoi simulé. Aucune destination n'existe : voir `actions.ts`. Le panneau
 * de sortie le dit, et rien n'est envoyé ni conservé.
 *
 * `useActionState` conserve la soumission fonctionnelle sans JavaScript : le
 * `<form action>` d'un Server Action est soumis par le navigateur, et la page
 * revient avec l'état.
 */
export function ContactForm() {
  const [outcome, formAction, pending] = useActionState(requestPresentation, initialContactOutcome);

  return (
    <div className="lp-form-card">
      <div className="lp-form-head lp-topo">
        <p className="pk-label lp-label-lichen" style={{ marginBottom: 'var(--space-2)' }}>
          {contact.formLabel}
        </p>
        <p className="lp-hd lp-h3-19" style={{ lineHeight: 1.2 }}>
          {contact.formTitle}
        </p>
      </div>

      <div className="lp-form-body">
        {outcome.state === 'unconfigured' ? (
          <div className="lp-form-outcome" role="status">
            <div className="lp-form-outcome-head">
              <WarningCircleIcon size={26} className="lp-icon-warning" />
              <span className="pk-label lp-label-forest">Formulaire non branché</span>
            </div>

            <h3 className="lp-hd" style={{ fontSize: '22px', margin: 'var(--space-4) 0 10px' }}>
              Votre demande n’a pas été envoyée.
            </h3>

            <p
              className="lp-p-15"
              style={{ color: 'var(--pk-text-secondary)', margin: '0 0 var(--space-3)' }}
            >
              Ce formulaire n’a pas encore de destination : ni boîte de réception, ni
              enregistrement. Rien de ce que vous avez saisi n’a été transmis ni conservé.
            </p>

            <p className="lp-note-12" style={{ margin: '0 0 var(--space-5)' }}>
              Le canal de contact organisateur reste à définir. En attendant, ce panneau dit ce qui
              se passe réellement plutôt que d’afficher un accusé de réception.
            </p>
          </div>
        ) : null}

        <form action={formAction} className="lp-stack lp-gap-5">
          <div className="pk-field">
            <label className="pk-field-label" htmlFor="org-event">
              Nom de l’événement
            </label>
            <input
              id="org-event"
              name="event"
              className="pk-input"
              placeholder="Wildstrubel by UTMB"
              required
            />
          </div>

          <div className="lp-form-grid">
            <div className="pk-field">
              <label className="pk-field-label" htmlFor="org-name">
                Votre nom et fonction
              </label>
              <input
                id="org-name"
                name="name"
                className="pk-input"
                placeholder="Responsable coureurs"
                required
              />
            </div>

            <div className="pk-field">
              <label className="pk-field-label" htmlFor="org-count">
                Participants attendus · facultatif
              </label>
              <input
                id="org-count"
                name="participants"
                className="pk-input"
                inputMode="numeric"
                placeholder="1 200"
              />
            </div>
          </div>

          <div className="pk-field">
            <label className="pk-field-label" htmlFor="org-mail">
              Email professionnel
            </label>
            <input
              id="org-mail"
              name="email"
              type="email"
              className="pk-input"
              placeholder="organisation@monevenement.fr"
              required
            />
          </div>

          <div className="pk-field">
            <label className="pk-field-label" htmlFor="org-msg">
              Votre épreuve en quelques mots
            </label>
            <textarea
              id="org-msg"
              name="message"
              className="pk-input"
              rows={3}
              placeholder="Nombre d’épreuves, date de la prochaine édition, ce que vous aimeriez améliorer…"
              required
            />
          </div>

          <button
            type="submit"
            className="pk-btn pk-button-primary"
            style={{ width: '100%', marginTop: '2px' }}
            disabled={pending}
          >
            {contact.submit}
            <ArrowRightIcon size={20} />
          </button>

          <div className="lp-form-privacy">
            <LockSimpleIcon size={15} className="lp-scatter-icon" style={{ marginTop: '2px' }} />
            <p className="lp-note-12">{contact.privacyNote}</p>
          </div>
        </form>
      </div>
    </div>
  );
}
