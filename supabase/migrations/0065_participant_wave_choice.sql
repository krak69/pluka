-- PLUKA V1 — Participants : la vague se choisit dans une liste
-- File target: supabase/migrations/0065_participant_wave_choice.sql
-- Référence : docs/00_PRODUCT_SPEC.md §29.1 · docs/02_DATA_MODEL.md §20.1
--
-- POURQUOI
--
-- Une saisie libre crée des variantes : « Sas 1 », « SAS1 », « Sas1 ». Corriger une
-- vague revient à choisir parmi celles que l'épreuve connaît : ses vagues officielles,
-- et celles déjà apportées par un fichier, en attente de déclaration. Une vague
-- nouvelle n'arrive que par un fichier ou par sa déclaration.

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
      select pr.id, pr.race_id, pr.first_name_snapshot, pr.last_name_snapshot, pr.invite_email,
        pr.bib_number, pr.declared_wave_name, pr.user_id, r.name as race_name, w.name as wave_name,
        pr.bib_number is not null
          and count(*) over (partition by pr.race_id, pr.bib_number) > 1 as bib_conflict
      from public.participant_races pr
      join public.races r on r.id = pr.race_id
      left join public.race_start_waves w on w.id = pr.start_wave_id
      where r.edition_id = p_edition_id and pr.status <> 'archived'
    ), wave_choices as (
      select c.race_id, c.name, bool_or(c.official) as official, min(c.sort_order) as sort_order
      from (
        select w.race_id, w.name, true as official, w.sort_order
        from public.race_start_waves w
        join public.races r on r.id = w.race_id
        where r.edition_id = p_edition_id
        union all
        select e.race_id, e.declared_wave_name, false, null
        from edition_participants e
        where e.declared_wave_name is not null
      ) c
      group by c.race_id, c.name
    ), wave_options as (
      -- Une colonne mal choisie donnerait une vague par ligne : chaque liste s'arrête à 50.
      select o.race_id, o.name, o.official,
        row_number() over (
          partition by o.race_id order by o.official desc, o.sort_order, lower(o.name)
        ) as position
      from wave_choices o
    ), listed as (
      select lower(coalesce(e.last_name_snapshot, '') || ' ' || coalesce(e.first_name_snapshot, '')) as sort_name,
        e.bib_conflict as to_check,
        jsonb_build_object(
          'id', e.id,
          'raceId', e.race_id,
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
      order by e.bib_conflict desc,
        lower(coalesce(e.last_name_snapshot, '')), lower(coalesce(e.first_name_snapshot, ''))
      limit least(greatest(p_limit, 1), 2000)
    )
    select jsonb_build_object(
      'total', (select count(*)::integer from edition_participants),
      'toCheck', jsonb_build_object(
        'bibs', (select count(*)::integer from edition_participants e where e.bib_conflict)
      ),
      'pendingWaves', (select count(*)::integer from edition_participants e where e.declared_wave_name is not null),
      'waveOptions', coalesce((
        select jsonb_agg(jsonb_build_object('raceId', o.race_id, 'name', o.name, 'official', o.official)
                         order by o.race_id, o.position)
        from wave_options o
        where o.position <= 50
      ), '[]'::jsonb),
      'participants', coalesce((
        select jsonb_agg(l.payload order by l.to_check desc, l.sort_name) from listed l
      ), '[]'::jsonb),
      'withdrawn', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id, 'firstName', t.first_name_snapshot, 'lastName', t.last_name_snapshot,
          'bib', t.bib_number, 'raceName', t.race_name
        ) order by lower(coalesce(t.last_name_snapshot, '')))
        from (
          select pr.id, pr.first_name_snapshot, pr.last_name_snapshot, pr.bib_number, r.name as race_name
          from public.participant_races pr
          join public.races r on r.id = pr.race_id
          where r.edition_id = p_edition_id and pr.status = 'archived' and pr.user_id is null
          order by lower(coalesce(pr.last_name_snapshot, ''))
          limit 500
        ) t
      ), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.correct_participant_registration(
  p_participant_race_id uuid,
  p_bib text,
  p_wave text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_race_id uuid;
  v_status public.participant_race_status;
  v_current_bib text;
  v_current_wave text;
  v_bib text := nullif(btrim(p_bib), '');
  v_wave text := nullif(btrim(p_wave), '');
  v_wave_id uuid;
begin
  select r.edition_id, pr.race_id, pr.status, pr.bib_number, coalesce(w.name, pr.declared_wave_name)
  into v_edition_id, v_race_id, v_status, v_current_bib, v_current_wave
  from public.participant_races pr
  join public.races r on r.id = pr.race_id
  left join public.race_start_waves w on w.id = pr.start_wave_id
  where pr.id = p_participant_race_id
  for update of pr;

  if not found then
    raise exception 'participant introuvable' using errcode = 'P0002';
  end if;
  perform private.assert_can_import_participants(v_edition_id);

  if v_status = 'archived' then
    raise exception 'participant retiré' using errcode = '55000';
  end if;
  if char_length(v_bib) > 30 or char_length(v_wave) > 120 then
    raise exception 'valeur trop longue' using errcode = '22023';
  end if;

  -- Une liste côté écran ne suffit pas : la règle tient aussi pour un appel direct.
  if v_wave is not null
    and lower(v_wave) is distinct from lower(v_current_wave)
    and not exists (
      select 1 from public.race_start_waves w
      where w.race_id = v_race_id and lower(w.name) = lower(v_wave)
    )
    and not exists (
      select 1 from public.participant_races pr
      where pr.race_id = v_race_id and pr.status <> 'archived'
        and lower(pr.declared_wave_name) = lower(v_wave)
    )
  then
    raise exception 'vague inconnue sur cette épreuve' using errcode = '22023';
  end if;

  if v_bib is distinct from v_current_bib then
    update public.participant_races pr
    set bib_number = v_bib, bib_set_manually = v_bib is not null
    where pr.id = p_participant_race_id;
  end if;

  if lower(v_wave) is distinct from lower(v_current_wave) then
    select w.id into v_wave_id from public.race_start_waves w
    where w.race_id = v_race_id and lower(w.name) = lower(v_wave)
    order by w.sort_order limit 1;

    update public.participant_races pr
    set start_wave_id = v_wave_id,
      declared_wave_name = case when v_wave_id is null then v_wave end,
      wave_set_manually = v_wave is not null
    where pr.id = p_participant_race_id;
  end if;

  -- Aucune valeur au journal : l'action et l'identifiant suffisent (AGENTS §62).
  perform private.record_audit(
    'participant.correct', 'participant_races', p_participant_race_id, '{}'::jsonb
  );
end;
$$;

commit;
