-- PLUKA V1 — Création classique d'un événement, inventaire du site sans IA
-- File target: supabase/migrations/0042_classic_event_creation.sql
-- Référence : docs/engines/SOURCES_EXTRACTION.md §11.1 · docs/02_DATA_MODEL.md §7.10 ·
--             docs/05_ROUTES_FLOWS.md (/evenements/nouveau) · migrations 0040, 0041
--
-- DÉCISION PRODUIT DU 2026-10-07 (révise 0040)
--
-- La création d'un événement redevient un parcours classique en quatre
-- étapes — événement, édition, épreuves, documents — saisi par
-- l'administrateur. Plus de proposition d'événement ni d'épreuves par IA.
--
-- Le site officiel, s'il est donné, est inventorié sans IA : pages lues et
-- documents liés, proposés ensuite à l'analyse. L'IA n'intervient plus que là
-- où elle intervenait déjà : l'extraction des sources choisies (§21).
--
-- CE QUE LA MIGRATION CHANGE
--
--   01. `private.event_discoveries` devient l'inventaire d'un événement :
--       `event_id` obligatoire, `proposal` renommé `inventory`, plus de
--       statut `consumed` ni de colonnes d'IA ;
--   02. les fonctions de 0040 et 0041 propres à la proposition disparaissent ;
--   03. `admin_create_event` : événement, édition, épreuves et, si un site est
--       donné, son inventaire — en une transaction ;
--   04. relancer et lire l'inventaire d'un événement ;
--   05. la surface du worker, à la nouvelle forme.
--
-- Documents d'édition, dépôt de PDF et état des analyses (0040, section 05 et
-- 06) ne changent pas.

begin;

-- ============================================================
-- 01. Table
-- ============================================================

-- Une découverte sans événement n'a plus de sens : elle venait du premier
-- parcours, où l'on analysait le site avant de créer.
delete from private.event_discoveries where event_id is null;
update private.event_discoveries set status = 'ready' where status = 'consumed';

alter table private.event_discoveries
  drop constraint if exists event_discoveries_check,
  drop constraint if exists event_discoveries_check1,
  drop constraint if exists event_discoveries_status_check;

alter table private.event_discoveries rename column proposal to inventory;
alter table private.event_discoveries
  rename constraint event_discoveries_proposal_check to event_discoveries_inventory_check;

alter table private.event_discoveries
  drop column ai_used,
  drop column prompt_version,
  alter column event_id set not null,
  add constraint event_discoveries_status_check
    check (status in ('queued', 'running', 'ready', 'failed')),
  add constraint event_discoveries_ready_has_inventory
    check ((status = 'ready') <= (inventory is not null));

-- L'événement porte ses inventaires : supprimer l'un supprime les autres.
alter table private.event_discoveries
  drop constraint event_discoveries_event_id_fkey,
  add constraint event_discoveries_event_id_fkey
    foreign key (event_id) references public.events(id) on delete cascade;

comment on table private.event_discoveries is
  'Inventaire d''un site officiel : pages lues et documents liés (SOURCES_EXTRACTION §11.1). Sans IA ; aucune donnée publiée.';

-- ============================================================
-- 02. Fonctions retirées
-- ============================================================

drop function if exists public.admin_start_event_discovery(text);
drop function if exists public.admin_get_event_discovery(uuid);
drop function if exists public.admin_create_event_from_discovery(uuid, jsonb);
drop function if exists public.worker_complete_event_discovery(uuid, text, jsonb, smallint, boolean, text, text);

-- ============================================================
-- 03. Création
-- ============================================================

/*
 * Enfile l'inventaire du site d'un événement. Appelée par la création et par
 * la relance : une seule façon de lancer la lecture d'un site.
 */
create or replace function private.enqueue_event_discovery(p_event_id uuid, p_site_url text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_key text;
begin
  -- La forme seulement : la garde SSRF complète (§12) est refaite par le
  -- worker, après résolution DNS, à chaque requête.
  if p_site_url !~* '^https?://[^/\s]+' or length(p_site_url) > 2048 then
    raise exception 'adresse de site invalide' using errcode = '22023';
  end if;

  insert into private.event_discoveries (requested_by_user_id, site_url, event_id)
  values ((select auth.uid()), p_site_url, p_event_id)
  returning id into v_id;

  v_key := 'source.discover:' || v_id::text;

  insert into private.outbox_events (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
  values (
    'source.discover',
    'event_discovery',
    v_id,
    jsonb_build_object('discoveryId', v_id, 'url', p_site_url, 'idempotencyKey', v_key),
    v_key
  );

  return v_id;
end;
$$;

/*
 * Événement, édition et épreuves, en une transaction — les étapes 1 à 3 du
 * parcours, saisies par l'administrateur. La base vérifie et écrit.
 *
 * `management_status` suit la règle de 0041 : avec une organisation
 * `organizer_managed`, sans `pluka_managed`. L'heure de départ arrive en
 * heure locale (date, heure, fuseau IANA) et l'instant est calculé ici, par
 * PostgreSQL : aucune arithmétique de chaîne (AGENTS §34).
 */
create or replace function public.admin_create_event(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event jsonb := p_payload -> 'event';
  v_edition jsonb := p_payload -> 'edition';
  v_race jsonb;
  v_event_id uuid;
  v_edition_id uuid;
  v_organization_id uuid;
  v_site text;
  v_timezone text;
  v_races integer := 0;
begin
  perform private.assert_pluka_admin('admin_create_event');

  v_organization_id := nullif(v_event ->> 'organizationId', '')::uuid;
  if v_organization_id is not null and not exists (
    select 1 from public.organizations o where o.id = v_organization_id and o.deleted_at is null
  ) then
    raise exception 'organisation introuvable' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.events e where e.slug = v_event ->> 'slug') then
    raise exception 'ce slug d''événement est déjà utilisé' using errcode = '23505';
  end if;

  v_site := nullif(btrim(v_event ->> 'officialWebsiteUrl'), '');

  insert into public.events
    (organization_id, management_status, name, slug, city, official_website_url)
  values (
    v_organization_id,
    case when v_organization_id is null then 'pluka_managed' else 'organizer_managed' end::public.management_status,
    btrim(v_event ->> 'name'),
    v_event ->> 'slug',
    nullif(btrim(v_event ->> 'city'), ''),
    v_site
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

    insert into public.races
      (edition_id, name, slug, distance_km, elevation_gain_m, start_datetime, timezone)
    values (
      v_edition_id,
      btrim(v_race ->> 'name'),
      v_race ->> 'slug',
      (v_race ->> 'distanceKm')::numeric,
      nullif(v_race ->> 'elevationGainM', '')::integer,
      ((v_race ->> 'startDate')::date + (v_race ->> 'startTime')::time) at time zone v_timezone,
      v_timezone
    );
    v_races := v_races + 1;
  end loop;

  -- L'étape 4 trouvera l'inventaire du site prêt, ou en cours.
  if v_site is not null then
    perform private.enqueue_event_discovery(v_event_id, v_site);
  end if;

  perform private.record_audit(
    'event.create', 'events', v_event_id,
    jsonb_build_object('editionId', v_edition_id, 'raceCount', v_races, 'siteInventory', v_site is not null)
  );

  return v_event_id;
end;
$$;

-- ============================================================
-- 04. Relancer, lire
-- ============================================================

create or replace function public.admin_refresh_event_discovery(p_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site text;
  v_id uuid;
begin
  perform private.assert_pluka_admin('admin_refresh_event_discovery');

  select e.official_website_url into v_site from public.events e where e.id = p_event_id;
  if not found then
    raise exception 'événement introuvable' using errcode = 'P0002';
  end if;
  if v_site is null then
    raise exception 'cet événement n''a pas de site officiel' using errcode = '55000';
  end if;

  v_id := private.enqueue_event_discovery(p_event_id, v_site);

  perform private.record_audit('event_discovery.refresh', 'event_discoveries', v_id, '{}'::jsonb);

  return v_id;
end;
$$;

/* Le dernier inventaire de l'événement, ou `null` s'il n'en a pas. */
create or replace function public.admin_get_event_discovery(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row private.event_discoveries;
begin
  perform private.assert_pluka_admin('admin_get_event_discovery');

  select * into v_row from private.event_discoveries d
  where d.event_id = p_event_id
  order by d.created_at desc, d.id desc
  limit 1;

  if v_row.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'discoveryId', v_row.id,
    'siteUrl', v_row.site_url,
    'finalUrl', v_row.final_url,
    'status', v_row.status,
    'errorCode', v_row.error_code,
    'pagesRead', v_row.pages_read,
    'inventory', v_row.inventory,
    'createdAt', v_row.created_at,
    'completedAt', v_row.completed_at
  );
end;
$$;

-- ============================================================
-- 05. Worker
-- ============================================================

create or replace function public.worker_complete_event_discovery(
  p_discovery_id uuid,
  p_final_url text,
  p_inventory jsonb,
  p_pages_read smallint,
  p_discovery_version text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.event_discoveries
  set status = 'ready',
      final_url = p_final_url,
      inventory = p_inventory,
      pages_read = p_pages_read,
      discovery_version = p_discovery_version,
      error_code = null,
      completed_at = now(),
      updated_at = now()
  where id = p_discovery_id and status in ('queued', 'running');
$$;

-- ============================================================
-- Droits
-- ============================================================

revoke all on function private.enqueue_event_discovery(uuid, text) from public, anon, authenticated;

revoke all on function public.admin_create_event(jsonb) from public, anon;
revoke all on function public.admin_refresh_event_discovery(uuid) from public, anon;
revoke all on function public.admin_get_event_discovery(uuid) from public, anon;
grant execute on function public.admin_create_event(jsonb) to authenticated;
grant execute on function public.admin_refresh_event_discovery(uuid) to authenticated;
grant execute on function public.admin_get_event_discovery(uuid) to authenticated;

revoke all on function public.worker_complete_event_discovery(uuid, text, jsonb, smallint, text)
  from public, anon, authenticated;
grant execute on function public.worker_complete_event_discovery(uuid, text, jsonb, smallint, text)
  to service_role;

commit;
