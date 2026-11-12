-- PLUKA V1 — Canal A : le lien de l'organisation, et l'ajout d'une course
-- File target: supabase/migrations/0087_referral_codes.sql
-- Référence : docs/00_PRODUCT_SPEC.md §6.5.4 · docs/04_ENTITLEMENTS.md §73, §73.1 · 05_ROUTES_FLOWS §1.7
--
-- POURQUOI
--
-- Canal A : l'organisation colle un lien PLUKA dans sa confirmation
-- d'inscription ; une vente qui en découle lui est attribuée (commission). Le
-- prix ne change pas. Décisions du 2026-11-12 :
--
--   - un code par édition, valable pour toutes ses épreuves ;
--   - créé automatiquement pour chaque édition : le canal A est proposé par
--     défaut à toutes les organisations ; PLUKA peut le désactiver ;
--   - le code suit le coureur dans l'adresse, jamais dans un cookie, puis se
--     pose sur sa participation quand il valide sa course. L'achat, plus tard,
--     le reportera sur le purchase (§73.1).
--
-- Un code inconnu, désactivé ou d'une autre édition est ignoré : la course
-- s'ajoute sans attribution, et l'anomalie est journalisée (§73.1).
--
-- L'ajout d'une course passe désormais par une fonction : la table n'a jamais
-- accordé l'écriture au coureur (0005), et l'insertion directe de l'app était
-- refusée. La fonction pose elle-même le coureur et l'attribution : un client
-- ne peut ni s'inscrire pour un autre, ni s'attribuer un code de son choix.

begin;

-- ============================================================
-- 1. Les codes
-- ============================================================

create table public.organization_referral_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  edition_id uuid not null unique references public.editions(id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z0-9]{4,24}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.organization_referral_codes is
  'Canal A (§6.5.4) : le code d''une édition, porté par le lien que l''organisation met dans sa confirmation d''inscription. Un par édition, créé avec elle. Lu et écrit par les fonctions de 0087 seulement.';

alter table public.organization_referral_codes enable row level security;
revoke all on table public.organization_referral_codes from anon, authenticated;

create trigger trg_organization_referral_codes_updated_at
  before update on public.organization_referral_codes
  for each row execute function private.set_updated_at();

-- Un code lisible, tiré de l'événement et de l'année : LES9CLOCHERS27. En cas
-- de collision, deux caractères de plus, sans 0/O ni 1/I pour la dictée.
create function private.make_referral_code(p_edition_id uuid)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_base text;
  v_code text;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  select left(upper(regexp_replace(ev.slug, '[^a-zA-Z0-9]', '', 'g')), 18)
         || right(ed.year::text, 2)
  into v_base
  from public.editions ed join public.events ev on ev.id = ed.event_id
  where ed.id = p_edition_id;

  v_base := coalesce(nullif(v_base, ''), 'PLUKA');
  if char_length(v_base) < 4 then
    v_base := rpad(v_base, 4, 'X');
  end if;
  v_code := v_base;

  while exists (select 1 from public.organization_referral_codes c where c.code = v_code) loop
    v_code := left(v_base, 20)
      || substr(v_alphabet, 1 + floor(random() * 32)::integer, 1)
      || substr(v_alphabet, 1 + floor(random() * 32)::integer, 1);
  end loop;

  return v_code;
end;
$$;

create function private.ensure_referral_code(p_edition_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_organization uuid;
begin
  select ev.organization_id into v_organization
  from public.editions ed join public.events ev on ev.id = ed.event_id
  where ed.id = p_edition_id;

  -- Une édition sans organisation (gérée par PLUKA) n'a personne à rémunérer.
  if v_organization is null then
    return;
  end if;

  insert into public.organization_referral_codes (organization_id, edition_id, code)
  values (v_organization, p_edition_id, private.make_referral_code(p_edition_id))
  on conflict (edition_id) do nothing;
end;
$$;

create function private.create_edition_referral_code()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.ensure_referral_code(new.id);
  return new;
end;
$$;

create trigger trg_editions_referral_code
  after insert on public.editions
  for each row execute function private.create_edition_referral_code();

-- Un événement rattaché plus tard à une organisation reçoit ses codes à ce moment.
create function private.create_event_referral_codes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_edition uuid;
begin
  if new.organization_id is not null and old.organization_id is distinct from new.organization_id then
    -- Un code déjà émis reste à l'organisation qui l'a diffusé ; les autres se créent.
    for v_edition in select ed.id from public.editions ed where ed.event_id = new.id loop
      perform private.ensure_referral_code(v_edition);
    end loop;
  end if;
  return new;
end;
$$;

create trigger trg_events_referral_codes
  after update of organization_id on public.events
  for each row execute function private.create_event_referral_codes();

-- Les éditions existantes reçoivent leur code.
select private.ensure_referral_code(ed.id) from public.editions ed;

-- ============================================================
-- 2. L'attribution, sur la participation
-- ============================================================

alter table public.participant_races
  add column referral_code_id uuid references public.organization_referral_codes(id) on delete set null;

create index ix_participant_races_referral on public.participant_races(referral_code_id)
  where referral_code_id is not null;

comment on column public.participant_races.referral_code_id is
  'Canal A : le code de l''organisation par lequel le coureur a validé sa course (0087). Posé une fois, à la création, par attach_participant_race ; reporté sur le purchase à l''achat (§73.1). Jamais exposé au client.';

-- ============================================================
-- 3. L'ajout d'une course par le coureur
-- ============================================================

create function public.attach_participant_race(p_race_id uuid, p_referral_code text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_race public.races%rowtype;
  v_code public.organization_referral_codes%rowtype;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'connexion requise' using errcode = '42501';
  end if;

  select * into v_race from public.races r where r.id = p_race_id;
  -- Mêmes règles que le domaine (checkRaceAttachment) : la base ne fait pas
  -- confiance à l'écran qui a vérifié avant elle.
  if not found or not private.race_is_publicly_readable(p_race_id) then
    raise exception 'épreuve introuvable' using errcode = 'P0002';
  end if;
  if v_race.status <> 'published' then
    raise exception 'épreuve fermée au rattachement' using errcode = '55000';
  end if;

  if nullif(trim(coalesce(p_referral_code, '')), '') is not null then
    select * into v_code from public.organization_referral_codes c
    where c.code = upper(trim(p_referral_code));

    if not found or not v_code.active or v_code.edition_id <> v_race.edition_id then
      -- §73.1 : la course s'ajoute, sans attribution ; l'anomalie se garde.
      perform private.record_audit(
        'referral.ignored', 'races', p_race_id,
        jsonb_build_object('reason', case
          when not found then 'unknown'
          when not v_code.active then 'disabled'
          else 'other_edition' end)
      );
      v_code := null;
    end if;
  end if;

  insert into public.participant_races (race_id, user_id, registration_source, joined_at, referral_code_id)
  values (p_race_id, v_user, 'direct', now(), v_code.id)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.attach_participant_race(uuid, text) from public, anon;
grant execute on function public.attach_participant_race(uuid, text) to authenticated;

-- ============================================================
-- 4. Lire un code
-- ============================================================

-- Le lien ouvre une page publique : l'édition et ses épreuves visibles, rien
-- de l'organisation au-delà de son nom public.
create function public.resolve_referral_code(p_code text)
returns table (
  code text,
  event_name text,
  event_slug text,
  edition_slug text,
  edition_year integer,
  races jsonb
)
language sql stable security definer set search_path = '' as $$
  select c.code, ev.name, ev.slug, ed.slug, ed.year::integer,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', r.name, 'slug', r.slug, 'distanceKm', r.distance_km, 'startDatetime', r.start_datetime,
        'timezone', r.timezone
      ) order by r.start_datetime, r.name)
      from public.races r
      where r.edition_id = ed.id and r.status = 'published'
        and private.race_is_publicly_readable(r.id)
    ), '[]'::jsonb)
  from public.organization_referral_codes c
  join public.editions ed on ed.id = c.edition_id
  join public.events ev on ev.id = ed.event_id
  where c.code = upper(trim(p_code)) and c.active
    -- Un code se devine (LES9CLOCHERS27) : il ne doit rien révéler d'un
    -- événement que personne ne peut encore voir, pas même son nom.
    and exists (
      select 1 from public.races r
      where r.edition_id = ed.id and r.status = 'published'
        and private.race_is_publicly_readable(r.id)
    )
$$;

revoke all on function public.resolve_referral_code(text) from public;
grant execute on function public.resolve_referral_code(text) to anon, authenticated;

-- Le code de l'édition, pour l'organisation qui le diffuse.
create function public.org_get_referral_code(p_edition_id uuid)
returns table (code text, active boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.user_can_manage_edition(p_edition_id, 'viewer') or private.is_pluka_admin()) then
    raise exception 'réservé à l''organisation de la course' using errcode = '42501';
  end if;

  return query
  select c.code, c.active from public.organization_referral_codes c where c.edition_id = p_edition_id;
end;
$$;

revoke all on function public.org_get_referral_code(uuid) from public, anon;
grant execute on function public.org_get_referral_code(uuid) to authenticated;

create function public.admin_set_referral_code_active(p_edition_id uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_pluka_admin() then
    raise exception 'réservé à l''équipe PLUKA' using errcode = '42501';
  end if;

  update public.organization_referral_codes set active = p_active
  where edition_id = p_edition_id and active <> p_active;

  if found then
    perform private.record_audit(
      'referral_code.active', 'editions', p_edition_id, jsonb_build_object('active', p_active)
    );
  end if;
end;
$$;

revoke all on function public.admin_set_referral_code_active(uuid, boolean) from public, anon;
grant execute on function public.admin_set_referral_code_active(uuid, boolean) to authenticated;

revoke all on function private.make_referral_code(uuid) from public, anon, authenticated;
revoke all on function private.ensure_referral_code(uuid) from public, anon, authenticated;
revoke all on function private.create_edition_referral_code() from public, anon, authenticated;
revoke all on function private.create_event_referral_codes() from public, anon, authenticated;

commit;
