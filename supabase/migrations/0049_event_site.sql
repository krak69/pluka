-- PLUKA V1 — Le site de l'événement
-- File target: supabase/migrations/0049_event_site.sql
-- Référence : docs/features/EVENT_SITE.md · 03_PRIVACY_RLS §15–17, §83–84 · 04_ENTITLEMENTS §62 · AGENTS §64, §66, §79
--
-- DÉCISIONS PRODUIT DU 2026-10-16
--
-- Un site public par événement, sur `{eventSlug}.pluka.run`, édité par
-- l'organisation et construit sur ses données publiées. Cette migration pose
-- ce que le site lit et ce que l'éditeur écrit :
--
--   1. `event_sites` — l'identité (accent, police, logo, couverture), l'adresse
--      de contact et le statut. Owner, admin et editor éditent ; owner et admin
--      publient ; seul l'admin PLUKA suspend.
--   2. `event_site_sections` — les blocs de texte des infos pratiques, rattachés
--      à l'événement : ils restent d'une édition à l'autre. L'officiel
--      (dossards, transport, départ) vient des faits publiés, pas d'ici.
--   3. Les anciens slugs d'un événement, pour que l'ancien sous-domaine
--      redirige, et les sous-domaines réservés à PLUKA.
--   4. Le lien d'inscription, par édition et surchargeable par épreuve.
--   5. La diffusion publique d'un document, autorisée par owner ou admin.
--   6. La trace sans contenu des messages de contact, pour la limite de débit.
--
-- Le site lit une charge publique construite ici (AGENTS §79), jamais les
-- tables : l'adresse de contact n'en sort pas.

begin;

-- ============================================================
-- 01. Le droit d'organisation « site » (04_ENTITLEMENTS §62)
-- ============================================================

/*
 * Bêta (EVENT_SITE §8) : accordé à toute organisation active. C'est le seul
 * endroit où le paiement se branchera ; aucun appelant ne doit supposer que
 * la réponse est toujours vraie.
 */
create or replace function private.organization_has_capability(
  p_organization_id uuid,
  p_capability text
)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_capability = 'event_site'
    and exists (
      select 1 from public.organizations o
      where o.id = p_organization_id
        and o.status = 'active'
        and o.deleted_at is null
    );
$$;

comment on function private.organization_has_capability(uuid, text) is
  'Droit d''organisation, distinct des tiers coureur (04_ENTITLEMENTS §62). Bêta du site : toute organisation active.';

-- ============================================================
-- 02. Sous-domaines réservés et anciens slugs (EVENT_SITE §7.1)
-- ============================================================

create or replace function private.is_reserved_subdomain(p_slug text)
returns boolean language sql immutable set search_path = '' as $$
  select lower(p_slug) = any (array[
    'app', 'www', 'admin', 'api', 'auth', 'mail', 'email', 'smtp', 'imap', 'pop', 'ftp',
    'status', 'static', 'cdn', 'assets', 'media', 'img', 'storage', 'files', 'docs', 'help',
    'support', 'blog', 'news', 'm', 'mobile', 'dev', 'staging', 'preview', 'beta', 'demo',
    'sandbox', 'pluka', 'site', 'sites', 'org', 'orga', 'organisateurs', 'organizers',
    'studio', 'dashboard', 'console', 'account', 'login', 'connexion', 'billing', 'pay',
    'ns1', 'ns2', 'mx', 'autodiscover', 'webmail', 'supabase', 'vercel', 'brief'
  ]);
$$;

comment on function private.is_reserved_subdomain(text) is
  'Adresses techniques de PLUKA : aucune ne peut devenir le slug d''un événement, donc le sous-domaine d''un site.';

/* Une étiquette DNS : ce qu'un slug doit être pour servir de sous-domaine. */
create or replace function private.is_dns_label(p_slug text)
returns boolean language sql immutable set search_path = '' as $$
  select p_slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
    and substr(p_slug, 3, 2) <> '--';
$$;

create table private.event_slug_aliases (
  slug text primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  retired_at timestamptz not null default now()
);

create index event_slug_aliases_event_idx on private.event_slug_aliases (event_id);

comment on table private.event_slug_aliases is
  'Anciens slugs d''un événement. L''ancien sous-domaine redirige vers le nouveau ; un ancien slug reste à son événement.';

create or replace function private.guard_event_slug()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.slug = old.slug then
    return new;
  end if;

  if private.is_reserved_subdomain(new.slug) then
    raise exception 'RESERVED_SUBDOMAIN' using errcode = '22023',
      detail = format('« %s » est une adresse réservée à PLUKA.', new.slug);
  end if;

  if exists (
    select 1 from private.event_slug_aliases a
    where a.slug = new.slug and a.event_id <> new.id
  ) then
    raise exception 'SLUG_HELD_BY_ANOTHER_EVENT' using errcode = '23505',
      detail = 'Ce slug a été celui d''un autre événement : son ancienne adresse y redirige encore.';
  end if;

  if tg_op = 'UPDATE' then
    -- Reprendre un ancien nom le retire des alias ; quitter le nom courant
    -- l'y ajoute.
    delete from private.event_slug_aliases a where a.slug = new.slug and a.event_id = new.id;
    insert into private.event_slug_aliases (slug, event_id) values (old.slug, new.id)
    on conflict (slug) do update set retired_at = now();
  end if;

  return new;
end;
$$;

create trigger events_guard_slug
  before insert or update of slug on public.events
  for each row execute function private.guard_event_slug();

-- ============================================================
-- 03. Le site et ses blocs de texte
-- ============================================================

create type public.event_site_status as enum ('draft', 'published', 'suspended');

create table public.event_sites (
  event_id uuid primary key references public.events(id) on delete cascade,
  status public.event_site_status not null default 'draft',
  -- Nul : l'accent PLUKA. Le contraste AA se vérifie côté domaine, à l'entrée.
  accent_color text check (accent_color ~ '^#[0-9a-f]{6}$'),
  -- Nul : Archivo. Liste fermée, servie par PLUKA (EVENT_SITE §4.1).
  heading_font text check (heading_font in (
    'archivo', 'barlow-condensed', 'oswald', 'bebas-neue',
    'space-grotesk', 'montserrat', 'fraunces', 'playfair-display'
  )),
  -- Chemins dans le bucket `event-site-assets`, sous le dossier de l'événement.
  logo_path text check (char_length(logo_path) <= 512),
  cover_path text check (char_length(cover_path) <= 512),
  -- Destinataire du formulaire ; ne sort jamais dans la charge publique.
  contact_email extensions.citext check (
    char_length(contact_email) <= 254 and contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  published_at timestamptz,
  published_by_user_id uuid references public.users(id) on delete set null,
  suspended_at timestamptz,
  updated_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'published' or published_at is not null),
  check (status <> 'suspended' or suspended_at is not null)
);

comment on table public.event_sites is
  'Le site public d''un événement (EVENT_SITE). Écrit par RPC seulement ; lu en public par public.event_site_public.';

create table public.event_site_sections (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.event_sites(event_id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  -- Texte simple : rendu comme texte, jamais comme HTML (EVENT_SITE §7.2).
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  sort_order smallint not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  unique (event_id, sort_order)
);

comment on table public.event_site_sections is
  'Infos pratiques écrites par l''organisation, rattachées à l''événement. Ne remplacent jamais un fait publié.';

create trigger trg_event_sites_updated_at before update on public.event_sites
  for each row execute function private.set_updated_at();

alter table public.event_sites enable row level security;
alter table public.event_site_sections enable row level security;

-- Lecture : membres de l'organisation et admin PLUKA. Aucune écriture
-- directe : tout passe par les RPC de §06, qui vérifient le rôle du geste.
create policy event_sites__select__org_member on public.event_sites
  for select to authenticated
  using (private.user_is_org_member(private.organization_of_event(event_id)));

create policy event_sites__select__pluka_admin on public.event_sites
  for select to authenticated using (private.is_pluka_admin());

create policy event_site_sections__select__org_member on public.event_site_sections
  for select to authenticated
  using (private.user_is_org_member(private.organization_of_event(event_id)));

create policy event_site_sections__select__pluka_admin on public.event_site_sections
  for select to authenticated using (private.is_pluka_admin());

-- ============================================================
-- 04. Inscription externe et diffusion des documents
-- ============================================================

alter table public.editions
  add column registration_url text
    check (char_length(registration_url) <= 2048 and registration_url ~ '^https://[^[:space:]]+$');

alter table public.races
  add column registration_url text
    check (char_length(registration_url) <= 2048 and registration_url ~ '^https://[^[:space:]]+$');

comment on column public.editions.registration_url is
  'Plateforme d''inscription externe de l''édition. PLUKA n''est pas une plateforme d''inscription.';
comment on column public.races.registration_url is
  'Lien d''inscription propre à l''épreuve ; prime sur celui de l''édition.';

alter table public.sources
  add column public_download_at timestamptz,
  add column public_download_by_user_id uuid references public.users(id) on delete set null;

comment on column public.sources.public_download_at is
  'Diffusion publique autorisée sur le site, par owner ou admin (AGENTS §66). Nul : non diffusé.';

/*
 * Rendre un document téléchargeable par tous est un acte de publication :
 * owner, admin de l'organisation ou admin PLUKA. La RLS laisse l'éditeur
 * modifier une source ; ce trigger garde ces deux colonnes. Sans session
 * (worker, reprise), `auth.uid()` est nul et l'appelant répond de lui-même.
 */
create or replace function private.guard_source_public_download()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.public_download_at is null and new.public_download_by_user_id is null then
      return new;
    end if;
  elsif new.public_download_at is not distinct from old.public_download_at
    and new.public_download_by_user_id is not distinct from old.public_download_by_user_id then
    return new;
  end if;

  if not (private.user_can_manage_edition(new.edition_id, 'admin') or private.is_pluka_admin()) then
    raise exception 'diffusion publique réservée à l''owner ou l''admin' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger sources_guard_public_download
  before insert or update of public_download_at, public_download_by_user_id on public.sources
  for each row execute function private.guard_source_public_download();

-- ============================================================
-- 05. Visibilité publique (EVENT_SITE §7.3)
-- ============================================================

create or replace function private.event_site_is_public(p_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.event_sites s
    join public.events e on e.id = s.event_id
    join public.organizations o on o.id = e.organization_id
    where s.event_id = p_event_id
      and s.status = 'published'
      and e.status = 'published'
      and private.organization_has_capability(o.id, 'event_site')
  );
$$;

comment on function private.event_site_is_public(uuid) is
  'En ligne si et seulement si : site publié, événement publié, organisation active qui a le droit « site ».';

-- ============================================================
-- 06. Gestes de l'organisation
-- ============================================================

create or replace function private.assert_can_edit_event_site(p_event_id uuid, p_min_role public.organization_member_role)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_organization_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'geste refusé : aucun acte humain' using errcode = '42501';
  end if;

  if not exists (select 1 from public.events e where e.id = p_event_id) then
    raise exception 'événement introuvable' using errcode = 'P0002';
  end if;

  if not (private.user_can_manage_event(p_event_id, p_min_role) or private.is_pluka_admin()) then
    raise exception 'action non autorisée sur ce site' using errcode = '42501';
  end if;

  v_organization_id := private.organization_of_event(p_event_id);
  if v_organization_id is null then
    -- Un site est une offre d'organisation : un événement géré par PLUKA seul
    -- n'en a pas.
    raise exception 'EVENT_WITHOUT_ORGANIZATION' using errcode = '22023';
  end if;

  return v_organization_id;
end;
$$;

/*
 * Identité, adresse de contact et blocs de texte, enregistrés d'un coup.
 * `p_sections` : tableau de `{title, body}`, dans l'ordre d'affichage ; il
 * remplace les blocs existants. Owner, admin, editor ou admin PLUKA.
 */
create or replace function public.save_event_site(
  p_event_id uuid,
  p_accent_color text,
  p_heading_font text,
  p_contact_email text,
  p_sections jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := private.assert_can_edit_event_site(p_event_id, 'editor');
  v_section jsonb;
begin
  if jsonb_typeof(p_sections) is distinct from 'array' then
    raise exception 'blocs de texte attendus en tableau' using errcode = '22023';
  end if;

  if jsonb_array_length(p_sections) > 20 then
    raise exception 'TOO_MANY_SECTIONS' using errcode = '22023';
  end if;

  for v_section in select * from jsonb_array_elements(p_sections) loop
    if jsonb_typeof(v_section -> 'title') is distinct from 'string'
      or jsonb_typeof(v_section -> 'body') is distinct from 'string' then
      raise exception 'bloc de texte invalide' using errcode = '22023';
    end if;
  end loop;

  insert into public.event_sites (event_id, accent_color, heading_font, contact_email, updated_by_user_id)
  values (p_event_id, lower(nullif(btrim(p_accent_color), '')), nullif(p_heading_font, ''),
          nullif(btrim(p_contact_email), ''), (select auth.uid()))
  on conflict (event_id) do update set
    accent_color = excluded.accent_color,
    heading_font = excluded.heading_font,
    contact_email = excluded.contact_email,
    updated_by_user_id = excluded.updated_by_user_id;

  delete from public.event_site_sections s where s.event_id = p_event_id;

  insert into public.event_site_sections (event_id, title, body, sort_order)
  select p_event_id, btrim(item ->> 'title'), btrim(item ->> 'body'), (ordinality - 1)::smallint
  from jsonb_array_elements(p_sections) with ordinality as t(item, ordinality);

  insert into private.audit_logs (actor_user_id, organization_id, action, entity_table, entity_id, after_data)
  values ((select auth.uid()), v_organization_id, 'event_site.save', 'event_sites', p_event_id,
          jsonb_build_object('sections', jsonb_array_length(p_sections),
                             'accentColor', p_accent_color, 'headingFont', p_heading_font));
end;
$$;

/*
 * Le logo ou la couverture, après dépôt du fichier par le serveur dans
 * `event-site-assets`. Le chemin reste sous le dossier de l'événement : un
 * site ne peut pas pointer l'image d'un autre. Nul retire l'image.
 */
create or replace function public.set_event_site_image(
  p_event_id uuid,
  p_kind text,
  p_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := private.assert_can_edit_event_site(p_event_id, 'editor');
begin
  if p_kind not in ('logo', 'cover') then
    raise exception 'image inconnue' using errcode = '22023';
  end if;

  if p_path is not null and (
    p_path not like p_event_id::text || '/%'
    or p_path ~ '\.\.'
    or lower(p_path) !~ '\.(png|jpe?g|webp)$'
  ) then
    raise exception 'INVALID_ASSET_PATH' using errcode = '22023';
  end if;

  insert into public.event_sites (event_id, updated_by_user_id)
  values (p_event_id, (select auth.uid()))
  on conflict (event_id) do nothing;

  update public.event_sites s set
    logo_path = case when p_kind = 'logo' then p_path else s.logo_path end,
    cover_path = case when p_kind = 'cover' then p_path else s.cover_path end,
    updated_by_user_id = (select auth.uid())
  where s.event_id = p_event_id;

  insert into private.audit_logs (actor_user_id, organization_id, action, entity_table, entity_id, after_data)
  values ((select auth.uid()), v_organization_id, 'event_site.image', 'event_sites', p_event_id,
          jsonb_build_object('kind', p_kind, 'path', p_path));
end;
$$;

/*
 * Mettre en ligne (`published`) ou retirer (`draft`) : owner, admin ou admin
 * PLUKA. Suspendre, et sortir d'une suspension : admin PLUKA seul.
 */
create or replace function public.set_event_site_status(
  p_event_id uuid,
  p_status public.event_site_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := private.assert_can_edit_event_site(p_event_id, 'admin');
  v_site public.event_sites;
  v_slug text;
begin
  select * into v_site from public.event_sites s where s.event_id = p_event_id for update;
  if not found then
    raise exception 'SITE_NOT_CREATED' using errcode = 'P0002';
  end if;

  if (p_status = 'suspended' or v_site.status = 'suspended') and not private.is_pluka_admin() then
    raise exception 'suspension réservée à l''admin PLUKA' using errcode = '42501';
  end if;

  if v_site.status = p_status then
    raise exception 'aucune modification' using errcode = '55000';
  end if;

  if p_status = 'published' then
    if not private.organization_has_capability(v_organization_id, 'event_site') then
      raise exception 'CAPABILITY_REQUIRED' using errcode = '42501';
    end if;

    select e.slug into v_slug from public.events e where e.id = p_event_id;
    if not private.is_dns_label(v_slug) or private.is_reserved_subdomain(v_slug) then
      raise exception 'SITE_SLUG_NOT_A_SUBDOMAIN' using errcode = '22023';
    end if;
  end if;

  update public.event_sites s set
    status = p_status,
    published_at = case when p_status = 'published' then now() else s.published_at end,
    published_by_user_id = case when p_status = 'published' then (select auth.uid()) else s.published_by_user_id end,
    suspended_at = case when p_status = 'suspended' then now() else null end,
    updated_by_user_id = (select auth.uid())
  where s.event_id = p_event_id;

  insert into private.audit_logs (actor_user_id, organization_id, action, entity_table, entity_id, before_data, after_data)
  values ((select auth.uid()), v_organization_id, 'event_site.status', 'event_sites', p_event_id,
          jsonb_build_object('status', v_site.status), jsonb_build_object('status', p_status));
end;
$$;

/* Autoriser ou retirer la diffusion publique d'un document : owner, admin ou admin PLUKA. */
create or replace function public.set_source_public_download(
  p_source_id uuid,
  p_public boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.sources;
  v_organization_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'geste refusé : aucun acte humain' using errcode = '42501';
  end if;

  select * into v_source from public.sources s where s.id = p_source_id for update;
  if not found then
    raise exception 'document introuvable' using errcode = 'P0002';
  end if;

  if not (private.user_can_manage_edition(v_source.edition_id, 'admin') or private.is_pluka_admin()) then
    raise exception 'diffusion publique réservée à l''owner ou l''admin' using errcode = '42501';
  end if;

  if (v_source.public_download_at is not null) = p_public then
    raise exception 'aucune modification' using errcode = '55000';
  end if;

  update public.sources s set
    public_download_at = case when p_public then now() else null end,
    public_download_by_user_id = case when p_public then (select auth.uid()) else null end
  where s.id = p_source_id;

  v_organization_id := private.organization_of_edition(v_source.edition_id);
  insert into private.audit_logs (actor_user_id, organization_id, action, entity_table, entity_id, after_data)
  values ((select auth.uid()), v_organization_id, 'source.public_download', 'sources', p_source_id,
          jsonb_build_object('public', p_public));
end;
$$;

-- ============================================================
-- 07. La charge publique du site (AGENTS §79)
-- ============================================================

/*
 * Ce que lit le site pour un sous-domaine. Rend :
 *   - nul si rien n'est en ligne à cette adresse — la 404 ne dit pas pourquoi ;
 *   - `{redirectTo}` pour un ancien slug d'un site en ligne ;
 *   - sinon l'événement, l'identité, l'édition affichée et ce qui s'y montre.
 *
 * L'édition affichée : la prochaine à venir ; à défaut, la dernière. Seules
 * les épreuves publiquement lisibles y figurent (§17) ; l'adresse de contact
 * n'y figure jamais, seulement le fait qu'elle existe.
 */
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
    'hasContact', v_site.contact_email is not null,
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object('title', s.title, 'body', s.body) order by s.sort_order)
      from public.event_site_sections s where s.event_id = v_event.id
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

comment on function public.event_site_public(text) is
  'Charge publique d''un site d''événement (EVENT_SITE §3, §7). Nul si rien n''est en ligne ; jamais l''adresse de contact.';

/*
 * Le fichier d'un document diffusé, pour le point d'accès serveur qui signe
 * l'URL (03_PRIVACY_RLS §84). Nul si le document n'est pas diffusé, ou si son
 * site n'est pas en ligne. Réservé au serveur.
 */
create or replace function public.event_site_document_path(p_source_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select so.storage_path
  from public.sources so
  join public.editions ed on ed.id = so.edition_id
  where so.id = p_source_id
    and so.public_download_at is not null
    and so.status <> 'archived'
    and so.storage_path is not null
    and ed.status in ('published', 'completed')
    and private.event_site_is_public(ed.event_id);
$$;

-- ============================================================
-- 08. Formulaire de contact : une trace sans contenu (EVENT_SITE §6)
-- ============================================================

create table private.event_site_contact_attempts (
  id bigserial primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  -- Empreinte d'IP salée par le serveur, sel tournant : jamais l'IP.
  ip_hash text not null check (char_length(ip_hash) between 16 and 128),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  created_at timestamptz not null default now()
);

create index event_site_contact_attempts_event_idx
  on private.event_site_contact_attempts (event_id, created_at);
create index event_site_contact_attempts_ip_idx
  on private.event_site_contact_attempts (ip_hash, created_at);

comment on table private.event_site_contact_attempts is
  'Trace des envois du formulaire de contact : ni nom, ni adresse, ni message (EVENT_SITE §6.2).';

/*
 * Réserve un envoi si la limite de débit le permet, et rend ce qu'il faut
 * pour l'envoyer : l'identifiant de la trace, le destinataire, le nom de
 * l'événement. Nul si la limite est atteinte. Les seuils viennent de la
 * configuration du serveur. Réservé au serveur (service_role).
 */
create or replace function public.claim_event_site_contact(
  p_event_id uuid,
  p_ip_hash text,
  p_window interval,
  p_max_per_ip integer,
  p_max_per_event integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_to text;
  v_name text;
  v_attempt_id bigint;
begin
  if not private.event_site_is_public(p_event_id) then
    raise exception 'site introuvable' using errcode = 'P0002';
  end if;

  select s.contact_email::text, e.name into v_to, v_name
  from public.event_sites s join public.events e on e.id = s.event_id
  where s.event_id = p_event_id;

  if v_to is null then
    raise exception 'SITE_WITHOUT_CONTACT' using errcode = 'P0002';
  end if;

  -- Deux envois simultanés ne passent pas tous deux sous la limite.
  perform pg_advisory_xact_lock(hashtextextended('event_site_contact:' || p_event_id::text, 0));

  if (select count(*) from private.event_site_contact_attempts a
      where a.ip_hash = p_ip_hash and a.created_at > now() - p_window) >= p_max_per_ip
    or (select count(*) from private.event_site_contact_attempts a
        where a.event_id = p_event_id and a.created_at > now() - p_window) >= p_max_per_event then
    return null;
  end if;

  insert into private.event_site_contact_attempts (event_id, ip_hash)
  values (p_event_id, p_ip_hash)
  returning id into v_attempt_id;

  return jsonb_build_object('attemptId', v_attempt_id, 'to', v_to, 'eventName', v_name);
end;
$$;

create or replace function public.finish_event_site_contact(p_attempt_id bigint, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'statut inconnu' using errcode = '22023';
  end if;

  update private.event_site_contact_attempts a set status = p_status
  where a.id = p_attempt_id and a.status = 'pending';
end;
$$;

-- La trace ne sert qu'à la limite de débit : elle ne se garde pas au-delà.
create or replace function public.purge_event_site_contact_attempts(p_older_than interval)
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from private.event_site_contact_attempts a
    where a.created_at < now() - p_older_than
    returning 1
  )
  select count(*)::integer from gone;
$$;

-- ============================================================
-- 09. Stockage des images du site (03_PRIVACY_RLS §83)
-- ============================================================

-- Lecture publique, comme `public-assets`. Pas de SVG : un SVG peut porter du
-- script, et les sites partagent le site navigateur de l'app (EVENT_SITE §7.2).
-- Aucune policy storage : seul le serveur dépose, sous clé de service.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-site-assets', 'event-site-assets', true, 5242880,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- ============================================================
-- 10. Droits d'exécution
-- ============================================================

revoke all on function private.organization_has_capability(uuid, text) from public, anon, authenticated;
revoke all on function private.is_reserved_subdomain(text) from public, anon, authenticated;
revoke all on function private.is_dns_label(text) from public, anon, authenticated;
revoke all on function private.guard_event_slug() from public, anon, authenticated;
revoke all on function private.guard_source_public_download() from public, anon, authenticated;
revoke all on function private.event_site_is_public(uuid) from public, anon, authenticated;
revoke all on function private.assert_can_edit_event_site(uuid, public.organization_member_role)
  from public, anon, authenticated;

revoke all on function public.save_event_site(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.set_event_site_image(uuid, text, text) from public, anon, authenticated;
revoke all on function public.set_event_site_status(uuid, public.event_site_status) from public, anon, authenticated;
revoke all on function public.set_source_public_download(uuid, boolean) from public, anon, authenticated;
grant execute on function public.save_event_site(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.set_event_site_image(uuid, text, text) to authenticated;
grant execute on function public.set_event_site_status(uuid, public.event_site_status) to authenticated;
grant execute on function public.set_source_public_download(uuid, boolean) to authenticated;

revoke all on function public.event_site_public(text) from public, anon, authenticated;
grant execute on function public.event_site_public(text) to anon, authenticated;

revoke all on function public.event_site_document_path(uuid) from public, anon, authenticated;
revoke all on function public.claim_event_site_contact(uuid, text, interval, integer, integer)
  from public, anon, authenticated;
revoke all on function public.finish_event_site_contact(bigint, text) from public, anon, authenticated;
revoke all on function public.purge_event_site_contact_attempts(interval) from public, anon, authenticated;
grant execute on function public.event_site_document_path(uuid) to service_role;
grant execute on function public.claim_event_site_contact(uuid, text, interval, integer, integer) to service_role;
grant execute on function public.finish_event_site_contact(bigint, text) to service_role;
grant execute on function public.purge_event_site_contact_attempts(interval) to service_role;

commit;
