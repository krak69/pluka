# `@pluka/domain`

Use cases applicatifs et invariants métier.

Périmètre de ce lot : **Event / Edition / Race**, dont le cycle de vie de
`docs/00_PRODUCT_SPEC.md` §4.1.

Références : `00_PRODUCT_SPEC.md` §3.5, §4, §4.1 · `01_ARCHITECTURE.md` §4.5,
§5, §7 · `02_DATA_MODEL.md` §3.1, §6 · `03_PRIVACY_RLS.md` §11, §111, §120.

## Les rôles sont relus en base

`Actor` ne porte qu'un `userId`. Aucun schéma de commande n'accepte de rôle,
de `platformRole` ni d'`organizationId` d'autorité : à chaque commande,
`resolveAuthority` interroge `users.platform_role` puis
`organization_members.role`.

Ajouter un champ `role` à `Actor` rouvrirait exactement la porte que
`03_PRIVACY_RLS` §11 ferme — « ne jamais accepter un `user_id` venant du
client comme substitut à `auth.uid()` ». Un test le vérifie en passant une
commande qui se déclare `owner` et `pluka_admin` : elle est refusée.

## Séquence d'une commande

`01_ARCHITECTURE.md` §7, dans cet ordre :

1. valider l'entrée (Zod, à la frontière) ;
2. vérifier l'autorisation (relue en base) ;
3. appliquer les invariants métier ;
4. écrire.

## Cycle de vie d'une Race

```text
draft ──► published ──► completed ──► archived
             │                            ▲
             └────────► cancelled ────────┘
```

`course/lifecycle.ts` est un module pur : une table de transitions et les
fonctions qui l'interrogent. Aucune I/O, **aucune horloge** — et c'est un
point de spec, pas une commodité : « `completed` n'est jamais déclenché par le
passage de la date ».

Sept transitions, six lignes au tableau de §4.1 (la dernière en couvre deux).
Toute autre est refusée avec `invalid_state` ; un test énumère les 25 couples
possibles pour le prouver.

### Trois points que le code tranche explicitement

**L'ordre des vérifications.** Un extérieur reçoit `forbidden` avant toute
évaluation de la transition. Sinon le code d'erreur lui apprendrait si une
transition est valide, donc dans quel statut se trouve une course qu'il n'a
pas le droit de voir (§120).

**Le désarchivage.** §4.1 le décrit comme un « retour au statut antérieur à
l'archivage » : la cible n'est pas au choix de l'appelant, le journal la
dicte. Une course archivée depuis `completed` ne peut pas ressortir en
`cancelled`. Sans entrée d'archivage au journal, la commande refuse plutôt que
de deviner.

**La concurrence.** `races.changeStatus` est un compare-and-set sur le statut
de départ. Deux administrateurs partis de la même lecture ne peuvent pas
enchaîner deux transitions ; le second obtient `conflict`.

## Journal des transitions

§4.1 : « Un changement de statut est journalisé : qui, quand, depuis quel
statut. »

La table `public.race_status_transitions` (migration 0006) est alimentée **par
trigger**, pas par l'application : la transition et sa trace vivent dans la
même transaction, et aucun chemin d'écriture ne peut oublier de journaliser.
C'est ce qui en fait un invariant plutôt qu'une convention — et la raison pour
laquelle `RaceStatusTransitionRepository` n'expose aucune écriture.

L'historique est réservé à l'organisation gestionnaire et à `pluka_admin` : le
coureur voit « Annulée », pas la main qui l'a décidé.

## Dépendances

```text
domain → db (repositories) + contracts
```

Jamais l'inverse, jamais Next.js, jamais un provider externe. Ce paquet ne
contient ni UI, ni job asynchrone, ni IA.

## Tests

Les repositories en mémoire de `tests/fixtures` implémentent les mêmes
interfaces que `@pluka/db` : les use cases testés sont ceux qui tourneront en
production. On ne simule que les dépendances.

Le fake reproduit deux comportements qui viennent en réalité de PostgreSQL —
le compare-and-set de `changeStatus`, et le trigger qui alimente le journal.
Sans le second, les tests de désarchivage passeraient sur un journal vide et
ne prouveraient rien.

La couverture SQL correspondante est dans `supabase/tests/06_rls_race_status_journal.sql` :
trigger, lecture réservée, journal append-only.
