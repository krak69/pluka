import { EmptyState, SectionHeader } from '@pluka/ui';
import Link from 'next/link';

import { ProductTabs } from '@/app/produits/tabs';
import { requireAdminConsoleGate } from '@/lib/admin';

/**
 * Banque Nutrition, signalements — non branché.
 *
 * Le prototype propose ce sous-onglet, mais `community_reports` ne cible que des
 * contenus de forum : elle porte deux clés étrangères, `thread_id` et
 * `post_id`, avec une contrainte qui en exige exactement une. Rien n'y pointe
 * vers un produit nutritionnel — ni colonne, ni table.
 *
 * L'écran le dit au lieu de recycler les signalements de forum, qui portent sur
 * autre chose : une file de triage qui mélangerait deux objets ferait prendre
 * des décisions sur le mauvais.
 *
 * La page ne lit rien, mais elle reste gardée : sans cela, elle serait le seul
 * onglet de la console qu'un compte sans droit pourrait ouvrir. `requireAdminConsoleGate`
 * demande le refus, pas la donnée.
 */
export const metadata = { title: 'Signalements de fiches' };

export default async function ProductReportsPage() {
  await requireAdminConsoleGate('/produits/signalements');

  return (
    <main className="ad-page">
      <SectionHeader eyebrow="Administration" title="Banque Nutrition" />

      <ProductTabs current="/produits/signalements" />

      <EmptyState
        label="Signalements de fiches"
        title="Signaler une fiche n’existe pas encore."
        detail="Le modèle de données ne connaît que les signalements de contenus de forum."
      >
        <p>
          Rien n’est masqué ici : il n’y a pas de table où une fiche nutrition pourrait être
          signalée. La fonctionnalité demande une migration, pas un écran.
        </p>
        <p>
          Les signalements de forum, eux, ont leur file :{' '}
          <Link href="/signalements" className="pk-link">
            Signalements
          </Link>
          .
        </p>
      </EmptyState>
    </main>
  );
}
