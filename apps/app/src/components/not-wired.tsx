/**
 * État vide unique des onglets non branchés.
 *
 * Un seul composant pour tout le shell : chaque onglet lui passe son domaine,
 * et la formulation reste la même d'un écran à l'autre. C'est délibéré — un
 * lecteur qui a compris un de ces écrans a compris tous les autres.
 *
 * `06_DESIGN_SYSTEM.md` §107 : « aucune donnée inventée pour remplir un vide ».
 * §83 impose les trois temps de l'état vide, et le troisième — la prochaine
 * action — n'existe pas ici : il n'y a rien que le coureur puisse faire pour
 * brancher un moteur. Le composant le dit plutôt que de proposer un bouton
 * décoratif.
 *
 * `detail` dit ce qui manque, du point de vue du lecteur. Il ne nomme aucune
 * table : l'inventaire technique appartient au commentaire de chaque écran, pas
 * à l'écran lui-même — et `tests/no-direct-sql.test.ts` refuse d'ailleurs qu'un
 * nom de table du Plan apparaisse dans cette application.
 */
export interface NotWiredProps {
  /** Domaine concerné, tel qu'il apparaît dans la navigation. */
  readonly area: string;
  /** Ce que cet écran montrera, du point de vue du coureur. */
  readonly purpose: string;
  /** Ce qui manque, en termes que le coureur comprend. */
  readonly detail: string;
}

export function NotWired({ area, purpose, detail }: NotWiredProps) {
  // Habillage du prototype : une annonce sobre, pas un message d'erreur. Le
  // contenu reste le même — ce que l'écran fera, et ce qui manque encore.
  return (
    <section className="nw" aria-label={`${area} — bientôt`}>
      <p className="nw-tag">Bientôt dans PLUKA</p>
      <p className="nw-purpose">{purpose}</p>
      <p className="nw-detail">{detail}</p>
      <p className="nw-note">
        Cet espace s’ouvrira avec tes vraies données : PLUKA n’affiche jamais de valeurs de
        démonstration.
      </p>
    </section>
  );
}
