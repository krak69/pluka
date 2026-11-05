-- PLUKA V1 — Le site de l'événement : la galerie et la vidéo
-- File target: supabase/migrations/0056_event_site_gallery.sql
-- Référence : docs/features/EVENT_SITE.md §3.10
--
-- POURQUOI
--
-- Douze photos au plus, déposées dans `event-site-assets` comme le logo, sous la
-- session de l'éditeur (0051). Une vidéo YouTube ou Vimeo est gardée sous forme
-- d'un fournisseur et d'un identifiant, jamais d'un code d'intégration : c'est
-- PLUKA qui construit l'adresse du lecteur.

begin;

alter table public.event_sites
  add column video_provider text check (video_provider in ('youtube', 'vimeo')),
  add column video_id text check (video_id ~ '^[A-Za-z0-9_-]{1,32}$'),
  add check ((video_provider is null) = (video_id is null));

create table public.event_site_gallery (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.event_sites(event_id) on delete cascade,
  path text not null check (char_length(path) <= 512),
  alt text check (char_length(alt) <= 200),
  sort_order smallint not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  unique (event_id, sort_order)
);

comment on table public.event_site_gallery is
  'Les photos d''un site, dans le bucket public `event-site-assets` (EVENT_SITE §3.10).';

alter table public.event_site_gallery enable row level security;

-- Comme le reste du site : lecture par les membres et l'admin PLUKA, aucune
-- écriture directe.
create policy event_site_gallery__select__org_member on public.event_site_gallery
  for select to authenticated
  using (private.user_is_org_member(private.organization_of_event(event_id)));

create policy event_site_gallery__select__pluka_admin on public.event_site_gallery
  for select to authenticated using (private.is_pluka_admin());

create function public.add_event_site_gallery_photo(
  p_event_id uuid,
  p_path text,
  p_alt text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := private.assert_can_edit_event_site(p_event_id, 'editor');
  v_count integer;
  v_next smallint;
begin
  if p_path not like p_event_id::text || '/%'
    or p_path ~ '\.\.'
    or lower(p_path) !~ '\.(png|jpe?g|webp)$' then
    raise exception 'INVALID_ASSET_PATH' using errcode = '22023';
  end if;

  insert into public.event_sites (event_id, updated_by_user_id)
  values (p_event_id, (select auth.uid()))
  on conflict (event_id) do nothing;

  -- Deux dépôts simultanés ne doivent pas franchir ensemble la limite.
  perform 1 from public.event_sites s where s.event_id = p_event_id for update;

  select count(*), coalesce(max(g.sort_order) + 1, 0)
  into v_count, v_next
  from public.event_site_gallery g
  where g.event_id = p_event_id;

  if v_count >= 12 then
    raise exception 'TOO_MANY_PHOTOS' using errcode = '22023';
  end if;

  insert into public.event_site_gallery (event_id, path, alt, sort_order)
  values (p_event_id, p_path, nullif(btrim(p_alt), ''), v_next);

  insert into private.audit_logs (actor_user_id, organization_id, action, entity_table, entity_id, after_data)
  values ((select auth.uid()), v_organization_id, 'event_site.gallery_add', 'event_sites', p_event_id,
          jsonb_build_object('path', p_path));
end;
$$;

create function public.remove_event_site_gallery_photo(p_photo_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_photo public.event_site_gallery;
  v_organization_id uuid;
begin
  select * into v_photo from public.event_site_gallery g where g.id = p_photo_id for update;
  if not found then
    raise exception 'photo introuvable' using errcode = 'P0002';
  end if;

  v_organization_id := private.assert_can_edit_event_site(v_photo.event_id, 'editor');

  delete from public.event_site_gallery g where g.id = p_photo_id;

  insert into private.audit_logs (actor_user_id, organization_id, action, entity_table, entity_id, after_data)
  values ((select auth.uid()), v_organization_id, 'event_site.gallery_remove', 'event_sites', v_photo.event_id,
          jsonb_build_object('path', v_photo.path));
end;
$$;

revoke all on function public.add_event_site_gallery_photo(uuid, text, text) from public, anon, authenticated;
revoke all on function public.remove_event_site_gallery_photo(uuid) from public, anon, authenticated;
grant execute on function public.add_event_site_gallery_photo(uuid, text, text) to authenticated;
grant execute on function public.remove_event_site_gallery_photo(uuid) to authenticated;

create or replace function public.save_event_site(
  p_event_id uuid,
  p_accent_color text,
  p_heading_font text,
  p_contact_email text,
  p_sections jsonb,
  p_edition_id uuid default null,
  p_edition_registration_url text default null,
  p_race_registration_urls jsonb default null,
  p_content jsonb default null,
  p_program jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := private.assert_can_edit_event_site(p_event_id, 'editor');
  v_section jsonb;
  v_item jsonb;
  v_race_id uuid;
  v_timezone text;
begin
  if jsonb_typeof(p_sections) is distinct from 'array' then
    raise exception 'blocs de texte attendus en tableau' using errcode = '22023';
  end if;

  if jsonb_array_length(p_sections) > 20 then
    raise exception 'TOO_MANY_SECTIONS' using errcode = '22023';
  end if;

  if p_content is not null then
    if jsonb_typeof(p_content) is distinct from 'object'
      or jsonb_typeof(p_content -> 'figures') is distinct from 'array'
      or jsonb_typeof(p_content -> 'links') is distinct from 'object' then
      raise exception 'contenu du site invalide' using errcode = '22023';
    end if;

    if jsonb_array_length(p_content -> 'figures') > 4 then
      raise exception 'TOO_MANY_FIGURES' using errcode = '22023';
    end if;
  end if;

  for v_section in select * from jsonb_array_elements(p_sections) loop
    if jsonb_typeof(v_section -> 'title') is distinct from 'string'
      or jsonb_typeof(v_section -> 'body') is distinct from 'string' then
      raise exception 'bloc de texte invalide' using errcode = '22023';
    end if;
  end loop;

  if p_program is not null then
    if p_edition_id is null or jsonb_typeof(p_program) is distinct from 'array' then
      raise exception 'programme invalide' using errcode = '22023';
    end if;

    if jsonb_array_length(p_program) > 40 then
      raise exception 'TOO_MANY_PROGRAM_ITEMS' using errcode = '22023';
    end if;
  end if;

  if p_edition_id is not null then
    if not exists (
      select 1 from public.editions ed where ed.id = p_edition_id and ed.event_id = p_event_id
    ) then
      raise exception 'édition hors de l''événement' using errcode = '22023';
    end if;

    if p_race_registration_urls is not null then
      if jsonb_typeof(p_race_registration_urls) is distinct from 'array' then
        raise exception 'liens d''épreuve attendus en tableau' using errcode = '22023';
      end if;

      for v_item in select * from jsonb_array_elements(p_race_registration_urls) loop
        v_race_id := (v_item ->> 'raceId')::uuid;
        if not exists (
          select 1 from public.races r where r.id = v_race_id and r.edition_id = p_edition_id
        ) then
          raise exception 'épreuve hors de l''édition' using errcode = '22023';
        end if;
      end loop;
    end if;
  end if;

  insert into public.event_sites (event_id, accent_color, heading_font, contact_email, updated_by_user_id)
  values (p_event_id, lower(nullif(btrim(p_accent_color), '')), nullif(p_heading_font, ''),
          nullif(btrim(p_contact_email), ''), (select auth.uid()))
  on conflict (event_id) do update set
    accent_color = excluded.accent_color,
    heading_font = excluded.heading_font,
    contact_email = excluded.contact_email,
    updated_by_user_id = excluded.updated_by_user_id;

  delete from public.event_site_sections s where s.event_id = p_event_id;

  insert into public.event_site_sections (event_id, title, body, moment, topic_key, sort_order)
  select p_event_id, btrim(item ->> 'title'), btrim(item ->> 'body'),
         coalesce(item ->> 'moment', 'before')::public.event_site_moment,
         nullif(item ->> 'topicKey', ''), (ordinality - 1)::smallint
  from jsonb_array_elements(p_sections) with ordinality as t(item, ordinality);

  -- Sans contenu transmis, la présentation, les chiffres et les liens ne bougent pas.
  if p_content is not null then
    update public.event_sites s set
      presentation = nullif(btrim(p_content ->> 'presentation'), ''),
      venue = nullif(btrim(p_content ->> 'venue'), ''),
      results_url = nullif(btrim(p_content -> 'links' ->> 'results'), ''),
      live_url = nullif(btrim(p_content -> 'links' ->> 'live'), ''),
      volunteers_url = nullif(btrim(p_content -> 'links' ->> 'volunteers'), ''),
      newsletter_url = nullif(btrim(p_content -> 'links' ->> 'newsletter'), ''),
      facebook_url = nullif(btrim(p_content -> 'links' ->> 'facebook'), ''),
      instagram_url = nullif(btrim(p_content -> 'links' ->> 'instagram'), ''),
      strava_url = nullif(btrim(p_content -> 'links' ->> 'strava'), ''),
      video_provider = nullif(p_content ->> 'videoProvider', ''),
      video_id = nullif(p_content ->> 'videoId', '')
    where s.event_id = p_event_id;

    delete from public.event_site_figures f where f.event_id = p_event_id;

    insert into public.event_site_figures (event_id, value, label, sort_order)
    select p_event_id, btrim(item ->> 'value'), btrim(item ->> 'label'), (ordinality - 1)::smallint
    from jsonb_array_elements(p_content -> 'figures') with ordinality as t(item, ordinality);
  end if;

  if p_edition_id is not null then
    update public.editions ed
    set registration_url = nullif(btrim(p_edition_registration_url), '')
    where ed.id = p_edition_id
      and ed.registration_url is distinct from nullif(btrim(p_edition_registration_url), '');

    if p_race_registration_urls is not null then
      update public.races r
      set registration_url = nullif(btrim(item ->> 'url'), '')
      from jsonb_array_elements(p_race_registration_urls) as t(item)
      where r.id = (item ->> 'raceId')::uuid
        and r.registration_url is distinct from nullif(btrim(item ->> 'url'), '');
    end if;
  end if;

  if p_program is not null then
    -- Le fuseau des épreuves de l'édition ; sans épreuve, celui que `races` prend par défaut.
    select r.timezone into v_timezone
    from public.races r
    where r.edition_id = p_edition_id
    order by r.start_datetime
    limit 1;
    v_timezone := coalesce(v_timezone, 'Europe/Paris');

    delete from public.event_site_program_items p where p.edition_id = p_edition_id;

    insert into public.event_site_program_items (edition_id, starts_at, timezone, title, location)
    select p_edition_id,
           ((item ->> 'day')::date + (item ->> 'time')::time) at time zone v_timezone,
           v_timezone,
           btrim(item ->> 'title'),
           nullif(btrim(item ->> 'location'), '')
    from jsonb_array_elements(p_program) as t(item);
  end if;

  insert into private.audit_logs (actor_user_id, organization_id, action, entity_table, entity_id, after_data)
  values ((select auth.uid()), v_organization_id, 'event_site.save', 'event_sites', p_event_id,
          jsonb_build_object('sections', jsonb_array_length(p_sections),
                             'accentColor', p_accent_color, 'headingFont', p_heading_font,
                             'contentChanged', p_content is not null,
                             'programChanged', p_program is not null,
                             'editionId', p_edition_id,
                             'editionRegistrationUrl', p_edition_registration_url,
                             'raceRegistrationUrls', p_race_registration_urls));
end;
$$;

create or replace function public.event_site_public(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slug text := lower(btrim(p_slug));
  v_event public.events;
  v_site public.event_sites;
  v_alias_event_id uuid;
  v_edition public.editions;
  v_race_ids uuid[];
begin
  select * into v_event from public.events e where e.slug = v_slug;

  if not found then
    select a.event_id into v_alias_event_id from private.event_slug_aliases a where a.slug = v_slug;
    if v_alias_event_id is not null and private.event_site_is_public(v_alias_event_id) then
      return jsonb_build_object(
        'redirectTo', (select e.slug from public.events e where e.id = v_alias_event_id));
    end if;
    return null;
  end if;

  if not private.event_site_is_public(v_event.id) then
    return null;
  end if;

  select * into v_site from public.event_sites s where s.event_id = v_event.id;

  select * into v_edition
  from public.editions ed
  where ed.event_id = v_event.id and ed.status in ('published', 'completed')
  order by
    (coalesce(ed.end_date, ed.start_date) >= current_date) desc,
    case when coalesce(ed.end_date, ed.start_date) >= current_date then ed.start_date end asc,
    ed.start_date desc
  limit 1;

  select coalesce(array_agg(r.id), '{}') into v_race_ids
  from public.races r
  where v_edition.id is not null
    and r.edition_id = v_edition.id
    and private.race_is_publicly_readable(r.id);

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id,
      'name', v_event.name,
      'slug', v_event.slug,
      'description', v_event.description,
      'city', v_event.city,
      'countryCode', v_event.country_code
    ),
    'appearance', jsonb_build_object(
      'accentColor', v_site.accent_color,
      'headingFont', v_site.heading_font,
      'logoPath', v_site.logo_path,
      'coverPath', v_site.cover_path
    ),
    'presentation', v_site.presentation,
    'venue', v_site.venue,
    'links', jsonb_build_object(
      'results', v_site.results_url,
      'live', v_site.live_url,
      'volunteers', v_site.volunteers_url,
      'newsletter', v_site.newsletter_url,
      'facebook', v_site.facebook_url,
      'instagram', v_site.instagram_url,
      'strava', v_site.strava_url
    ),
    'figures', coalesce((
      select jsonb_agg(jsonb_build_object('value', f.value, 'label', f.label) order by f.sort_order)
      from public.event_site_figures f where f.event_id = v_event.id
    ), '[]'::jsonb),
    'hasContact', v_site.contact_email is not null,
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', s.title,
        'body', s.body,
        'moment', s.moment,
        'topicKey', s.topic_key
      ) order by s.sort_order)
      from public.event_site_sections s where s.event_id = v_event.id
    ), '[]'::jsonb),
    'gallery', coalesce((
      select jsonb_agg(jsonb_build_object('path', g.path, 'alt', g.alt) order by g.sort_order)
      from public.event_site_gallery g where g.event_id = v_event.id
    ), '[]'::jsonb),
    'video', case when v_site.video_id is null then null else jsonb_build_object(
      'provider', v_site.video_provider,
      'id', v_site.video_id
    ) end,
    'program', coalesce((
      select jsonb_agg(jsonb_build_object(
        'startsAt', p.starts_at,
        'timezone', p.timezone,
        'title', p.title,
        'location', p.location
      ) order by p.starts_at, p.title)
      from public.event_site_program_items p
      where v_edition.id is not null and p.edition_id = v_edition.id
    ), '[]'::jsonb),
    'edition', case when v_edition.id is null then null else jsonb_build_object(
      'id', v_edition.id,
      'year', v_edition.year,
      'slug', v_edition.slug,
      'startDate', v_edition.start_date,
      'endDate', v_edition.end_date,
      'status', v_edition.status,
      'registrationUrl', v_edition.registration_url
    ) end,
    'races', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'slug', r.slug,
        'name', r.name,
        'distanceKm', r.distance_km,
        'elevationGainM', r.elevation_gain_m,
        'startDatetime', r.start_datetime,
        'timezone', r.timezone,
        'startLocationName', r.start_location_name,
        'registrationUrl', r.registration_url
      ) order by r.start_datetime, r.name)
      from public.races r where r.id = any (v_race_ids)
    ), '[]'::jsonb),
    'notices', coalesce((
      select jsonb_agg(n.payload order by n.published_at desc)
      from (
        select rn.published_at, jsonb_build_object(
          'id', rn.id,
          'raceId', rn.race_id,
          'noticeType', rn.notice_type,
          'trustLevel', rn.trust_level,
          'severity', rn.severity,
          'title', rn.title,
          'body', rn.body,
          'publishedAt', rn.published_at
        ) as payload
        from public.race_notices rn
        where rn.race_id = any (v_race_ids)
          and rn.archived_at is null
          and (rn.effective_until is null or rn.effective_until > now())
        order by rn.published_at desc
        limit 20
      ) n
    ), '[]'::jsonb),
    'partners', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', p.name,
        'category', p.category,
        'logoUrl', p.logo_url,
        'websiteUrl', p.website_url
      ) order by p.sort_order, p.name)
      from public.event_partners p
      where v_edition.id is not null and p.edition_id = v_edition.id and p.is_active
    ), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', so.id,
        'title', so.title,
        'sourceType', so.source_type,
        'declaredPublishedAt', so.declared_published_at,
        'url', case when so.source_type = 'url' then so.url end,
        'hasFile', so.storage_path is not null
      ) order by so.declared_published_at desc nulls last, so.title)
      from public.sources so
      where v_edition.id is not null
        and so.edition_id = v_edition.id
        and so.public_download_at is not null
        and so.status <> 'archived'
    ), '[]'::jsonb)
  );
end;
$$;

commit;
