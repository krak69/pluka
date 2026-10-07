-- PLUKA V1 — Statut de gestion posé à la création d'un événement
-- File target: supabase/migrations/0041_event_management_status_on_create.sql
-- Référence : docs/05_ROUTES_FLOWS.md (pastille de type) · docs/02_DATA_MODEL.md §3 ·
--             migration 0040
--
-- Décision produit du 2026-10-07 : un événement créé avec une organisation
-- est `organizer_managed` (« Partenaire »), sans organisation `pluka_managed`
-- (« Maintenu par PLUKA »). Jusqu'ici, la création laissait la valeur par
-- défaut de 0001, `pluka_managed`, même avec une organisation : l'admin
-- affichait « Maintenu par PLUKA » sur un événement d'organisateur.
--
-- La création manuelle (`createEvent`, domaine) pose la même règle. Aucune
-- donnée existante n'est réécrite : la règle vaut pour les créations, et un
-- écart sur un événement existant reste visible à l'écran (05_ROUTES_FLOWS).
--
-- Seule la fonction de 0040 change ; elle est remplacée à l'identique, à la
-- colonne `management_status` près.

begin;

create or replace function public.admin_create_event_from_discovery(
  p_discovery_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_discovery private.event_discoveries;
  v_event jsonb := p_payload -> 'event';
  v_edition jsonb := p_payload -> 'edition';
  v_race jsonb;
  v_event_id uuid;
  v_edition_id uuid;
  v_organization_id uuid;
  v_timezone text;
  v_start timestamptz;
  v_races integer := 0;
begin
  perform private.assert_pluka_admin('admin_create_event_from_discovery');

  if p_discovery_id is not null then
    select * into v_discovery from private.event_discoveries d
    where d.id = p_discovery_id
    for update;

    if v_discovery.id is null then
      raise exception 'découverte introuvable' using errcode = 'P0002';
    end if;
    if v_discovery.status = 'consumed' then
      raise exception 'cette découverte a déjà créé un événement' using errcode = '55000';
    end if;
  end if;

  v_organization_id := nullif(v_event ->> 'organizationId', '')::uuid;
  if v_organization_id is not null and not exists (
    select 1 from public.organizations o where o.id = v_organization_id and o.deleted_at is null
  ) then
    raise exception 'organisation introuvable' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.events e where e.slug = v_event ->> 'slug') then
    raise exception 'ce slug d''événement est déjà utilisé' using errcode = '23505';
  end if;

  insert into public.events
    (organization_id, management_status, name, slug, city, official_website_url)
  values (
    v_organization_id,
    -- Décision produit du 2026-10-07 : avec une organisation, « Partenaire ».
    case when v_organization_id is null then 'pluka_managed' else 'organizer_managed' end::public.management_status,
    btrim(v_event ->> 'name'),
    v_event ->> 'slug',
    nullif(btrim(v_event ->> 'city'), ''),
    nullif(btrim(v_event ->> 'officialWebsiteUrl'), '')
  )
  returning id into v_event_id;

  insert into public.editions (event_id, year, slug, start_date, end_date)
  values (
    v_event_id,
    (v_edition ->> 'year')::smallint,
    v_edition ->> 'slug',
    (v_edition ->> 'startDate')::date,
    nullif(v_edition ->> 'endDate', '')::date
  )
  returning id into v_edition_id;

  for v_race in select value from jsonb_array_elements(coalesce(p_payload -> 'races', '[]'::jsonb))
  loop
    v_timezone := v_race ->> 'timezone';
    if not exists (select 1 from pg_catalog.pg_timezone_names t where t.name = v_timezone) then
      raise exception 'fuseau horaire inconnu : %', v_timezone using errcode = '22023';
    end if;

    v_start := ((v_race ->> 'startDate')::date + (v_race ->> 'startTime')::time)
               at time zone v_timezone;

    insert into public.races
      (edition_id, name, slug, distance_km, elevation_gain_m, start_datetime, timezone)
    values (
      v_edition_id,
      btrim(v_race ->> 'name'),
      v_race ->> 'slug',
      (v_race ->> 'distanceKm')::numeric,
      nullif(v_race ->> 'elevationGainM', '')::integer,
      v_start,
      v_timezone
    );
    v_races := v_races + 1;
  end loop;

  if p_discovery_id is not null then
    update private.event_discoveries
    set status = 'consumed', event_id = v_event_id, updated_at = now()
    where id = p_discovery_id;
  end if;

  perform private.record_audit(
    'event.create_from_discovery', 'events', v_event_id,
    jsonb_build_object('discoveryId', p_discovery_id, 'editionId', v_edition_id, 'raceCount', v_races)
  );

  return v_event_id;
end;
$$;

commit;
