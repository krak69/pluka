#!/usr/bin/env node
// PreToolUse (Edit | MultiEdit | Write | NotebookEdit) — migrations immuables et secrets hors du code.
// Sortie 2 = écriture bloquée ; le message stderr est renvoyé à Claude Code.
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

let input = {};
try { input = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
const ti = input?.tool_input ?? {};
const filePath = String(ti.file_path ?? ti.notebook_path ?? "");
if (!filePath) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const abs = path.resolve(projectDir, filePath);
const rel = path.relative(projectDir, abs).split(path.sep).join("/");
const base = path.basename(abs);

const block = (reason) => {
  process.stderr.write(`⛔ Bloqué par .claude/hooks/guard-files.mjs — ${reason}\nFichier : ${rel}\n`);
  process.exit(2);
};

// 1. Migrations forward-only : une migration suivie par git ne se modifie plus.
if (/^supabase\/migrations\/.+\.sql$/.test(rel) && existsSync(abs)) {
  let tracked = true; // en cas de doute, on protège
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", rel], { cwd: projectDir, stdio: "ignore" });
  } catch (e) {
    tracked = e?.code === "ENOENT"; // git introuvable → on protège ; sinon fichier non suivi
  }
  if (tracked)
    block("cette migration est déjà commitée, donc immuable (forward-only). Crée une nouvelle migration numérotée à la place.");
}

// 2. Secrets : contenu écrit par l'outil.
const written = [ti.content, ti.new_string, ti.new_source, ...(Array.isArray(ti.edits) ? ti.edits.map((e) => e?.new_string) : [])]
  .filter((v) => typeof v === "string")
  .join("\n");
const isLocalEnv = /^\.env(\..+)?$/.test(base) && base !== ".env.example";

if (!isLocalEnv) {
  if (/sb_secret_[A-Za-z0-9_-]{16,}/.test(written))
    block("clé secrète Supabase (sb_secret_…) en clair. Les secrets vivent uniquement dans .env.local.");
  if (/eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/.test(written))
    block("jeton JWT en clair (possible clé service_role). Les secrets vivent uniquement dans .env.local.");
}
if (/NEXT_PUBLIC_[A-Z0-9_]*(SERVICE_ROLE|SECRET|API_KEY|DATABASE_URL|WEBHOOK)/.test(written))
  block("variable secrète exposée via NEXT_PUBLIC_* (envoyée au navigateur). Interdit (AGENTS.md §26).");

// 3. Composant client qui référence un secret serveur.
let finalText = written;
if (existsSync(abs) && !ti.content) { try { finalText = readFileSync(abs, "utf8") + "\n" + written; } catch {} }
const isClient = /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(finalText);
if (isClient && /SUPABASE_SERVICE_ROLE_KEY|_API_KEY\b|WEBHOOK_SECRET|DATABASE_URL|createServiceClient|service_role/.test(written))
  block("un fichier \"use client\" ne peut pas référencer un secret serveur ou le client service_role.");

process.exit(0);
