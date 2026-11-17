-- ============================================================
-- 0097 — Préparation · À faire
-- ============================================================
--
-- 00_PRODUCT_SPEC §14.5 : PLUKA peut générer des tâches de préparation et le
-- coureur peut ajouter les siennes. `tasks` existe depuis 0001, privée au
-- coureur (03_PRIVACY_RLS §36, policies 0005) ; cette migration lui donne ce
-- qui manquait aux suggestions.
--
-- Décisions produit du 2026-11-17 :
--
-- - les suggestions se déduisent des données de la course, jamais d'une IA :
--   construire son Plan, charger la trace, rassembler le matériel obligatoire,
--   un rappel par sac créé. Sans échéance : aucun délai n'est spécifié ;
-- - une suggestion n'est pas une ligne tant que le coureur n'y touche pas.
--   L'ajouter à ses tâches, ou l'écarter, écrit une ligne `origin = 'pluka'`
--   portant sa clé ; la retirer efface la ligne ;
-- - les suggestions sont gratuites ; ses propres tâches
--   (créer, modifier, cocher, supprimer) demandent le Race Pass. Ce droit se
--   décide dans le domaine (04_ENTITLEMENTS §45), la RLS ne borne que la
--   propriété.
--
-- `delete_user_account` et `export_my_data` (0096) lisent `tasks` en entier
-- (`to_jsonb`) : les nouvelles colonnes y entrent sans les redéfinir.

-- ------------------------------------------------------------
-- 01. Bornes du titre
-- ------------------------------------------------------------

alter table public.tasks
  add constraint tasks_title_length check (char_length(btrim(title)) between 1 and 120);

-- ------------------------------------------------------------
-- 02. Clé de suggestion
-- ------------------------------------------------------------
-- Une seule ligne par suggestion et par participation : cocher deux fois,
-- depuis deux onglets, n'en crée pas deux (AGENTS §32). Contrainte pleine et
-- non index partiel, pour que l'upsert puisse la nommer ; les tâches du
-- coureur, sans clé, ne s'y heurtent pas (`null` reste distinct).

alter table public.tasks
  add column suggestion_key text,
  add column dismissed_at timestamptz;

alter table public.tasks
  add constraint tasks_suggestion_key_format check (
    suggestion_key is null
    or suggestion_key ~ '^(plan|gpx|mandatory_equipment|bag:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'
  ),
  -- Une suggestion est une tâche PLUKA ; une tâche PLUKA ne vient que d'une suggestion.
  add constraint tasks_suggestion_origin check ((suggestion_key is not null) = (origin = 'pluka')),
  -- Seule une suggestion s'écarte : une tâche du coureur se supprime.
  add constraint tasks_dismissed_suggestion check (dismissed_at is null or suggestion_key is not null),
  add constraint tasks_suggestion_unique unique (participant_race_id, suggestion_key);
