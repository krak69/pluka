#!/usr/bin/env node
// PreToolUse (Bash | PowerShell) — protocole Git et Supabase de PLUKA.
// Pourquoi : un `git clean -fd` a détruit du travail non commité. Les commits restent manuels.
// Sortie 2 = commande bloquée ; le message stderr est renvoyé à Claude Code.
import { readFileSync } from "node:fs";

let input = {};
try { input = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
const command = String(input?.tool_input?.command ?? "");

// Découpe en sous-commandes (&&, ||, ;, |, retour ligne) puis en mots.
const segments = command.split(/&&|\|\||[;|\n]/).map((s) => s.trim()).filter(Boolean);
const tokenize = (s) => (s.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((t) => t.replace(/^["']|["']$/g, ""));

// Options git qui prennent une valeur avant la sous-commande (git -C dir, git -c k=v).
const GIT_OPTS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

function gitCall(tokens) {
  const i = tokens.findIndex((t) => /(^|[\\/])git(\.exe)?$/i.test(t));
  if (i === -1) return null;
  let j = i + 1;
  while (j < tokens.length && tokens[j].startsWith("-")) {
    j += GIT_OPTS_WITH_VALUE.has(tokens[j]) ? 2 : 1;
  }
  return { sub: (tokens[j] ?? "").toLowerCase(), args: tokens.slice(j + 1) };
}

function check(tokens) {
  const git = gitCall(tokens);
  if (git) {
    const { sub, args } = git;
    const has = (re) => args.some((a) => re.test(a));
    if (sub === "commit" || sub === "push")
      return `git ${sub} : les commits et push sont faits par Clément, jamais par Claude Code. Donne-lui la commande à copier.`;
    if (sub === "clean") return "git clean supprime des fichiers non suivis (incident déjà vécu). Interdit.";
    if (sub === "reset" && has(/^--(hard|merge|keep)$/)) return "git reset --hard écrase le travail non commité. Interdit.";
    if (sub === "restore") return "git restore écrase des modifications locales. Interdit.";
    if (sub === "checkout" && (args.includes("--") || args.includes(".") || has(/^-f$|^--force$/)))
      return "git checkout -- / . / -f écrase des modifications locales. Interdit.";
    if (sub === "switch" && has(/^-f$|^--force$|^--discard-changes$/)) return "git switch forcé écrase des modifications locales. Interdit.";
    if (sub === "stash" && /^(drop|clear)$/i.test(args[0] ?? "")) return "git stash drop/clear détruit du travail. Interdit.";
    if (sub === "rebase" || sub === "filter-branch") return `git ${sub} réécrit l'historique. Interdit.`;
    if (sub === "branch" && has(/^-D$|^--delete$|^-d$/)) return "Suppression de branche : à faire par Clément.";
  }
  const supa = tokens.findIndex((t) => /(^|[\\/])supabase(\.exe)?$/i.test(t));
  if (supa !== -1) {
    const rest = tokens.slice(supa + 1);
    if (rest.includes("--linked") || rest.some((t) => t.startsWith("--db-url")))
      return "Commande Supabase visant une base distante (--linked / --db-url). Seule la base locale est autorisée.";
    if (rest[0] === "db" && rest[1] === "push") return "supabase db push pousse vers un projet distant. Interdit depuis Claude Code.";
  }
  return null;
}

for (const seg of segments) {
  const reason = check(tokenize(seg));
  if (reason) {
    process.stderr.write(`⛔ Bloqué par .claude/hooks/guard-bash.mjs — ${reason}\nCommande : ${seg}\n`);
    process.exit(2);
  }
}
process.exit(0);
