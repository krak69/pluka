-- PLUKA V1 — Date d'inscription vérifiée
-- File target: supabase/migrations/0083_participant_registration_date.sql
-- Référence : docs/00_PRODUCT_SPEC.md §6.5.3, §29.1 · docs/04_ENTITLEMENTS.md §72.1
--
-- POURQUOI
--
-- Le tarif early bird dépend de la date d'inscription à la course. Elle est
-- « vérifiée » quand l'organisation l'apporte par son fichier ; à défaut, la
-- date de référence est la création de la participation dans PLUKA
-- (« déclarative »), qui n'a pas besoin de colonne : c'est `created_at`.
--
-- `registered_on` ne porte donc que la date vérifiée. Un jour, pas un instant :
-- les exports d'inscription donnent un jour, et l'éligibilité se compte en
-- jours civils dans le fuseau de la course (packages/domain, billing).
--
-- Règle de réimport (§29.1) : une date vérifiée reste figée ; une participation
-- sans date vérifiée prend celle du fichier. Le geste passe par la fonction
-- d'effet, comme dossard et vague : ce que la vérification annonce est ce que
-- l'import fait.
--
-- Aucun grant de colonne : comme le reste de la liste, elle reste côté serveur.

begin;

alter table public.participant_races
  add column registered_on date
    constraint participant_races_registered_on_plausible check (registered_on >= date '2000-01-01');

comment on column public.participant_races.registered_on is
  'Date d''inscription vérifiée, apportée par un import organisateur (§6.5.3). Figée une fois posée. Nulle : la date de référence est created_at (déclarative).';

drop function private.participant_import_effect(uuid, text, text, text);

create function private.participant_import_effect(
  p_race_id uuid,
  p_email text,
  p_bib text,
  p_wave text,
  p_registered_on date,
  out participant_id uuid,
  out effect text,
  out apply_bib boolean,
  out apply_wave boolean,
  out apply_registered_on boolean,
  out kept boolean,
  out wave_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status public.participant_race_status;
  v_bib text;
  v_wave text;
  v_bib_manual boolean;
  v_wave_manual boolean;
  v_registered_on date;
begin
  apply_bib := false;
  apply_wave := false;
  apply_registered_on := false;
  kept := false;

  select w.id into wave_id from public.race_start_waves w
  where w.race_id = p_race_id and lower(w.name) = lower(p_wave)
  order by w.sort_order limit 1;

  select pr.id, pr.status, pr.bib_number, coalesce(w.name, pr.declared_wave_name),
         pr.bib_set_manually, pr.wave_set_manually, pr.registered_on
  into participant_id, v_status, v_bib, v_wave, v_bib_manual, v_wave_manual, v_registered_on
  from public.participant_races pr
  left join public.race_start_waves w on w.id = pr.start_wave_id
  -- Sous `search_path = ''`, `=` compare en texte : la casse se retire à la main.
  where pr.race_id = p_race_id and lower(pr.invite_email::text) = lower(p_email)
  limit 1;

  if participant_id is null then
    effect := 'new';
    return;
  end if;

  if v_status = 'archived' then
    effect := 'withdrawn';
    return;
  end if;

  if p_bib is not null and p_bib is distinct from v_bib then
    if v_bib_manual then kept := true; else apply_bib := true; end if;
  end if;

  if p_wave is not null and lower(p_wave) is distinct from lower(v_wave) then
    if v_wave_manual then kept := true; else apply_wave := true; end if;
  end if;

  -- Une date vérifiée est figée : un fichier plus récent ne la déplace pas.
  if p_registered_on is not null and v_registered_on is null then
    apply_registered_on := true;
  end if;

  effect := case
    when apply_bib or apply_wave or apply_registered_on then 'updated'
    else 'unchanged'
  end;
end;
$$;

revoke all on function private.participant_import_effect(uuid, text, text, text, date)
  from public, anon, authenticated;

create or replace function public.commit_participant_import(p_import_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import public.participant_imports;
  v_row public.participant_import_rows;
  v_data jsonb;
  v_race_id uuid;
  v_email extensions.citext;
  v_bib text;
  v_wave text;
  v_registered_on date;
  v_effect record;
  v_participant_id uuid;
  v_created integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_kept integer := 0;
  v_withdrawn integer := 0;
begin
  select * into v_import from public.participant_imports i where i.id = p_import_id for update;
  if not found then
    raise exception 'import introuvable' using errcode = 'P0002';
  end if;
  perform private.assert_can_import_participants(v_import.edition_id);

  if v_import.status <> 'validating' then
    raise exception 'import non prêt' using errcode = '55000';
  end if;

  for v_row in
    select * from public.participant_import_rows r
    where r.import_id = p_import_id and r.status = 'valid'
    order by r.row_number
  loop
    v_data := v_row.mapped_data;
    v_race_id := (v_data ->> 'raceId')::uuid;
    v_email := (v_data ->> 'email')::extensions.citext;
    v_bib := nullif(v_data ->> 'bib', '');
    v_wave := nullif(v_data ->> 'wave', '');
    v_registered_on := nullif(v_data ->> 'registeredOn', '')::date;

    if not exists (
      select 1 from public.races r where r.id = v_race_id and r.edition_id = v_import.edition_id
    ) then
      raise exception 'épreuve hors de cette édition' using errcode = '22023';
    end if;

    select * into v_effect
    from private.participant_import_effect(v_race_id, v_email::text, v_bib, v_wave, v_registered_on);

    if v_effect.effect = 'withdrawn' then
      update public.participant_import_rows r
      set status = 'skipped', participant_race_id = v_effect.participant_id,
        error_message = 'Retiré de la liste : un fichier ne le rétablit pas.'
      where r.id = v_row.id;
      v_withdrawn := v_withdrawn + 1;
      continue;
    end if;

    if v_effect.effect = 'new' then
      insert into public.participant_races
        (race_id, invite_email, first_name_snapshot, last_name_snapshot, registration_source,
         bib_number, start_wave_id, declared_wave_name, registered_on)
      values
        (v_race_id, v_email, v_data ->> 'firstName', v_data ->> 'lastName', 'organizer_import',
         v_bib, v_effect.wave_id,
         case when v_effect.wave_id is null then left(v_wave, 120) end,
         v_registered_on)
      returning id into v_participant_id;

      if coalesce(v_data ->> 'sex', v_data ->> 'birthDate', v_data ->> 'nationality') is not null then
        insert into private.participant_demographics (participant_race_id, sex, birth_date, nationality)
        values (v_participant_id, v_data ->> 'sex', (v_data ->> 'birthDate')::date, v_data ->> 'nationality');
      end if;

      -- Deux fournisseurs, deux lignes : jamais un indice commun (AGENTS §18).
      if (v_data ->> 'itraIndex') is not null then
        insert into private.participant_performance_signals
          (participant_race_id, provider, provider_identifier, value)
        values (v_participant_id, 'itra', v_data ->> 'itraId', (v_data ->> 'itraIndex')::numeric);
      end if;
      if (v_data ->> 'utmbIndex') is not null then
        insert into private.participant_performance_signals
          (participant_race_id, provider, provider_identifier, value)
        values (v_participant_id, 'utmb', v_data ->> 'utmbId', (v_data ->> 'utmbIndex')::numeric);
      end if;

      update public.participant_import_rows r
      set status = 'imported', participant_race_id = v_participant_id
      where r.id = v_row.id;
      v_created := v_created + 1;
      continue;
    end if;

    -- Présent : dossard, vague et date d'inscription non vérifiée, seulement ce que le fichier apporte.
    if v_effect.apply_bib then
      update public.participant_races pr set bib_number = v_bib
      where pr.id = v_effect.participant_id;
    end if;
    if v_effect.apply_wave then
      update public.participant_races pr
      set start_wave_id = v_effect.wave_id,
        declared_wave_name = case when v_effect.wave_id is null then left(v_wave, 120) end
      where pr.id = v_effect.participant_id;
    end if;
    if v_effect.apply_registered_on then
      -- `is null` redit ici : la règle de figement tient même si l'effet était périmé.
      update public.participant_races pr set registered_on = v_registered_on
      where pr.id = v_effect.participant_id and pr.registered_on is null;
    end if;

    if v_effect.kept then
      v_kept := v_kept + 1;
    end if;

    if v_effect.effect = 'updated' then
      update public.participant_import_rows r
      set status = 'imported', participant_race_id = v_effect.participant_id,
        error_message = case when v_effect.kept then 'Correction à la main gardée.' end
      where r.id = v_row.id;
      v_updated := v_updated + 1;
    else
      update public.participant_import_rows r
      set status = 'skipped', participant_race_id = v_effect.participant_id,
        error_message = case when v_effect.kept then 'Correction à la main gardée.' else 'Déjà dans la liste.' end
      where r.id = v_row.id;
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  -- Les données de la ligne ont rejoint leur place : elles ne restent pas ici.
  update public.participant_import_rows r
  set raw_data = '{}'::jsonb, mapped_data = '{}'::jsonb
  where r.import_id = p_import_id;

  update public.participant_imports i set status = 'imported' where i.id = p_import_id;

  perform private.record_audit(
    'participant_import.commit', 'participant_imports', p_import_id,
    jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped,
      'kept', v_kept, 'withdrawn', v_withdrawn)
  );

  return jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped,
    'kept', v_kept, 'withdrawn', v_withdrawn);
end;
$$;

/*
 * L'état d'un import pour son assistant. Effets et vagues inconnues se calculent
 * avec la fonction de l'import : ce que l'organisation lit est ce qui se passera.
 */
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

  return (
    with planned as materialized (
      select race.id as race_id, race.name as race_name, r.mapped_data ->> 'wave' as wave, e.*
      from public.participant_import_rows r
      join public.races race
        on race.id::text = r.mapped_data ->> 'raceId' and race.edition_id = v_import.edition_id
      cross join lateral private.participant_import_effect(
        race.id, r.mapped_data ->> 'email',
        nullif(r.mapped_data ->> 'bib', ''), nullif(r.mapped_data ->> 'wave', ''),
        nullif(r.mapped_data ->> 'registeredOn', '')::date
      ) e
      where r.import_id = p_import_id and r.status = 'valid'
    ), unknown as (
      select p.race_name, min(p.wave) as wave, count(*)::integer as n
      from planned p
      where nullif(p.wave, '') is not null
        and p.wave_id is null
        and (p.effect = 'new' or p.apply_wave)
      group by p.race_id, p.race_name, lower(p.wave)
    ), shown as (
      -- Une colonne mal choisie donnerait une vague par ligne : l'écran en montre 20.
      select u.race_name, u.wave, u.n from unknown u order by u.race_name, lower(u.wave) limit 20
    )
    select jsonb_build_object(
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
      'effects', jsonb_build_object(
        'created', (select count(*)::integer from planned p where p.effect = 'new'),
        'updated', (select count(*)::integer from planned p where p.effect = 'updated'),
        'unchanged', (select count(*)::integer from planned p where p.effect = 'unchanged'),
        'kept', (select count(*)::integer from planned p where p.kept),
        'withdrawn', (select count(*)::integer from planned p where p.effect = 'withdrawn')
      ),
      'unknownWaves', jsonb_build_object(
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
