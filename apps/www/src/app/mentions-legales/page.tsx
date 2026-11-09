import type { Metadata } from 'next';
import Link from 'next/link';

import { SiteFooter } from '@/components/site-footer';
import * as home from '@/content/homepage';
import { LEGAL, legalComplete } from '@/content/legal';

/**
 * Mentions légales — loi pour la confiance dans l'économie numérique (LCEN).
 *
 * L'éditeur et son contact viennent de `content/legal.ts` ; l'hébergeur est
 * celui que déclarent ses propres conditions (vérifié le 2026-11-09). Tant que
 * l'éditeur n'est pas renseigné, la page n'est pas indexée.
 */
export function generateMetadata(): Metadata {
  return {
    title: 'Mentions légales — PLUKA',
    robots: legalComplete() ? undefined : { index: false, follow: false },
  };
}

const TODO = '[à compléter]';

export default function LegalNoticePage() {
  const email = LEGAL.privacyEmail;

  return (
    <div className="lp-shell">
      <main className="lp-main lp-legal">
        <p>
          <Link href="/">PLUKA</Link>
        </p>

        <h1>Mentions légales</h1>

        <h2>Éditeur</h2>
        <p>
          PLUKA est édité par {LEGAL.editorName ?? TODO}, à titre personnel pendant la phase de
          bêta, sans société constituée. Contact :{' '}
          {email === null ? TODO : <a href={`mailto:${email}`}>{email}</a>}.
        </p>

        <h2>Directeur de la publication</h2>
        <p>{LEGAL.editorName ?? TODO}.</p>

        <h2>Hébergement</h2>
        <p>
          Le site et l’application sont hébergés par Vercel Inc., 440 N Barranca Ave #4133, Covina,
          CA 91723, États-Unis (vercel.com). Les données sont stockées par Supabase Inc.
          (supabase.com).
        </p>

        <h2>Propriété</h2>
        <p>
          La marque, les textes, les visuels et le code de PLUKA sont protégés. Les informations
          officielles d’une course appartiennent à son organisation, qui les publie ; PLUKA en cite
          la source.
        </p>

        <h2>Données personnelles</h2>
        <p>
          Voir la <Link href="/confidentialite">politique de confidentialité</Link>.
        </p>
      </main>

      <SiteFooter
        layout="grid"
        tagline={home.footerTagline}
        columns={home.footerColumns}
        domain="pluka.run"
        disclaimer={home.footerDisclaimer}
      />
    </div>
  );
}
