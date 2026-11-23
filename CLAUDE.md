# CLAUDE.md — PLUKA

Le contrat opérationnel du repo est AGENTS.md. Il s'applique intégralement à Claude Code :

@AGENTS.md

## Règles propres à Claude Code

- **Git** : tu ne lances jamais `git commit`, `push`, `clean`, `reset --hard`, `restore`,
  `checkout -- …`, `stash drop|clear`, `rebase`, `branch -D`. Clément commite lui-même.
  Un hook (`.claude/hooks/guard-bash.mjs`) bloque ces commandes : ne cherche pas à le contourner.
- **Migrations** : une migration déjà commitée est immuable. Toute correction = nouvelle migration.
  Un hook (`.claude/hooks/guard-files.mjs`) refuse la modification d'une migration suivie par git.
- **Supabase distant** : jamais de `supabase db push`, ni de commande `--linked` / `--db-url`.
  Seule la base locale (`pnpm db:reset`) est à ta disposition.
- **Fin de tâche** : rapport au format AGENTS.md §104, puis la commande à copier par Clément :
  `git add . && git commit -m "<message conventionnel>" && git log --oneline -1 && git status --short`
- **Environnement** : Windows / PowerShell, pnpm via corepack.
