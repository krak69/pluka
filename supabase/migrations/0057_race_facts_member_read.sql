-- PLUKA V1 — Ma course : un membre de l'organisation lit ses informations
-- File target: supabase/migrations/0057_race_facts_member_read.sql
-- Référence : docs/00_PRODUCT_SPEC.md §28.1 · docs/03_PRIVACY_RLS.md
--
-- POURQUOI
--
-- 0043 faisait de la liste de travail une lecture d'éditeur, pour la console
-- d'administration. Dans l'espace organisateur, un viewer doit consulter ce que
-- PLUKA sait de sa course (rôle « Lecture seule ») : il lit la même liste, et
-- n'a aucun geste. Ces données sont celles de son organisation : rien d'un
-- coureur n'y figure. Toute autre personne reste refusée, et les gestes gardent
-- `private.fact_gesture_authority`.

begin;

create or replace function public.list_race_facts_for_editing(p_race_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Lire n'est pas un geste : un viewer consulte. Corriger reste réservé (0043).
  if not (private.user_can_manage_race(p_race_id, 'viewer') or private.is_pluka_admin()) then
    raise exception 'information réservée à l''organisation de la course' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'factId', f.id,
      'category', f.category,
      'factKey', f.fact_key,
      'archivedAt', f.archived_at,
      'versionId', v.id,
      'versionNumber', v.version_number,
      'valueText', v.value_text,
      'valueNumber', v.value_number,
      'unit', v.unit,
      'valueJson', v.value_json,
      'trustLevel', v.trust_level,
      'publishedAt', v.published_at,
      'source', (
        select jsonb_build_object('title', s.title, 'page', fs.page_start, 'excerpt', fs.excerpt)
        from public.fact_sources fs join public.sources s on s.id = fs.source_id
        where fs.fact_version_id = v.id
        order by fs.is_primary desc, fs.id
        limit 1
      )
    ) order by f.archived_at nulls first, f.category, f.fact_key)
    from public.race_facts f
    join public.race_fact_versions v on v.id = f.current_version_id
    where f.race_id = p_race_id
  ), '[]'::jsonb);
end;
$$;

commit;
