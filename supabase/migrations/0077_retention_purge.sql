-- PLUKA V1 — Durées de conservation : la purge
-- File target: supabase/migrations/0077_retention_purge.sql
-- Référence : pluka.run/confidentialite · docs/legal/RGPD_AUTO_EVALUATION.md ·
--             docs/03_PRIVACY_RLS.md §93
--
-- POURQUOI
--
-- La politique de confidentialité annonce des durées (décisions du
-- 2026-11-09, usages de la CNIL). Une durée annoncée et jamais appliquée
-- serait un engagement faux : cette migration l'applique, chaque nuit.
--
-- CE QUI EST PURGÉ
--
-- - Liste importée par une organisation, 12 mois après la fin de l'édition :
--   les lignes jamais activées disparaissent, avec leurs invitations ; les
--   données déclaratives et les indices importés disparaissent pour toutes
--   les lignes, activées ou non. Une participation activée reste au coureur,
--   avec sa préparation.
-- - Journal d'audit, au-delà d'un an.
--
-- CE QUI NE L'EST PAS ICI
--
-- - Un refus d'être contacté : il dure tant que l'organisation existe, pour
--   qu'elle ne recontacte pas l'adresse.
-- - Un compte inactif depuis 3 ans : sa suppression demande le cas d'usage de
--   §94 (ne pas emporter par cascade ce qui est partagé). Elle viendra avec la
--   suppression de compte.
--
-- La fonction reçoit la date du jour : pas d'horloge cachée (AGENTS §35), et
-- des tests qui n'attendent pas un an.

begin;

create or replace function private.purge_expired_data(p_now timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_cutoff date := (p_now - interval '12 months')::date;
  v_rows integer;
  v_demographics integer;
  v_signals integer;
  v_audit integer;
  v_editions uuid[];
begin
  -- Les éditions finies depuis plus de 12 mois.
  v_editions := array(
    select ed.id from public.editions ed
    where coalesce(ed.end_date, ed.start_date) < v_cutoff
  );

  delete from private.participant_demographics d
  using public.participant_races pr, public.races r
  where d.participant_race_id = pr.id
    and r.id = pr.race_id
    and r.edition_id = any(v_editions);
  get diagnostics v_demographics = row_count;

  delete from private.participant_performance_signals s
  using public.participant_races pr, public.races r
  where s.participant_race_id = pr.id
    and r.id = pr.race_id
    and r.edition_id = any(v_editions);
  get diagnostics v_signals = row_count;

  -- Jamais activées : la ligne n'appartient qu'à la liste de l'organisation.
  delete from public.participant_races pr
  using public.races r
  where r.id = pr.race_id
    and r.edition_id = any(v_editions)
    and pr.user_id is null;
  get diagnostics v_rows = row_count;

  delete from private.audit_logs where created_at < p_now - interval '1 year';
  get diagnostics v_audit = row_count;

  return jsonb_build_object(
    'participantRows', v_rows,
    'demographics', v_demographics,
    'performanceSignals', v_signals,
    'auditLogs', v_audit
  );
end;
$$;

revoke all on function private.purge_expired_data(timestamptz) from public, anon, authenticated;

comment on function private.purge_expired_data(timestamptz) is
  'Applique les durées de conservation de la politique de confidentialité (0077). Lancée chaque nuit par pg_cron.';

-- Chaque nuit à 3 h 17 UTC, hors des heures d'import.
select cron.schedule(
  'pluka-retention-purge',
  '17 3 * * *',
  $$ select private.purge_expired_data() $$
);

commit;
