import { listMyEquipment } from '@pluka/domain';
import Link from 'next/link';

import { removeFromMyEquipmentAction } from '@/app/(shell)/bibliotheque/materiel/actions';
import { AddToLibraryForm } from '@/app/(shell)/bibliotheque/materiel/add-to-library-form';
import { Icon } from '@/components/icon';
import { libraryContext } from '@/lib/library';
import { requireSession } from '@/lib/session';

/**
 * Bibliothèque · Matériel — « Mon matériel ». 00_PRODUCT_SPEC §20 ;
 * 04_ENTITLEMENTS §48 ; décision produit du 2026-11-13.
 *
 * Tout ce que le coureur possède, pour l'ajouter d'un clic à la Préparation
 * d'une course au lieu de le retaper. Avec PLUKA+, chaque pièce saisie dans
 * une course y entre d'elle-même. Le lire est gratuit : un PLUKA+ expiré garde
 * son matériel ; l'écrire est PLUKA+.
 */
export const metadata = { title: 'Matériel · Bibliothèque' };

export default async function EquipmentLibraryPage() {
  const session = await requireSession('/bibliotheque/materiel');
  const mine = await listMyEquipment(libraryContext(session));

  return (
    <div className="lb-page">
      <header className="lb-intro">
        <h1 className="lb-title">Mon matériel</h1>
        <p className="lb-sub">
          Tout ce que tu possèdes, à reprendre d’un clic dans la préparation de tes courses — sans
          rien retaper. Les pièces que tu ajoutes à une course s’y enregistrent d’elles-mêmes.
        </p>
      </header>

      {mine.items.length === 0 ? (
        <p className="lb-empty">
          {mine.canEdit
            ? 'Rien pour l’instant. Ajoute ton matériel ci-dessous, ou prépare une course : ce que tu y ajoutes arrive ici.'
            : 'Rien pour l’instant.'}
        </p>
      ) : (
        <section aria-labelledby="lb-count" className="lb-inventory">
          <h2 id="lb-count" className="eq-heading">
            {mine.items.length} pièce{mine.items.length > 1 ? 's' : ''}
          </h2>
          <ul className="eq-list">
            {mine.items.map((item) => (
              <li key={item.id} className="eq-row">
                <span className="eq-label">{item.label}</span>
                {mine.canEdit ? (
                  <form action={removeFromMyEquipmentAction} className="eq-remove">
                    <input type="hidden" name="itemId" value={item.id} />
                    <button type="submit" aria-label={`Retirer ${item.label} de mon matériel`}>
                      <Icon name="X" size={16} />
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {mine.canEdit ? (
        <section className="lb-new" aria-label="Ajouter à mon matériel">
          <AddToLibraryForm />
        </section>
      ) : (
        <section className="eq-locked" aria-label="Mon matériel avec PLUKA+">
          <p>
            Avec PLUKA+, PLUKA retient tout ton matériel d’une course à l’autre : tu le retrouves
            ici, et tu l’ajoutes d’un clic à ta prochaine préparation.
          </p>
          <Link href="/offre" className="pk-btn pk-button-secondary">
            Découvrir PLUKA+
          </Link>
        </section>
      )}
    </div>
  );
}
