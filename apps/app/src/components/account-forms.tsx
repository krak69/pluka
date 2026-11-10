'use client';

import { useActionState } from 'react';

import { requestAccountDeletionAction, type AccountActionState } from '@/app/account-actions';

const INITIAL: AccountActionState = {};

/**
 * Confirmer la suppression du compte. « Supprimer mon compte » a déjà ouvert
 * ce panneau : ce bouton est la confirmation. La règle — qui peut partir, et
 * quand — est en base (0078).
 */
export function DeleteAccountForm() {
  const [state, action, pending] = useActionState(requestAccountDeletionAction, INITIAL);

  return (
    <form action={action} className="or-form">
      <input type="hidden" name="confirmed" value="on" />
      <p className="pk-field-hint">
        Ton compte est fermé tout de suite, sur tous tes appareils. Tes données sont effacées
        définitivement dans 30 jours : d’ici là, te reconnecter annule la suppression.
      </p>
      <p className="pk-field-hint">
        Tes courses venues d’une organisation lui restent, sans ta préparation. Ce que tu as publié
        dans la communauté reste, sans ton nom.
      </p>

      <div>
        <button type="submit" className="pk-btn pk-button-destructive" disabled={pending}>
          Confirmer la suppression
        </button>
      </div>

      {state.error === undefined ? null : (
        <p className="pk-field-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
