import { EmptyState } from '@pluka/ui';

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
  return (
    <EmptyState label={area} title="Cette partie n’est pas encore branchée." detail={detail}>
      <p>{purpose}</p>
      <p>
        Rien n’est affiché ici tant que le service ne le fournit pas : PLUKA préfère un écran vide à
        des valeurs de démonstration.
      </p>
    </EmptyState>
  );
}
