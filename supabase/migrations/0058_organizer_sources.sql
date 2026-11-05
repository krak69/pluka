-- PLUKA V1 — Ma course : l'organisation fournit ses documents
-- File target: supabase/migrations/0058_organizer_sources.sql
-- Référence : docs/00_PRODUCT_SPEC.md §28.2 · docs/03_PRIVACY_RLS.md §84
--
-- POURQUOI
--
-- 0040 réservait le dépôt à l'administration PLUKA, « l'espace organisateur n'a
-- pas encore d'écran de documents ». Il en a un. Un éditeur de l'organisation
-- fournit donc les documents de son édition ; un membre consulte leur état.
--
-- Rien d'autre ne s'ouvre : `enqueue_source_ingest` acceptait déjà un éditeur,
-- le worker lit toute adresse sous sa garde SSRF, le bucket reste privé, et une
-- information extraite attend toujours une décision humaine (AGENTS §13).
--
-- Les fonctions changent de nom : `admin_` ne décrirait plus qui les appelle.

begin;

drop function public.admin_add_edition_documents(uuid, jsonb);
drop function public.admin_add_edition_file(uuid, text, text, character, bigint, uuid);
drop function public.admin_list_edition_documents(uuid);

create function public.add_edition_documents(p_edition_id uuid, p_documents jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_document jsonb;
  v_url text;
  v_type public.source_type;
  v_race_id uuid;
  v_created integer := 0;
begin
  if not (private.user_can_manage_edition(p_edition_id, 'editor') or private.is_pluka_admin()) then
    raise exception 'action non autorisée sur cette édition' using errcode = '42501';
  end if;

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

create function public.add_edition_file(p_edition_id uuid, p_title text, p_storage_path text, p_content_hash character, p_size_bytes bigint, p_race_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_source_id uuid;
  v_organization_id uuid;
begin
  if not (private.user_can_manage_edition(p_edition_id, 'editor') or private.is_pluka_admin()) then
    raise exception 'action non autorisée sur cette édition' using errcode = '42501';
  end if;

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

create function public.list_edition_documents(p_edition_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
begin
  if not (private.user_can_manage_edition(p_edition_id, 'viewer') or private.is_pluka_admin()) then
    raise exception 'documents réservés à l''organisation de la course' using errcode = '42501';
  end if;

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

revoke all on function public.add_edition_documents(uuid, jsonb) from public, anon;
revoke all on function public.add_edition_file(uuid, text, text, character, bigint, uuid) from public, anon;
revoke all on function public.list_edition_documents(uuid) from public, anon;
grant execute on function public.add_edition_documents(uuid, jsonb) to authenticated;
grant execute on function public.add_edition_file(uuid, text, text, character, bigint, uuid) to authenticated;
grant execute on function public.list_edition_documents(uuid) to authenticated;

create or replace function private.can_upload_edition_document(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_edition_id uuid := private.edition_of_source_object(p_name);
begin
  return v_edition_id is not null
    and (private.user_can_manage_edition(v_edition_id, 'editor') or private.is_pluka_admin());
end;
$$;

revoke all on function private.can_upload_edition_document(text) from public, anon;
grant execute on function private.can_upload_edition_document(text) to authenticated;

drop policy race_sources__insert__edition_document on storage.objects;
drop policy race_sources__update__edition_document on storage.objects;
drop policy race_sources__select__edition_document on storage.objects;

create policy race_sources__insert__edition_document
  on storage.objects
  for insert to authenticated
  with check (bucket_id = 'race-sources' and private.can_upload_edition_document(name));

create policy race_sources__update__edition_document
  on storage.objects
  for update to authenticated
  using (bucket_id = 'race-sources' and private.can_upload_edition_document(name))
  with check (bucket_id = 'race-sources' and private.can_upload_edition_document(name));

-- Relecture nécessaire au dépôt lui-même (voir 0024).
create policy race_sources__select__edition_document
  on storage.objects
  for select to authenticated
  using (bucket_id = 'race-sources' and private.can_upload_edition_document(name));

commit;
