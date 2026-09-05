# `@pluka/db`

Accès aux données PLUKA : client Supabase typé, types générés depuis la base
locale, helpers de lecture et structure des repositories.

Référence : `docs/01_ARCHITECTURE.md` §4.5, §5, §9 et `docs/02_DATA_MODEL.md`.

## Ce que ce paquet ne fait pas

> `packages/db` ne décide pas d'un entitlement. — `01_ARCHITECTURE.md` §5, règle 5

Il n'arbitre ni droit commercial, ni quota, ni règle de publication, ni
visibilité produit. Il exécute des requêtes et traduit des lignes. Les règles
vivent dans `packages/domain`, qui les a résolues **avant** d'appeler un
repository.

Le signe qu'une frontière a été franchie : un repository qui lit un plan
d'abonnement, compte un quota ou filtre selon un droit. Ce filtrage appartient
au use case.

## Trois points d'entrée

| Import              | Contenu                                                       | Contexte           |
| ------------------- | ------------------------------------------------------------- | ------------------ |
| `@pluka/db`         | types, erreurs, `selectColumns`, `unwrap`, `defineRepository` | neutre             |
| `@pluka/db/server`  | `createServerClient`, `createServiceRoleClient`               | serveur uniquement |
| `@pluka/db/browser` | `createBrowserClient`                                         | navigateur         |

La séparation n'est pas une convention de nommage : `tests/import-graph.test.ts`
construit la fermeture transitive des imports depuis chaque entrée et échoue si
un module atteignable depuis `browser/` mène à `server/` — en affichant la
chaîne fautive. Le test se protège aussi de lui-même : il vérifie qu'il parcourt
bien le graphe, pour qu'une analyse cassée ne passe pas pour une absence de
fuite.

```ts
// Serveur, sous la session de l'utilisateur — donc sous RLS.
import { createServerClient } from '@pluka/db/server';

// Serveur, contourne la RLS. Le use case doit tout revérifier lui-même.
import { createServiceRoleClient } from '@pluka/db/server';
```

`service_role` n'est jamais une autorisation métier : voir `03_PRIVACY_RLS.md`
§8 et `AGENTS.md` §26.

## Types générés

```bash
pnpm db:types   # supabase gen types typescript --local
```

Le fichier `src/generated/database.types.ts` est régénéré depuis la base locale
et n'est pas édité à la main. Il est exclu de Prettier : le reformater créerait
un diff à chaque régénération.

Seul le schéma `public` y figure — `private` n'est donc même pas nommable depuis
un client applicatif (`02_DATA_MODEL.md` §25).

## Projections

`select *` est proscrit. `selectColumns` produit un littéral typé contre les
types générés, ce qui donne l'inférence de ligne à supabase-js et transforme une
colonne renommée en erreur de compilation :

```ts
const columns = selectColumns('races', ['id', 'name']);
//    ^? 'id,name'
```

## Repositories

Aucun repository métier n'est fourni ici : chacun arrive avec le lot qui définit
ses requêtes et ses tests d'intégration. `defineRepository` fixe la structure —
client injecté, une fonction par intention métier, projection explicite, erreurs
déballées par `unwrap` / `unwrapMaybe`.

## Lecture vide, lecture interdite

Sous RLS, « je n'ai pas le droit de voir cette ligne » et « cette ligne n'existe
pas » se présentent de la même façon. `unwrapMaybe` rend `null` dans les deux
cas, et c'est l'appelant qui tranche ce qu'il en dit — répondre « interdit »
confirmerait l'existence de l'objet (`03_PRIVACY_RLS.md` §120).
