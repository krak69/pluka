import { AVATAR_ILLUSTRATIONS, updateAccountIdentityCommandSchema } from '@pluka/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { IdentityForm, PhotoForm } from '@/app/(shell)/profil/identity-forms';
import { Avatar, ILLUSTRATION_LABELS } from '@/components/avatar';

/**
 * Mon profil · Identité — 03_PRIVACY_RLS §54.1 ; 0115.
 *
 * L'avatar montre une photo par lien temporaire, sans référent, ou l'une des
 * trois illustrations ; le formulaire poste exactement les champs de la
 * commande du domaine, et l'illustration « Selon mon sexe » est le choix vide.
 */

function fieldNames(markup: string): readonly string[] {
  return [
    ...new Set(
      [...markup.matchAll(/<(?:input|select|textarea)\b[^>]*\bname="([^"]+)"/g)].map(
        (match) => match[1] as string,
      ),
    ),
  ].sort();
}

describe('avatar', () => {
  it('une photo : un lien qui ne transmet pas l’adresse de la page, décoratif à côté d’un nom', () => {
    const markup = renderToStaticMarkup(
      <Avatar avatar={{ kind: 'photo', url: 'https://stockage/a.webp?token=x' }} size={30} />,
    );

    expect(markup).toContain('src="https://stockage/a.webp?token=x"');
    expect(markup).toContain('referrerPolicy="no-referrer"');
    expect(markup).toContain('alt=""');
    expect(markup).toContain('aria-hidden="true"');
  });

  it('une illustration dessinée, sans couleur littérale ; seule, elle porte un libellé', () => {
    const markup = renderToStaticMarkup(
      <Avatar avatar={{ kind: 'woman' }} size={96} label="Ta photo de profil" />,
    );

    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Ta photo de profil"');
    expect(markup).toContain('class="av-hair"');
    expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
  });

  it('chaque illustration a son nom', () => {
    expect(AVATAR_ILLUSTRATIONS.map((kind) => ILLUSTRATION_LABELS[kind])).toEqual([
      'Neutre',
      'Homme',
      'Femme',
    ]);
  });
});

describe('formulaire d’identité', () => {
  const markup = renderToStaticMarkup(
    <IdentityForm
      firstName="Alice"
      lastName="Dupont"
      sex="female"
      avatarIllustration={null}
      autoIllustration="woman"
    />,
  );

  it('poste les champs de la commande, ni plus ni moins', () => {
    expect(fieldNames(markup)).toEqual(
      Object.keys(updateAccountIdentityCommandSchema.shape).sort(),
    );
  });

  it('« Selon mon sexe » est le choix vide, coché tant qu’aucune illustration n’est choisie', () => {
    const radios = [...markup.matchAll(/<input\b[^>]*name="avatarIllustration"[^>]*>/g)].map(
      (match) => match[0],
    );

    expect(radios.map((tag) => /value="([a-z]*)"/u.exec(tag)?.[1])).toEqual([
      '',
      ...AVATAR_ILLUSTRATIONS,
    ]);
    expect(radios[0]).toContain('checked=""');
    expect(markup).toContain('<option value="female" selected="">Femme</option>');
  });
});

describe('photo', () => {
  it('un seul fichier, d’un format que le serveur sait réencoder', () => {
    const markup = renderToStaticMarkup(<PhotoForm avatar={{ kind: 'neutral' }} hasPhoto />);

    expect(fieldNames(markup)).toEqual(['photo']);
    expect(markup).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(markup).toContain('Retirer la photo');
    // Sans JavaScript, un bouton envoie le fichier.
    expect(markup).toContain('Envoyer la photo');
  });
});
