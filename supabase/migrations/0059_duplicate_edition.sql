-- PLUKA V1 — Ma course : préparer l'édition suivante
-- File target: supabase/migrations/0059_duplicate_edition.sql
-- Référence : docs/05_ROUTES_FLOWS.md §12.1 · AGENTS §14
--
-- POURQUOI
--
-- Une course revient chaque année. Une organisation repart de l'édition passée
-- plutôt que de tout ressaisir : mêmes épreuves, mêmes distances, nouvelles dates.
--
-- Ce qui ne se copie pas, à dessein :
--
--   - les informations publiées : une information vaut pour une édition, et un
--     règlement de l'an dernier ne devient pas officiel cette année (§13) ;
--   - les traces, les points de passage et les liens d'inscription : ils
--     changent d'une année à l'autre, et se redonnent en connaissance de cause.
--
-- Tout naît en brouillon : rien n'apparaît aux coureurs avant publication. Les
-- horaires se décalent en heure locale : un départ à 6 h reste à 6 h, même si le
-- passage à l'heure d'été les sépare.

begin;

create function public.duplicate_edition(
  p_source_edition_id uuid,
  p_year integer,
  p_start_date date,
  p_end_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.editions;
  v_edition_id uuid;
  v_days integer;
begin
  select * into v_source from public.editions ed where ed.id = p_source_edition_id;
  if not found then
    raise exception 'édition introuvable' using errcode = 'P0002';
  end if;

  if not (private.user_can_manage_edition(p_source_edition_id, 'editor') or private.is_pluka_admin()) then
    raise exception 'action non autorisée sur cette édition' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.editions ed where ed.event_id = v_source.event_id and ed.year = p_year
  ) then
    raise exception 'EDITION_ALREADY_EXISTS' using errcode = '23505';
  end if;

  v_days := p_start_date - v_source.start_date;

  insert into public.editions (event_id, year, slug, start_date, end_date, status)
  values (v_source.event_id, p_year, p_year::text, p_start_date, p_end_date, 'draft')
  returning id into v_edition_id;

  insert into public.races (
    edition_id, name, slug, description, distance_km, elevation_gain_m, elevation_loss_m,
    start_datetime, cutoff_datetime, timezone, start_location_name, finish_location_name,
    status, public_visibility
  )
  select
    v_edition_id, r.name, r.slug, r.description, r.distance_km, r.elevation_gain_m, r.elevation_loss_m,
    ((r.start_datetime at time zone r.timezone) + make_interval(days => v_days)) at time zone r.timezone,
    ((r.cutoff_datetime at time zone r.timezone) + make_interval(days => v_days)) at time zone r.timezone,
    r.timezone, r.start_location_name, r.finish_location_name,
    'draft', r.public_visibility
  from public.races r
  where r.edition_id = p_source_edition_id
    and r.status not in ('cancelled', 'archived');

  perform private.record_audit(
    'edition.duplicate', 'editions', v_edition_id,
    jsonb_build_object('sourceEditionId', p_source_edition_id, 'year', p_year)
  );

  return v_edition_id;
end;
$$;

comment on function public.duplicate_edition(uuid, integer, date, date) is
  'Prépare une édition à partir d''une autre : épreuves et distances, en brouillon. Ni informations publiées, ni traces, ni liens d''inscription.';

revoke all on function public.duplicate_edition(uuid, integer, date, date) from public, anon;
grant execute on function public.duplicate_edition(uuid, integer, date, date) to authenticated;

commit;
