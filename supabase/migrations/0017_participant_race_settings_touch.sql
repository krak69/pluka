-- PLUKA V1 — Horodatage des préférences de participation
-- File target: supabase/migrations/0017_participant_race_settings_touch.sql
-- Référence : docs/02_DATA_MODEL.md §9.2 · docs/01_ARCHITECTURE.md §8 ·
--             AGENTS.md §28, §77
--
-- POURQUOI
--
-- `participant_race_settings` porte un `updated_at` depuis 0001, mais aucun
-- trigger ne l'alimente : toutes les autres tables horodatées de 0001 ont leur
-- `trg_*_updated_at`, celle-ci a été oubliée. La colonne conserve donc l'heure
-- de création de la ligne, quoi qu'il arrive ensuite.
--
-- Le lot ParticipantRace écrit dans cette table à chaque changement
-- d'objectif. Sans le trigger, « depuis quand cet objectif est-il celui-ci »
-- n'a plus de réponse, et une donnée fausse est pire qu'une donnée absente.
--
-- CE QUE LA MIGRATION NE FAIT PAS
--
-- Elle n'ajoute aucune contrainte de cohérence entre `status` et
-- `preparation_state`. Ces deux colonnes décrivent le même fait sous deux
-- angles, et le domaine les écrit ensemble (`participationStatusFor`) ; mais
-- 02_DATA_MODEL ne spécifie que `preparation_state` (§9.3), et graver en SQL
-- une correspondance qu'aucun document ne pose reviendrait à décider une règle
-- produit dans une migration.

begin;

create trigger trg_participant_race_settings_updated_at
  before update on public.participant_race_settings
  for each row execute function private.set_updated_at();

comment on column public.participant_race_settings.updated_at is
  'Alimenté par trigger depuis 0017. Date le dernier changement de préférence — objectif compris.';

commit;
