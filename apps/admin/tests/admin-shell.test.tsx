import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminShell } from '@/components/admin-shell';
import { ADMIN_NAV, isFocusMode } from '@/components/admin-nav';

/**
 * Shell de la console — barre latérale du prototype (`screen === 'admin'`).
 *
 * Ce qui se vérifie ici :
 *
 * 1. le rendu serveur porte **les deux** navigations, et c'est la feuille qui
 *    choisit selon la largeur — aucune largeur n'est devinée au rendu ;
 * 2. le badge de « Validation » ne montre que ce qui a été lu, jamais un zéro
 *    inventé ;
 * 3. aucun élément du bandeau de démonstration du prototype ne passe dans le
 *    produit.
 */

let pathname = '/';

vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

const APP_URL = 'https://app.pluka.test';

async function signOut(): Promise<void> {}

function render(
  pendingValidation: number | null,
  appUrl = APP_URL,
  withSession = true,
  staffRole: 'super_admin' | 'admin' | 'support' | null = 'admin',
): string {
  return renderToStaticMarkup(
    <AdminShell
      pendingValidation={pendingValidation}
      appUrl={appUrl}
      signOut={withSession ? signOut : null}
      staffRole={staffRole}
    >
      <main>contenu</main>
    </AdminShell>,
  );
}

/** Le balisage de la barre latérale seule. */
function sidebar(markup: string): string {
  const match = /<aside class="ad-sidebar">([\s\S]*?)<\/aside>/.exec(markup);
  if (match === null) throw new Error('barre latérale absente');

  return match[1] as string;
}

beforeEach(() => {
  pathname = '/';
});

describe('barre latérale', () => {
  it('porte la marque et le périmètre du prototype', () => {
    const aside = sidebar(render(null));

    expect(aside).toContain('Administration');
    expect(aside).toContain('Équipe PLUKA · toutes organisations');
  });

  it('porte les neuf sections et Paramètres, chacune libellée et munie d’une icône décorative', () => {
    const aside = sidebar(render(null));

    for (const destination of ADMIN_NAV) {
      expect(aside).toContain(`href="${destination.href}"`);
      expect(aside).toContain(destination.label);
    }

    expect(aside.match(/class="pk-nav-item[^"]*pk-nav-item-on-dark"/g)).toHaveLength(10);
    expect(aside.match(/<span aria-hidden="true" class="pk-nav-item-icon">/g)).toHaveLength(10);
  });

  it('marque l’entrée active, et elle seule', () => {
    pathname = '/signalements/7f1a';
    const aside = sidebar(render(null));

    expect(aside.match(/aria-current="page"/g)).toHaveLength(1);
    expect(aside).toMatch(/href="\/signalements" aria-current="page"/);
  });

  it('mène aux deux autres espaces, dans apps/app', () => {
    const aside = sidebar(render(null, `${APP_URL}/`));

    expect(aside).toContain(`href="${APP_URL}/org"`);
    expect(aside).toContain('Espace organisateur');
    expect(aside).toContain(`href="${APP_URL}/"`);
    expect(aside).toContain('Espace coureur');
  });
});

describe('badge de Validation', () => {
  it('affiche le nombre d’extractions à examiner', () => {
    const aside = sidebar(render(7));

    expect(aside).toMatch(/href="\/validation"[\s\S]*?<span class="pk-nav-item-badge">7<\/span>/);
    expect(aside.match(/pk-nav-item-badge/g)).toHaveLength(1);
  });

  it('ne montre rien quand le compteur n’a pas été lu', () => {
    // Pas de session, ou pas `pluka_admin` : un zéro affirmerait « rien à
    // examiner », ce que personne n'a vérifié.
    expect(render(null)).not.toContain('pk-nav-item-badge');
  });

  it('ne montre rien quand il n’y a rien à examiner', () => {
    // `pending || null` dans le prototype : pas de pastille à zéro.
    expect(render(0)).not.toContain('pk-nav-item-badge');
  });
});

describe('bandeau du haut', () => {
  it('ne porte que le titre et le badge Équipe interne', () => {
    const markup = render(null);
    const header = /<header class="ad-topbar">([\s\S]*?)<\/header>/.exec(markup)?.[1] ?? '';

    expect(header).toContain('Administration PLUKA');
    expect(header).toContain('Équipe interne');
  });

  it('porte la déconnexion quand une session existe', () => {
    const header = /<header class="ad-topbar">([\s\S]*?)<\/header>/.exec(render(null))?.[1] ?? '';

    expect(header).toContain('Se déconnecter');
  });

  it('ne propose pas de déconnexion sans session — la page de connexion', () => {
    expect(render(null, APP_URL, false)).not.toContain('Se déconnecter');
  });

  it('ne reprend aucun élément du bandeau de démonstration du prototype', () => {
    const markup = render(3);

    for (const demo of ['Product Vision', 'prototype', 'simulées', 'Formule', 'Admin PLUKA ▾']) {
      expect(markup).not.toContain(demo);
    }
  });
});

describe('variante étroite', () => {
  it('rend aussi les neuf sections et Paramètres en onglets, sans icône', () => {
    const markup = render(null);
    const tabs = /<nav[^>]*class="pk-tabs ad-mobile-nav"[^>]*>([\s\S]*?)<\/nav>/.exec(markup)?.[1];

    expect(tabs).toBeDefined();
    expect(tabs?.match(/class="pk-tab[ "]/g)).toHaveLength(10);
    expect(tabs).not.toContain('<svg');
  });

  it('laisse la feuille choisir, au seuil de 1100 px du prototype', () => {
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app', 'admin.css'),
      'utf8',
    );

    // Hors media query, la barre latérale est masquée ; au-delà de 1100 px,
    // elle apparaît et les onglets disparaissent.
    expect(css).toMatch(/\.ad-sidebar \{[^}]*display: none;/);
    expect(css).toMatch(
      /@media \(width >= 1100px\) \{[\s\S]*?\.ad-sidebar \{[^}]*display: flex;[\s\S]*?\.ad-mobile-nav \{[^}]*display: none;/,
    );
  });
});

describe('contenu', () => {
  it('enveloppe la page sous la cible du lien d’évitement', () => {
    const markup = render(null);

    expect(markup).toContain('href="#contenu"');
    expect(markup).toContain('<div id="contenu" class="ad-content"><main>contenu</main></div>');
  });

  it('« Paramètres » tout en bas, pour toute l’équipe : le journal y vit', () => {
    for (const role of ['super_admin', 'admin', 'support'] as const) {
      const aside = sidebar(render(null, APP_URL, true, role));

      expect(aside, role).toContain('href="/parametres"');
      // Le journal n'est plus une section de travail.
      expect(aside, role).not.toContain('href="/journal"');
      // Après les sections de travail : dans le pied de la barre, avant les autres espaces.
      expect(aside.indexOf('href="/parametres"')).toBeGreaterThan(
        aside.indexOf('href="/traitements"'),
      );
      expect(aside.indexOf('href="/parametres"')).toBeLessThan(
        aside.indexOf('Espace organisateur'),
      );
    }
    // Rôle inconnu : pas de Paramètres.
    expect(sidebar(render(null, APP_URL, true, null))).not.toContain('href="/parametres"');
  });

  it('ne montre au support que ce qu’il peut lire', () => {
    const support = sidebar(render(null, APP_URL, true, 'support'));

    for (const href of [
      '/vue-d-ensemble',
      '/organisations',
      '/utilisateurs',
      '/traitements',
      '/parametres',
    ]) {
      expect(support).toContain(`href="${href}"`);
    }
    for (const href of ['/validation', '/sources', '/produits', '/signalements']) {
      expect(support).not.toContain(`href="${href}"`);
    }
  });
});

describe('plein écran', () => {
  it('garde la barre latérale et efface le bandeau pendant la création d’un événement', () => {
    pathname = '/evenements/nouveau';
    const markup = render(null);

    expect(markup).toContain('ad-sidebar');
    expect(markup).not.toContain('ad-topbar');
    expect(markup).toContain('href="#contenu"');
    expect(markup).toContain('<main>contenu</main>');
  });

  it('ne touche à aucun autre écran, fiche d’événement comprise', () => {
    expect(isFocusMode('/evenements/nouveau')).toBe(true);
    expect(isFocusMode('/organisations/nouvelle')).toBe(true);
    expect(isFocusMode('/organisations')).toBe(false);
    expect(isFocusMode('/evenements/abc')).toBe(false);
    expect(isFocusMode('/evenements/nouveautes')).toBe(false);
  });
});
