# PLUKA

Cockpit personnel de préparation avant-course du trailer.

> **Avant toute contribution — humaine ou assistée — lire [`AGENTS.md`](./AGENTS.md).**

## Démarrage

Prérequis : Node 22+, pnpm 10+, Docker (OrbStack sur macOS), CLI Supabase.

```bash
pnpm install
cp .env.example .env.local

supabase start                 # stack PostgreSQL locale
supabase db reset              # applique 0001 puis 0002
pnpm db:types                  # génère les types TypeScript

pnpm dev
```

`supabase start` affiche les clés locales : reporter `anon key` dans
`NEXT_PUBLIC_SUPABASE_ANON_KEY` et `service_role key` dans `SUPABASE_SERVICE_ROLE_KEY`.

## Documentation

| Fichier | Objet |
|---|---|
| `docs/00_PRODUCT_SPEC.md` | Périmètre fonctionnel — fait foi sur le produit |
| `docs/01_ARCHITECTURE.md` | Architecture technique |
| `docs/02_DATA_MODEL.md` | Modèle de données |
| `docs/03_PRIVACY_RLS.md` | Confidentialité et policies RLS |
| `docs/04_ENTITLEMENTS.md` | Droits commerciaux |
| `docs/06_DESIGN_SYSTEM.md` | Design System |
| `docs/engines/*.md` | Moteurs Plan, Nutrition, Sources, Weather, Race Intelligence |
| `reference/prototype/` | Prototype figé — intention UX uniquement |

## Environnements

| | Base | Web |
|---|---|---|
| local | `supabase start` | `pnpm dev` |
| staging | projet `pluka-staging` | previews Vercel |
| production | projet `pluka-prod` | production Vercel |

Migrations : toujours local → staging → production. Forward-only.
