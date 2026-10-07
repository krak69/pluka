-- PLUKA V1 — Création d'un événement depuis son site officiel
-- File target: supabase/migrations/0040_event_discovery.sql
-- Référence : docs/engines/SOURCES_EXTRACTION.md §5, §11.1, §12, §57 ·
--             docs/02_DATA_MODEL.md §7.10 · docs/05_ROUTES_FLOWS.md (/evenements/nouveau) ·
--             docs/03_PRIVACY_RLS.md §8, §84
--
-- LE FLUX (createStep du prototype, décision produit du 2026-10-07)
--
--   1. l'administrateur donne le site officiel ;
--   2. le worker lit le site, borné (§11.1), et dépose une PROPOSITION ;
--   3. l'administrateur relit, corrige, et crée événement + édition + épreuves
--      en un seul geste ;
--   4. il choisit les documents trouvés, en dépose d'autres (PDF), et lance
--      leur analyse : ce sont des sources ordinaires, qui suivent la chaîne
--      canonique jusqu'à la revue humaine de /validation.
--
-- Rien de ce que propose la découverte ne devient un RaceFact : l'étape 3 crée
-- la structure (événement, édition, épreuves), jamais une information de
-- course publiée.
--
-- CE QUE LA MIGRATION AJOUTE
--
--   01. `private.event_discoveries` ;
--   02. le démarrage et la lecture d'une découverte ;
--   03. la surface du worker ;
--   04. la création depuis la proposition ;
--   05. les documents d'une édition : ajout par URL, dépôt de PDF, état ;
--   06. le bucket et ses policies pour les PDF déposés.

begin;

-- ============================================================
-- 01. Découvertes
-- ============================================================

create table private.event_discoveries (
  id uuid primary key default gen_random_uuid(),
  requested_by_user_id uuid references public.users(id) on delete set null,
  site_url text not null check (site_url ~ '^https?://' and length(site_url) <= 2048),
  final_url text,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'ready', 'failed', 'consumed')),
  -- Code technique (`ROBOTS_DISALLOWED`, `HTTP_ERROR`…), jamais un message de
  -- fournisseur : il s'affiche traduit, et un message brut fuirait du détail.
  error_code text check (error_code is null or error_code ~ '^[A-Z_]{2,40}$'),
  pages_read smallint check (pages_read is null or pages_read between 0 and 15),
  ai_used boolean,
  discovery_version text,
  prompt_version text,
  proposal jsonb check (proposal is null or jsonb_typeof(proposal) = 'object'),
  event_id uuid references public.events(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((status = 'ready') <= (proposal is not null)),
  check ((status = 'consumed') <= (event_id is not null))
);

create index ix_event_discoveries_requested_by on private.event_discoveries(requested_by_user_id);
create index ix_event_discoveries_event on private.event_discoveries(event_id);

alter table private.event_discoveries enable row level security;
-- Aucune policy : schéma privé, atteint seulement par les fonctions ci-dessous.

comment on table private.event_discoveries is
  'Proposition de création d''événement lue sur un site officiel (SOURCES_EXTRACTION §11.1). Jamais une donnée publiée : la création est un geste humain.';

-- ============================================================
-- 02. Démarrer, lire
-- ============================================================

create or replace function public.admin_start_event_discovery(p_site_url text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_url text := btrim(coalesce(p_site_url, ''));
  v_key text;
begin
  perform private.assert_pluka_admin('admin_start_event_discovery');

  -- La forme seulement : la garde SSRF complète (§12) est refaite par le
  -- worker, après résolution DNS, à chaque requête.
  if v_url !~* '^https?://[^/\s]+' or length(v_url) > 2048 then
    raise exception 'adresse de site invalide' using errcode = '22023';
  end if;

  insert into private.event_discoveries (requested_by_user_id, site_url)
  values ((select auth.uid()), v_url)
  returning id into v_id;

  v_key := 'source.discover:' || v_id::text;

  insert into private.outbox_events (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
  values (
    'source.discover',
    'event_discovery',
    v_id,
    jsonb_build_object('discoveryId', v_id, 'url', v_url, 'idempotencyKey', v_key),
    v_key
  );

  perform private.record_audit(
    'event_discovery.start', 'event_discoveries', v_id,
    jsonb_build_object('host', substring(v_url from '^https?://([^/:?#]+)'))
  );

  return v_id;
end;
$$;

comment on function public.admin_start_event_discovery(text) is
  'Enfile la découverte d''un site officiel (SOURCES_EXTRACTION §11.1). Administrateurs PLUKA.';

/*
 * Lecture d'une découverte, avec les événements qui lui ressemblent.
 *
 * La ressemblance est volontairement étroite : même site officiel (hôte, `www.`
 * ignoré) ou même nom à la casse près. C'est le garde-fou de doublon du
 * prototype, sans score inventé : l'écran montre ce qui correspond, et
 * l'administrateur juge.
 */
create or replace function public.admin_get_event_discovery(p_discovery_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row private.event_discoveries;
  v_host text;
  v_name text;
begin
  perform private.assert_pluka_admin('admin_get_event_discovery');

  select * into v_row from private.event_discoveries d where d.id = p_discovery_id;
  if v_row.id is null then
    raise exception 'découverte introuvable' using errcode = 'P0002';
  end if;

  v_host := lower(regexp_replace(
    substring(coalesce(v_row.final_url, v_row.site_url) from '^https?://([^/:?#]+)'), '^www\.', ''));
  v_name := lower(btrim(v_row.proposal #>> '{event,name,value}'));

  return jsonb_build_object(
    'discoveryId', v_row.id,
    'siteUrl', v_row.site_url,
    'finalUrl', v_row.final_url,
    'status', v_row.status,
    'errorCode', v_row.error_code,
    'pagesRead', v_row.pages_read,
    'aiUsed', v_row.ai_used,
    'proposal', v_row.proposal,
    'eventId', v_row.event_id,
    'createdAt', v_row.created_at,
    'completedAt', v_row.completed_at,
    'similarEvents', coalesce((
      select jsonb_agg(jsonb_build_object('eventId', e.id, 'name', e.name, 'slug', e.slug)
                       order by e.name)
      from public.events e
      where e.id is distinct from v_row.event_id
        and (
          (v_host is not null and lower(regexp_replace(
             substring(e.official_website_url from '^https?://([^/:?#]+)'), '^www\.', '')) = v_host)
          or (v_name is not null and lower(btrim(e.name)) = v_name)
        )
    ), '[]'::jsonb)
  );
end;
$$;

-- ============================================================
-- 03. Surface du worker
-- ============================================================

/*
 * Ouvre le traitement. Rend l'URL à lire, ou rien si la découverte n'est plus
 * à traiter : un message rejoué après succès ne refait pas le travail (§58).
 */
create or replace function public.worker_begin_event_discovery(p_discovery_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
begin
  update private.event_discoveries
  set status = 'running', updated_at = now()
  where id = p_discovery_id and status in ('queued', 'running')
  returning site_url into v_url;

  return v_url;
end;
$$;

create or replace function public.worker_complete_event_discovery(
  p_discovery_id uuid,
  p_final_url text,
  p_proposal jsonb,
  p_pages_read smallint,
  p_ai_used boolean,
  p_discovery_version text,
  p_prompt_version text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.event_discoveries
  set status = 'ready',
      final_url = p_final_url,
      proposal = p_proposal,
      pages_read = p_pages_read,
      ai_used = p_ai_used,
      discovery_version = p_discovery_version,
      prompt_version = p_prompt_version,
      error_code = null,
      completed_at = now(),
      updated_at = now()
  where id = p_discovery_id and status in ('queued', 'running');
$$;

create or replace function public.worker_fail_event_discovery(
  p_discovery_id uuid,
  p_error_code text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.event_discoveries
  set status = 'failed',
      error_code = p_error_code,
      completed_at = now(),
      updated_at = now()
  where id = p_discovery_id and status in ('queued', 'running');
$$;

-- ============================================================
-- 04. Création depuis la proposition
-- ============================================================

/*
 * Événement, édition et épreuves, en une transaction : l'administrateur a
 * relu et corrigé, la base ne fait que vérifier et écrire.
 *
 * Mêmes valeurs par défaut que la création manuelle (`createEvent`) : statut
 * `draft` partout, `management_status` laissé à la base. Une épreuve ne part
 * qu'avec une distance et un départ : la base les exige, et la découverte ne
 * les invente pas.
 *
 * L'heure de départ arrive en heure locale (date, heure, fuseau IANA) et
 * l'instant est calculé ici, par PostgreSQL : aucune arithmétique de chaîne
 * (AGENTS §34).
 */
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

  insert into public.events (organization_id, name, slug, city, official_website_url)
  values (
    v_organization_id,
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

-- ============================================================
-- 05. Documents d'une édition
-- ============================================================

/*
 * Ajout de documents par URL — ceux que la découverte a trouvés, ou une page
 * du site. Chaque document devient une source ordinaire par
 * `enqueue_source_ingest` (0009), qui porte sa propre garde et enfile la
 * capture. Une URL déjà déclarée pour cette édition n'est pas redéclarée :
 * relancer l'analyse ne double rien.
 */
create or replace function public.admin_add_edition_documents(
  p_edition_id uuid,
  p_documents jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document jsonb;
  v_url text;
  v_type public.source_type;
  v_race_id uuid;
  v_created integer := 0;
begin
  perform private.assert_pluka_admin('admin_add_edition_documents');

  if not exists (select 1 from public.editions ed where ed.id = p_edition_id) then
    raise exception 'édition introuvable' using errcode = 'P0002';
  end if;

  for v_document in select value from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb))
  loop
    v_url := btrim(v_document ->> 'url');
    if v_url !~* '^https?://' then
      raise exception 'adresse de document invalide' using errcode = '22023';
    end if;

    if exists (select 1 from public.sources s where s.edition_id = p_edition_id and s.url = v_url) then
      continue;
    end if;

    v_type := case v_document ->> 'kind' when 'pdf' then 'pdf' else 'url' end;
    v_race_id := nullif(v_document ->> 'raceId', '')::uuid;

    if v_race_id is not null and not exists (
      select 1 from public.races r where r.id = v_race_id and r.edition_id = p_edition_id
    ) then
      raise exception 'épreuve hors de cette édition' using errcode = '22023';
    end if;

    perform public.enqueue_source_ingest(
      p_edition_id, v_type, left(coalesce(nullif(btrim(v_document ->> 'title'), ''), v_url), 300),
      v_url, v_race_id
    );
    v_created := v_created + 1;
  end loop;

  perform private.record_audit(
    'edition.add_documents', 'editions', p_edition_id, jsonb_build_object('created', v_created)
  );

  return v_created;
end;
$$;

/*
 * Dépôt d'un PDF : le fichier est déjà dans le bucket, déposé sous la session
 * de l'administrateur (policies en 06). La source naît avec son snapshot, ce
 * qui enfile directement le parsing (`record_source_snapshot`, 0010) : il n'y
 * a rien à télécharger.
 *
 * Le chemin porte l'empreinte du contenu : redéposer le même fichier rend la
 * source existante.
 */
create or replace function public.admin_add_edition_file(
  p_edition_id uuid,
  p_title text,
  p_storage_path text,
  p_content_hash char(64),
  p_size_bytes bigint,
  p_race_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_id uuid;
  v_organization_id uuid;
begin
  perform private.assert_pluka_admin('admin_add_edition_file');

  if p_storage_path is distinct from
     'editions/' || p_edition_id::text || '/documents/' || p_content_hash || '.pdf' then
    raise exception 'chemin de dépôt invalide' using errcode = '22023';
  end if;

  select e.organization_id into v_organization_id
  from public.editions ed join public.events e on e.id = ed.event_id
  where ed.id = p_edition_id;
  if not found then
    raise exception 'édition introuvable' using errcode = 'P0002';
  end if;

  if p_race_id is not null and not exists (
    select 1 from public.races r where r.id = p_race_id and r.edition_id = p_edition_id
  ) then
    raise exception 'épreuve hors de cette édition' using errcode = '22023';
  end if;

  select s.id into v_source_id from public.sources s
  where s.edition_id = p_edition_id and s.storage_path = p_storage_path;
  if v_source_id is not null then
    return v_source_id;
  end if;

  insert into public.sources
    (edition_id, organization_id, source_type, title, storage_path, status, created_by_user_id)
  values
    (p_edition_id, v_organization_id, 'pdf', left(btrim(p_title), 300), p_storage_path,
     'uploaded', (select auth.uid()))
  returning id into v_source_id;

  if p_race_id is not null then
    insert into public.source_race_scopes (source_id, race_id) values (v_source_id, p_race_id);
  end if;

  perform private.record_source_snapshot(
    v_source_id, p_content_hash, p_storage_path, 'application/pdf', p_size_bytes, null, null
  );

  perform private.record_audit(
    'edition.add_file', 'sources', v_source_id, jsonb_build_object('editionId', p_edition_id)
  );

  return v_source_id;
end;
$$;

/*
 * État des documents d'une édition — étapes 3 et 4 du prototype.
 *
 * Un état par source, déduit de ce que la chaîne a réellement écrit : capture
 * (snapshot), extraction terminée, échec. Puis les candidats en attente de
 * revue, par catégorie : « PLUKA a identifié ». Les valeurs restent dans
 * /validation, où elles se relisent avec leur preuve.
 */
create or replace function public.admin_list_edition_documents(p_edition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_pluka_admin('admin_list_edition_documents');

  if not exists (select 1 from public.editions ed where ed.id = p_edition_id) then
    raise exception 'édition introuvable' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sourceId', s.id,
        'title', s.title,
        'sourceType', s.source_type,
        'url', s.url,
        'uploaded', s.storage_path is not null,
        'raceName', (
          select string_agg(r.name, ', ' order by r.name)
          from public.source_race_scopes sc join public.races r on r.id = sc.race_id
          where sc.source_id = s.id
        ),
        'state', case
          when s.status = 'failed' then 'failed'
          when s.current_snapshot_id is null then 'queued'
          when exists (
            select 1 from private.extraction_runs x
            where x.source_snapshot_id = s.current_snapshot_id and x.status = 'failed'
          ) then 'failed'
          when exists (
            select 1 from private.extraction_runs x
            where x.source_snapshot_id = s.current_snapshot_id
              and x.run_type = 'fact_extract' and x.status = 'completed'
          ) then 'done'
          else 'reading'
        end,
        'candidateCount', (
          select count(*)::integer
          from private.fact_candidates c
          join private.extraction_runs x on x.id = c.extraction_run_id
          where x.source_snapshot_id = s.current_snapshot_id
        ),
        'createdAt', s.created_at
      ) order by s.created_at, s.title)
      from public.sources s
      where s.edition_id = p_edition_id and s.source_type <> 'gpx'
    ), '[]'::jsonb),
    'pendingByCategory', coalesce((
      select jsonb_agg(jsonb_build_object('category', t.category, 'count', t.n) order by t.n desc)
      from (
        select c.category, count(*)::integer as n
        from private.fact_candidates c
        join public.races r on r.id = c.race_id
        where r.edition_id = p_edition_id
          and c.status in ('detected', 'needs_review', 'conflict')
        group by c.category
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

-- ============================================================
-- 06. Bucket : les PDF déposés
-- ============================================================
-- 0008 n'autorisait que le GPX. Le PDF s'ajoute, rien d'autre : le bucket
-- reste privé (03_PRIVACY_RLS §84), et la limite de taille ne change pas.

update storage.buckets
set allowed_mime_types = array(
  select distinct unnest(coalesce(allowed_mime_types, '{}'::text[]) || array['application/pdf'])
)
where id = 'race-sources';

/*
 * Édition désignée par le chemin d'un objet : `editions/<edition_id>/documents/<fichier>`.
 * Même principe que `race_of_source_object` (0023) : le chemin est une donnée
 * d'autorisation, et un chemin qui ne désigne aucune édition existante n'est
 * écrivable par personne.
 */
create or replace function private.edition_of_source_object(p_name text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_folders text[];
  v_edition_id uuid;
begin
  v_folders := storage.foldername(p_name);

  if array_length(v_folders, 1) is distinct from 3 then return null; end if;
  if v_folders[1] <> 'editions' or v_folders[3] <> 'documents' then return null; end if;

  begin
    v_edition_id := v_folders[2]::uuid;
  exception when others then
    return null;
  end;

  return (select ed.id from public.editions ed where ed.id = v_edition_id);
end;
$$;

-- Dépôt par l'administration PLUKA seulement dans ce lot : l'espace
-- organisateur n'a pas encore d'écran de documents.
create policy race_sources__insert__edition_document
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'race-sources'
    and private.edition_of_source_object(name) is not null
    and private.is_pluka_admin()
  );

create policy race_sources__update__edition_document
  on storage.objects
  for update to authenticated
  using (
    bucket_id = 'race-sources'
    and private.edition_of_source_object(name) is not null
    and private.is_pluka_admin()
  )
  with check (
    bucket_id = 'race-sources'
    and private.edition_of_source_object(name) is not null
    and private.is_pluka_admin()
  );

-- Relecture nécessaire au dépôt lui-même (voir 0024).
create policy race_sources__select__edition_document
  on storage.objects
  for select to authenticated
  using (
    bucket_id = 'race-sources'
    and private.edition_of_source_object(name) is not null
    and private.is_pluka_admin()
  );

-- ============================================================
-- Droits
-- ============================================================

revoke all on function public.admin_start_event_discovery(text) from public, anon;
revoke all on function public.admin_get_event_discovery(uuid) from public, anon;
revoke all on function public.admin_create_event_from_discovery(uuid, jsonb) from public, anon;
revoke all on function public.admin_add_edition_documents(uuid, jsonb) from public, anon;
revoke all on function public.admin_add_edition_file(uuid, text, text, char, bigint, uuid) from public, anon;
revoke all on function public.admin_list_edition_documents(uuid) from public, anon;

grant execute on function public.admin_start_event_discovery(text) to authenticated;
grant execute on function public.admin_get_event_discovery(uuid) to authenticated;
grant execute on function public.admin_create_event_from_discovery(uuid, jsonb) to authenticated;
grant execute on function public.admin_add_edition_documents(uuid, jsonb) to authenticated;
grant execute on function public.admin_add_edition_file(uuid, text, text, char, bigint, uuid) to authenticated;
grant execute on function public.admin_list_edition_documents(uuid) to authenticated;

do $do$
declare
  f text;
  signatures text[] := array[
    'public.worker_begin_event_discovery(uuid)',
    'public.worker_complete_event_discovery(uuid, text, jsonb, smallint, boolean, text, text)',
    'public.worker_fail_event_discovery(uuid, text)'
  ];
begin
  foreach f in array signatures loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$do$;

revoke all on all functions in schema private from anon, authenticated;
revoke all on private.event_discoveries from anon, authenticated;

commit;
