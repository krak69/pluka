'use client';

import { Input, TerrainBand } from '@pluka/ui';
import Link from 'next/link';
import { useActionState, useState } from 'react';

import type { ActionState } from '@/app/actions';
import { createOrganizationAction } from '@/app/console-actions';
import { AdminIcon } from '@/components/admin-icon';
import { slugify } from '@/lib/slug';

const INITIAL: ActionState = {};

/**
 * Créer une organisation — même grammaire que la création d'événement :
 * plein écran (la barre latérale reste), bandeau de terrain en tête, carte
 * centrée dessous.
 *
 * Le bandeau pose la scène : le nom saisi s'y compose, et trois lignes disent
 * ce qui suit la création — statut « Actif », aucun membre, puis inviter le
 * propriétaire depuis la fiche. La carte ne demande que l'essentiel.
 *
 * L'« adresse web » est le slug du domaine : l'identifiant public de
 * l'organisation dans les adresses (05_ROUTES_FLOWS §1.9). Elle est proposée
 * depuis le nom, suit le nom tant qu'on ne l'a pas touchée, et se retrouve
 * d'un clic. Elle ne change plus après la création — la phrase le dit.
 *
 * Aucune règle ici : `createOrganization` valide et ce formulaire affiche son
 * refus, contre le champ quand il en nomme un, en tête sinon. Le champ garde
 * le nom `slug` : c'est celui de la commande.
 */
export function CreateOrganizationForm() {
  const [state, action, pending] = useActionState(createOrganizationAction, INITIAL);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const errors = state.fieldErrors ?? {};
  const proposed = slugify(name);

  function changeName(value: string): void {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  return (
    <div className="ad-wizard">
      <TerrainBand
        tone="dark"
        topo
        level={1}
        className="ad-wizard-band"
        eyebrow="Nouvelle organisation"
        title={name.trim() === '' ? 'Une organisation de course' : name}
        body={
          <ol className="ad-org-create-next" aria-label="Ce qui suit la création">
            <li>
              <span className="ad-org-create-step">1</span>
              <span>
                Elle est créée au statut <strong>Actif</strong>, sans membre.
              </span>
            </li>
            <li>
              <span className="ad-org-create-step">2</span>
              <span>
                Depuis sa fiche, tu invites son <strong>propriétaire</strong> par email.
              </span>
            </li>
            <li>
              <span className="ad-org-create-step">3</span>
              <span>
                Ses <strong>événements</strong> s’y rattachent à leur création.
              </span>
            </li>
          </ol>
        }
        footer={
          <p className="ad-wizard-tip">
            <span className="pk-label">Bon à savoir</span> Rien n’est enregistré avant « Créer
            l’organisation ». L’adresse web, elle, ne changera plus ensuite.
          </p>
        }
        secondaryAction={
          <Link href="/organisations" className="ad-wizard-exit">
            <AdminIcon name="XCircle" size={16} />
            Quitter
          </Link>
        }
      />

      <div className="ad-wizard-main">
        <form action={action} className="ad-wizard-card ad-org-create-card">
          <section className="ad-org-create-section" aria-labelledby="org-identity">
            <h2 id="org-identity" className="ad-org-create-title">
              Identité
            </h2>

            <Input
              id="organization-name"
              name="name"
              label="Nom de l’organisation"
              placeholder="Ex. Association Trail des Crêtes"
              required
              autoComplete="off"
              value={name}
              onChange={(change) => changeName(change.target.value)}
              error={errors['name']}
            />

            <div className="ad-org-create-address">
              <Input
                id="organization-slug"
                name="slug"
                label="Adresse web"
                required
                autoComplete="off"
                spellCheck={false}
                hint="L’identifiant de l’organisation dans les adresses PLUKA. Proposé depuis le nom : minuscules, chiffres et tirets. Il ne change plus après la création."
                value={slug}
                onChange={(change) => {
                  setSlugTouched(true);
                  setSlug(change.target.value);
                }}
                error={errors['slug']}
              />
              {slugTouched && proposed !== '' && proposed !== slug ? (
                <button
                  type="button"
                  className="ad-org-create-reset"
                  onClick={() => {
                    setSlug(proposed);
                    setSlugTouched(false);
                  }}
                >
                  Reprendre la proposition : {proposed}
                </button>
              ) : null}
              <p className="ad-org-create-preview" aria-live="polite">
                <AdminIcon name="Globe" size={14} />
                <span className="ad-mono">
                  …/{slug === '' ? 'adresse-de-l-organisation' : slug}
                </span>
              </p>
            </div>
          </section>

          <section className="ad-org-create-section" aria-labelledby="org-contact">
            <h2 id="org-contact" className="ad-org-create-title">
              Contact <span className="ad-row-meta">— facultatif</span>
            </h2>
            <div className="ad-form-grid">
              <Input
                id="organization-contact-email"
                name="contactEmail"
                type="email"
                label="Email de contact"
                placeholder="contact@…"
                autoComplete="off"
                hint="Une adresse de l’organisation, pas celle d’une personne."
                error={errors['contactEmail']}
              />
              <Input
                id="organization-website"
                name="websiteUrl"
                type="url"
                label="Site web"
                placeholder="https://"
                autoComplete="off"
                error={errors['websiteUrl']}
              />
            </div>
          </section>

          <div className="ad-step-actions">
            <Link href="/organisations" className="ad-org-create-cancel">
              Annuler
            </Link>
            <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
              {pending ? 'Création…' : 'Créer l’organisation'}
            </button>
          </div>

          {state.error === undefined || state.fieldErrors !== undefined ? null : (
            <p className="pk-field-error" role="alert">
              {state.error}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
