# @pluka/contracts

Frontières partagées : schémas Zod communs, contrats des providers externes et
événements métier de `docs/01_ARCHITECTURE.md` §23.

Dépendance unique : `zod`. Aucun accès base, aucun appel réseau, aucune règle
moteur, aucune décision d'entitlement.

## Contenu

| Domaine       | Contenu                                                                                                                                    | Référence           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| `primitives/` | UUID, empreinte SHA-256, instant ISO avec fuseau, fuseau IANA, lat/lon/altitude, URL http(s), valeur JSON, métadonnées de reproductibilité | §8, §29, §30, §32.1 |
| `providers/`  | `WeatherProvider`, `AIProvider`, `EmailProvider`, `BillingProvider`, `ProviderError`                                                       | §28, §35, §37       |
| `events/`     | catalogue §23, enveloppe alignée sur `private.outbox_events`, déclaration typée d'un payload                                               | §22.2, §23, §33     |

## Providers

Le domaine ne connaît jamais le SDK concret. Un adapter implémente l'interface,
valide la réponse avec `parseProviderResponse` et lève `ProviderError` en cas
d'échec.

```ts
import { parseProviderResponse, ProviderError, type WeatherProvider } from '@pluka/contracts';
```

Règles portées par ces contrats :

- une grandeur météo absente reste `null` — jamais d'estimation de repli ;
- l'IA rend des candidats structurés ou une réponse sourcée, jamais une
  publication ;
- un email exige une clé d'idempotence : un retry ne renvoie pas l'invitation ;
- un webhook de paiement ne crée un droit qu'après vérification de signature, et
  `providerEventId` porte l'idempotence.

`ProviderError` transporte un code, l'opération et le provider — jamais la
réponse brute ni un identifiant d'authentification.

## Événements

Le catalogue et l'enveloppe sont figés ; **le payload de chaque événement ne
l'est pas** — `01_ARCHITECTURE.md` §23 fixe les noms et la règle de minimalité,
pas le contenu. Chaque lot déclare le sien là où la donnée est décidée :

```ts
import { defineDomainEvent, parseDomainEvent } from '@pluka/contracts';
import { z } from 'zod';

export const planUpdated = defineDomainEvent(
  'plan.updated',
  z.object({ racePlanId: z.uuid(), version: z.number().int().positive() }),
);

const event = parseDomainEvent(planUpdated, envelopeFromOutbox);
```

Un payload transporte des identifiants et le strict nécessaire : ni PII, ni
contenu de préparation, ni token (§23, §33, AGENTS §62).

## Ce qui n'est pas ici

- les schémas d'extraction de facts → `packages/sources`
  (`SOURCES_EXTRACTION.md` §56) ;
- les gabarits email → `packages/notifications` ;
- le catalogue produit et les règles de droits → domaine des entitlements ;
- les événements analytics → `packages/analytics` (§24) ;
- les types de commande métier (§7) : à ajouter lot par lot, avec la spec qui
  définit leurs entrées.
