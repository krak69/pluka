# @pluka/config

Lecture **typée et validée** de la configuration : variables d'environnement (Zod)
et feature flags de `docs/01_ARCHITECTURE.md` §41.

Ce paquet ne contient aucune règle produit, aucun seuil moteur et aucune décision
d'entitlement.

## Frontières

- aucune dépendance à Next.js, Supabase ou à un SDK provider ;
- aucune lecture implicite : la source (`process.env`, objet littéral, fixture)
  est toujours passée en argument ;
- une erreur de configuration ne contient jamais la valeur reçue — elle finit
  dans un log ou dans Sentry.

## Serveur

```ts
import { assertNoLeakedServerSecrets, loadServerEnv } from '@pluka/config';

assertNoLeakedServerSecrets(process.env);
const env = loadServerEnv(process.env);

env.supabase.SUPABASE_SERVICE_ROLE_KEY; // worker / Server Action / Route Handler
env.flags.race_intelligence;
```

Une surface qui n'a pas besoin de la clé `service_role` ni de `DATABASE_URL`
(`apps/www`, preview Vercel) utilise `loadPublicEnv` et `loadFeatureFlags`
plutôt que `loadServerEnv`.

## Navigateur

Next.js inline les `NEXT_PUBLIC_*` à la compilation : `process.env` n'existe pas
tel quel côté client. Passer un objet littéral.

```ts
import { loadPublicEnv } from '@pluka/config';

const env = loadPublicEnv({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
});
```

## Feature flags

```ts
import { assertFeatureEnabled, isFeatureEnabled, loadFeatureFlags } from '@pluka/config';

const flags = loadFeatureFlags(process.env); // FLAG_RACE_INTELLIGENCE=true
isFeatureEnabled(flags, 'race_intelligence');
assertFeatureEnabled(flags, 'community'); // FeatureDisabledError si éteint
```

Les flags sont résolus **côté serveur** ; une surface cliente reçoit un
instantané `FeatureFlagSet` transmis par le serveur.

|              | Question                                             | Réponse                                  |
| ------------ | ---------------------------------------------------- | ---------------------------------------- |
| feature flag | la fonctionnalité existe-t-elle dans cette release ? | `@pluka/config`                          |
| entitlement  | cet utilisateur a-t-il le droit de l'utiliser ?      | `EntitlementService` (`packages/domain`) |

Un flag éteint n'est jamais un argument commercial : pas d'upgrade proposé, pas
de paywall. L'un ne remplace jamais l'autre (AGENTS §47, AC-ENT-08).

## Ajouter une variable

1. la déclarer dans `.env.example` avec un commentaire d'usage ;
2. l'ajouter au schéma correspondant dans `src/env/schemas.ts` ;
3. si elle est secrète, l'ajouter à `SERVER_ONLY_ENV_KEYS` — et ne jamais lui
   donner le préfixe `NEXT_PUBLIC_` ;
4. couvrir le cas valide **et** le cas invalide dans `tests/`.

Un nouveau feature flag suppose d'abord une décision dans
`docs/01_ARCHITECTURE.md` §41 : la liste n'est pas un fourre-tout de configuration.
