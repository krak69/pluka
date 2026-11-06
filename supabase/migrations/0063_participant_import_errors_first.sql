-- PLUKA V1 — Participants : les lignes refusées passent avant les doublons
-- File target: supabase/migrations/0063_participant_import_errors_first.sql
-- Référence : docs/00_PRODUCT_SPEC.md §29.1 · AC-B2B-PART-03
--
-- POURQUOI
--
-- Les exceptions s'arrêtent à 100. Dans un fichier repris, les lignes « déjà dans
-- la liste » les remplissaient : une ligne refusée plus bas ne se voyait plus.

begin;

create or replace function public.get_participant_import(p_import_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_import public.participant_imports;
begin
  select * into v_import from public.participant_imports i where i.id = p_import_id;
  if not found then
    raise exception 'import introuvable' using errcode = 'P0002';
  end if;
  perform private.assert_can_import_participants(v_import.edition_id);

  return jsonb_build_object(
    'id', v_import.id,
    'editionId', v_import.edition_id,
    'status', v_import.status,
    'fileName', v_import.mapping ->> 'fileName',
    'headers', coalesce(v_import.mapping -> 'headers', '[]'::jsonb),
    'columns', coalesce(v_import.mapping -> 'columns', '{}'::jsonb),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('rowNumber', r.row_number, 'data', r.raw_data) order by r.row_number)
      from public.participant_import_rows r where r.import_id = p_import_id
    ), '[]'::jsonb),
    'counts', coalesce((
      select jsonb_object_agg(t.status, t.n)
      from (
        select r.status, count(*)::integer as n
        from public.participant_import_rows r where r.import_id = p_import_id group by r.status
      ) t
    ), '{}'::jsonb),
    'exceptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rowNumber', e.row_number, 'status', e.status, 'message', e.error_message
      ) order by e.row_number)
      from (
        select r.row_number, r.status, r.error_message
        from public.participant_import_rows r
        where r.import_id = p_import_id and r.error_message is not null
        order by r.status = 'error' desc, r.row_number limit 100
      ) e
    ), '[]'::jsonb),
    'unknownWaves', (
      with unknown as (
        select race.name as race_name, min(r.mapped_data ->> 'wave') as wave, count(*)::integer as n
        from public.participant_import_rows r
        join public.races race
          on race.id::text = r.mapped_data ->> 'raceId' and race.edition_id = v_import.edition_id
        where r.import_id = p_import_id
          and r.status = 'valid'
          and nullif(r.mapped_data ->> 'wave', '') is not null
          and not exists (
            select 1 from public.race_start_waves w
            where w.race_id = race.id and lower(w.name) = lower(r.mapped_data ->> 'wave')
          )
        group by race.id, race.name, lower(r.mapped_data ->> 'wave')
      ), shown as (
        -- Une colonne mal choisie donnerait une vague par ligne : l'écran en montre 20.
        select u.race_name, u.wave, u.n from unknown u order by u.race_name, lower(u.wave) limit 20
      )
      select jsonb_build_object(
        'rows', coalesce((select sum(u.n)::integer from unknown u), 0),
        'groups', (select count(*)::integer from unknown),
        'shown', coalesce((
          select jsonb_agg(jsonb_build_object('raceName', s.race_name, 'wave', s.wave, 'rows', s.n)
                           order by s.race_name, lower(s.wave))
          from shown s
        ), '[]'::jsonb)
      )
    )
  );
end;
$$;

commit;
