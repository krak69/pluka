import Link from 'next/link';

import { BankHeader } from '@/app/produits/tabs';
import { AdminEmpty } from '@/components/admin-page';
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
      <BankHeader current="/produits/signalements" />

      <AdminEmpty icon="Flag" title="Aucun signalement.">
        <p>Signaler une fiche nutrition n’existe pas encore : le modèle de données ne connaît que les signalements de contenus de forum.</p>
        <p>
          Ceux-là ont leur file :{' '}
          <Link href="/signalements" className="pk-link">
            Signalements
          </Link>
          .
        </p>
      </AdminEmpty>
    </main>
  );
}
