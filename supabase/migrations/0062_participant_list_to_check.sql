-- PLUKA V1 — Participants : ce qui reste à vérifier dans la liste
-- File target: supabase/migrations/0062_participant_list_to_check.sql
-- Référence : docs/00_PRODUCT_SPEC.md §29.1 · docs/02_DATA_MODEL.md §20.1
--
-- POURQUOI
--
-- Une liste de plusieurs centaines de lignes ne se relit pas. La lecture dit
-- d'elle-même ce qui demande un regard : une vague à déclarer, un dossard porté
-- deux fois sur une même épreuve. Ces lignes viennent en tête : la limite de la
-- liste ne doit pas les cacher. Le dossard est propre à une épreuve : le même
-- numéro sur deux épreuves n'est pas un conflit.

begin;

create or replace function public.list_edition_participants(p_edition_id uuid, p_limit integer default 500)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_can_see_contact boolean;
begin
  if not (private.user_can_manage_edition(p_edition_id, 'viewer') or private.is_pluka_admin()) then
    raise exception 'liste réservée à l''organisation de la course' using errcode = '42501';
  end if;

  v_can_see_contact := private.user_can_manage_edition(p_edition_id, 'admin') or private.is_pluka_admin();

  return (
    with edition_participants as (
      select pr.id, pr.first_name_snapshot, pr.last_name_snapshot, pr.invite_email, pr.bib_number,
        pr.declared_wave_name, pr.user_id, r.name as race_name, w.name as wave_name,
        pr.bib_number is not null
          and count(*) over (partition by pr.race_id, pr.bib_number) > 1 as bib_conflict
      from public.participant_races pr
      join public.races r on r.id = pr.race_id
      left join public.race_start_waves w on w.id = pr.start_wave_id
      where r.edition_id = p_edition_id
    ), listed as (
      select lower(coalesce(e.last_name_snapshot, '') || ' ' || coalesce(e.first_name_snapshot, '')) as sort_name,
        e.bib_conflict or e.declared_wave_name is not null as to_check,
        jsonb_build_object(
          'id', e.id,
          'firstName', e.first_name_snapshot,
          'lastName', e.last_name_snapshot,
          'email', case when v_can_see_contact then e.invite_email::text end,
          'bib', e.bib_number,
          'raceName', e.race_name,
          'waveName', e.wave_name,
          'declaredWaveName', e.declared_wave_name,
          'bibConflict', e.bib_conflict,
          'activated', e.user_id is not null
        ) as payload
      from edition_participants e
      order by e.bib_conflict or e.declared_wave_name is not null desc,
        lower(coalesce(e.last_name_snapshot, '')), lower(coalesce(e.first_name_snapshot, ''))
      limit least(greatest(p_limit, 1), 2000)
    )
    select jsonb_build_object(
      'total', (select count(*)::integer from edition_participants),
      'toCheck', jsonb_build_object(
        'waves', (select count(*)::integer from edition_participants e where e.declared_wave_name is not null),
        'bibs', (select count(*)::integer from edition_participants e where e.bib_conflict)
      ),
      'participants', coalesce((
        select jsonb_agg(l.payload order by l.to_check desc, l.sort_name) from listed l
      ), '[]'::jsonb)
    )
  );
end;
$$;

commit;
