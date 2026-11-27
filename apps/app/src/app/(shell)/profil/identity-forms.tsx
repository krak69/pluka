'use client';

import type { AvatarIllustration, ProfileSex } from '@pluka/db';
import { AVATAR_ILLUSTRATIONS, NAME_MAX } from '@pluka/domain';
import { Input } from '@pluka/ui';
import { useActionState, useEffect, useRef, useState } from 'react';

import {
  removeAvatarAction,
  updateIdentityAction,
  uploadAvatarAction,
  type IdentityFormState,
} from '@/app/(shell)/profil/identity-actions';
import { Avatar, AvatarArt, ILLUSTRATION_LABELS, type AvatarSource } from '@/components/avatar';
import { Icon } from '@/components/icon';

const INITIAL: IdentityFormState = {};

const SEX_OPTIONS: readonly { readonly value: ProfileSex | ''; readonly label: string }[] = [
  { value: '', label: 'Non précisé' },
  { value: 'female', label: 'Femme' },
  { value: 'male', label: 'Homme' },
  { value: 'other', label: 'Autre' },
];

/**
 * La photo de profil : choisie, elle part aussitôt ; sans JavaScript, un
 * bouton l'envoie. Le serveur la recadre au carré et en retire les
 * métadonnées (0115).
 */
export function PhotoForm({
  avatar,
  hasPhoto,
}: {
  readonly avatar: AvatarSource;
  readonly hasPhoto: boolean;
}) {
  const [state, upload, uploading] = useActionState(uploadAvatarAction, INITIAL);
  const [removeState, remove, removing] = useActionState(removeAvatarAction, INITIAL);
  const form = useRef<HTMLFormElement>(null);
  // Avant l'hydratation, rien n'envoie le fichier tout seul : le bouton le fait.
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);

  const error = state.error ?? removeState.error;

  return (
    <div className="pf-photo">
      <Avatar avatar={avatar} size={96} label="Ta photo de profil" />
      <div className="pf-photo-side">
        <div className="pf-photo-actions">
          <form ref={form} action={upload} className="pf-photo-form">
            <label className="pk-btn pk-button-secondary pf-file" aria-busy={uploading}>
              <Icon name="Camera" size={18} />
              {uploading ? 'Envoi…' : hasPhoto ? 'Changer de photo' : 'Ajouter une photo'}
              <input
                type="file"
                name="photo"
                accept="image/jpeg,image/png,image/webp"
                className="pk-visually-hidden"
                disabled={uploading}
                onChange={(event) => {
                  if (interactive && event.currentTarget.files?.length)
                    form.current?.requestSubmit();
                }}
              />
            </label>
            {interactive ? null : (
              <button type="submit" className="pk-btn pk-button-secondary">
                Envoyer la photo
              </button>
            )}
          </form>
          {hasPhoto ? (
            <form action={remove}>
              <button type="submit" className="pf-text-button" disabled={removing}>
                {removing ? 'Retrait…' : 'Retirer la photo'}
              </button>
            </form>
          ) : null}
        </div>
        <p className="pf-hint">
          JPEG, PNG ou WebP, 10&nbsp;Mo au plus. Recadrée au carré&nbsp;; ses métadonnées, position
          GPS comprise, sont retirées. Elle n’apparaît que là où tu écris dans la Communauté.
        </p>
        {error === undefined ? null : (
          <p className="pk-field-error" role="alert">
            {error}
          </p>
        )}
        {state.saved === true && !uploading ? (
          <p className="pf-saved" role="status">
            <Icon name="Check" size={16} />
            Photo enregistrée.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Prénom, nom, sexe facultatif et illustration : ce qui te représente dans la Communauté. */
export function IdentityForm({
  firstName,
  lastName,
  sex,
  avatarIllustration,
  autoIllustration,
}: {
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly sex: ProfileSex | null;
  readonly avatarIllustration: AvatarIllustration | null;
  /** Ce que donne « Selon mon sexe » avec le sexe enregistré. */
  readonly autoIllustration: AvatarIllustration;
}) {
  const [state, save, pending] = useActionState(updateIdentityAction, INITIAL);
  const errors = state.fieldErrors ?? {};
  const values = state.values;
  const chosen = values?.avatarIllustration ?? avatarIllustration ?? '';

  return (
    <form action={save} className="pf-form">
      <div className="pf-row">
        <Input
          id="pf-first-name"
          name="firstName"
          label="Prénom"
          autoComplete="given-name"
          maxLength={NAME_MAX}
          defaultValue={values?.firstName ?? firstName ?? ''}
          error={errors.firstName}
        />
        <Input
          id="pf-last-name"
          name="lastName"
          label="Nom"
          hint="Seule son initiale s’affiche dans la Communauté."
          autoComplete="family-name"
          maxLength={NAME_MAX}
          defaultValue={values?.lastName ?? lastName ?? ''}
          error={errors.lastName}
        />
      </div>

      <div className="pk-field">
        <label className="pk-field-label" htmlFor="pf-sex">
          Sexe (facultatif)
        </label>
        <select
          // Un menu ne relit pas `defaultValue` après le montage : la clé le recrée.
          key={`sex-${values?.sex ?? sex ?? ''}`}
          id="pf-sex"
          name="sex"
          className="pk-input"
          defaultValue={values?.sex ?? sex ?? ''}
          aria-describedby="pf-sex-hint"
        >
          {SEX_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p id="pf-sex-hint" className="pk-field-hint">
          Il ne sert qu’à choisir ton illustration quand tu n’en choisis pas une. Personne d’autre
          ne le voit.
        </p>
        {errors.sex === undefined ? null : <p className="pk-field-error">{errors.sex}</p>}
      </div>

      <fieldset className="pf-illustrations">
        <legend className="pk-field-label">Sans photo, on te représente par</legend>
        <div className="pf-illustration-grid">
          <label className="pf-illustration">
            <input type="radio" name="avatarIllustration" value="" defaultChecked={chosen === ''} />
            <AvatarArt kind={autoIllustration} size={56} />
            <span>Selon mon sexe</span>
          </label>
          {AVATAR_ILLUSTRATIONS.map((kind) => (
            <label key={kind} className="pf-illustration">
              <input
                type="radio"
                name="avatarIllustration"
                value={kind}
                defaultChecked={chosen === kind}
              />
              <AvatarArt kind={kind} size={56} />
              <span>{ILLUSTRATION_LABELS[kind]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="pf-form-foot">
        <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
          {pending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        {state.error === undefined ? null : (
          <p className="pk-field-error" role="alert">
            {state.error}
          </p>
        )}
        {state.saved === true && !pending ? (
          <p className="pf-saved" role="status">
            <Icon name="Check" size={16} />
            Enregistré.
          </p>
        ) : null}
      </div>
    </form>
  );
}
