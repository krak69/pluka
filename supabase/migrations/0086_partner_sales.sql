-- PLUKA V1 — Canal B : l'option « Prépa PLUKA » vendue à l'inscription
-- File target: supabase/migrations/0086_partner_sales.sql
-- Référence : docs/00_PRODUCT_SPEC.md §6.5.5, §29.1 · docs/04_ENTITLEMENTS.md §67, §69, §70, §71, §73.2
--
-- POURQUOI
--
-- Une organisation peut vendre l'option dans son formulaire d'inscription :
-- elle encaisse, transmet ses acheteurs dans son fichier de participants
-- (colonnes « Option PLUKA » et « Référence », décision du 2026-11-12), et
-- PLUKA accorde un Race Pass au coureur. Ce Race Pass est payé par le
-- coureur : jamais un Organizer Included.
--
-- Règles :
--
--   - le canal s'ouvre par édition, par PLUKA seul, une fois le contrat signé
--     (décision du 2026-11-12) ; il exclut l'accès inclus : un coureur ne paie
--     pas ce que son organisation lui offre ;
--   - la trace commerciale est la ligne de vente (§71) : une par référence
--     d'export, dans l'organisation. Un fichier rejoué ne double rien (E46) ;
--   - le Race Pass naît quand la participation a un coureur : à l'import s'il
--     est déjà sur PLUKA, sinon à l'activation de son invitation (§73.2) ;
--   - une participation déjà couverte par un Race Pass actif ne reçoit pas de
--     second droit : la ligne passe en conflit, l'organisation rembourse (E47) ;
--   - chaque ligne accordée compte pour la facturation de l'organisation au
--     prix de cession, fixé par contrat et hors de cette base.
--
-- Au passage, la fusion d'une participation importée dans celle du coureur
-- garde la date d'inscription vérifiée (0083), que 0069 ne connaissait pas.

begin;

-- ============================================================
-- 1. L'ouverture du canal, par édition
-- ============================================================

alter table public.editions
  add column partner_sales_enabled boolean not null default false,
  add constraint editions_partner_sales_or_included
    check (not (partner_sales_enabled and participants_included));

comment on column public.editions.partner_sales_enabled is
  'Canal B ouvert : l''option Prépa PLUKA vendue à l''inscription est importée et donne un Race Pass (§6.5.5). Contractuel : seul PLUKA le change. Exclut participants_included.';

create function private.guard_edition_partner_sales()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.partner_sales_enabled is distinct from old.partner_sales_enabled
     and (select auth.uid()) is not null
     and not private.is_pluka_admin() then
    raise exception 'le canal de vente d''une édition est réglé par PLUKA' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_editions_partner_sales
  before update of partner_sales_enabled on public.editions
  for each row execute function private.guard_edition_partner_sales();

create function public.admin_set_edition_partner_sales(p_edition_id uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_before boolean;
  v_included boolean;
begin
  if not private.is_pluka_admin() then
    raise exception 'réservé à l''équipe PLUKA' using errcode = '42501';
  end if;

  select partner_sales_enabled, participants_included into v_before, v_included
  from public.editions where id = p_edition_id for update;

  if not found then
    raise exception 'édition introuvable' using errcode = 'P0002';
  end if;

  if v_before = p_enabled then
    return;
  end if;

  if p_enabled and v_included then
    raise exception 'l''accès est déjà inclus pour cette édition' using errcode = '55000';
  end if;

  update public.editions set partner_sales_enabled = p_enabled where id = p_edition_id;

  perform private.record_audit(
    'edition.partner_sales', 'editions', p_edition_id, jsonb_build_object('enabled', p_enabled)
  );
end;
$$;

-- L'inverse : ouvrir l'accès inclus sur une édition qui vend l'option se refuse
-- avec un message clair, plutôt que par la contrainte. Le reste est la version
-- de 0072, qui accorde l'accès aux participants déjà activés.
create or replace function public.admin_set_edition_participants_included(
  p_edition_id uuid,
  p_included boolean
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_before boolean;
  v_partner boolean;
  v_granted integer := 0;
begin
  if not private.is_pluka_admin() then
    raise exception 'réservé à l''équipe PLUKA' using errcode = '42501';
  end if;

  select participants_included, partner_sales_enabled into v_before, v_partner
  from public.editions where id = p_edition_id for update;

  if not found then
    raise exception 'édition introuvable' using errcode = 'P0002';
  end if;

  if v_before = p_included then
    return;
  end if;

  if p_included and v_partner then
    raise exception 'l''option est vendue à l''inscription pour cette édition' using errcode = '55000';
  end if;

  update public.editions set participants_included = p_included where id = p_edition_id;

  if p_included then
    -- §70 : un seul Organizer Included actif par participation, l'index unique
    -- le garantit ; un participant déjà couvert est laissé tel quel.
    insert into public.entitlements
      (kind, source, status, scope_type, user_id, participant_race_id, organization_id, metadata)
    select
      'organizer_included', 'organization', 'active', 'participant_race',
      pr.user_id, pr.id, e.organization_id,
      jsonb_build_object('editionId', p_edition_id, 'grantedOn', 'edition_opened')
    from public.participant_races pr
    join public.races r on r.id = pr.race_id
    join public.editions ed on ed.id = r.edition_id
    join public.events e on e.id = ed.event_id
    where r.edition_id = p_edition_id
      and pr.user_id is not null
      and pr.status = 'active'
      and pr.invite_email is not null
      and e.organization_id is not null
    on conflict do nothing;

    get diagnostics v_granted = row_count;
  end if;

  perform private.record_audit(
    'edition.participants_included',
    'editions',
    p_edition_id,
    jsonb_build_object('included', p_included, 'granted', v_granted)
  );
end;
$$;

-- ============================================================
-- 2. Le Race Pass d'une vente partenaire
-- ============================================================

-- §69 : un Race Pass partner_sale nomme son organisation et sa ligne d'export.
alter table public.entitlements
  add constraint entitlements_partner_sale_traced check (
    source <> 'partner_sale'
    or (kind = 'race_pass' and organization_id is not null and external_reference is not null)
  );

-- ============================================================
-- 3. Les lignes de vente
-- ============================================================

create table public.partner_sale_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  edition_id uuid not null references public.editions(id) on delete restrict,
  -- Nulle si la participation a disparu (compte supprimé) : la vente, elle, a eu lieu.
  participant_race_id uuid references public.participant_races(id) on delete set null,
  external_reference text not null
    check (char_length(external_reference) between 1 and 120),
  status text not null default 'pending'
    check (status in ('pending', 'granted', 'conflict')),
  entitlement_id uuid references public.entitlements(id) on delete set null,
  import_id uuid references public.participant_imports(id) on delete set null,
  granted_at timestamptz,
  conflict_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_sale_lines_reference_unique unique (organization_id, external_reference)
);

create index ix_partner_sale_lines_participant on public.partner_sale_lines(participant_race_id);
create index ix_partner_sale_lines_edition on public.partner_sale_lines(edition_id, status);

comment on table public.partner_sale_lines is
  'Canal B : une vente de l''option Prépa PLUKA encaissée par l''organisation (§6.5.5, §71). Une ligne par référence d''export. Base de la facturation au prix de cession. Écritures uniquement par les fonctions de 0086.';

alter table public.partner_sale_lines enable row level security;
revoke all on table public.partner_sale_lines from anon, authenticated;

create trigger trg_partner_sale_lines_updated_at
  before update on public.partner_sale_lines
  for each row execute function private.set_updated_at();

-- Accorde les ventes en attente d'une participation qui a un coureur. Rend le
-- nombre de Race Pass créés. Appelée à l'import et à l'activation.
create function private.grant_partner_sales(p_participant_race_id uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_line public.partner_sale_lines%rowtype;
  v_entitlement uuid;
  v_granted integer := 0;
begin
  select pr.user_id into v_user from public.participant_races pr where pr.id = p_participant_race_id;
  if v_user is null then
    return 0;
  end if;

  for v_line in
    select * from public.partner_sale_lines l
    where l.participant_race_id = p_participant_race_id and l.status = 'pending'
    order by l.created_at, l.id
    for update
  loop
    v_entitlement := null;

    -- §70 : un seul Race Pass actif par participation, tous canaux confondus.
    -- L'index unique tranche, même sous deux transactions concurrentes.
    insert into public.entitlements
      (kind, source, status, scope_type, user_id, participant_race_id, organization_id,
       external_reference, metadata)
    values
      ('race_pass', 'partner_sale', 'active', 'participant_race', v_user, p_participant_race_id,
       v_line.organization_id, v_line.external_reference,
       jsonb_build_object('partnerSaleLineId', v_line.id))
    on conflict do nothing
    returning id into v_entitlement;

    if v_entitlement is null then
      update public.partner_sale_lines
      set status = 'conflict', conflict_at = now()
      where id = v_line.id;
      perform private.record_audit('partner_sale.conflict', 'partner_sale_lines', v_line.id);
    else
      update public.partner_sale_lines
      set status = 'granted', granted_at = now(), entitlement_id = v_entitlement
      where id = v_line.id;
      perform private.record_audit('partner_sale.granted', 'partner_sale_lines', v_line.id);
      v_granted := v_granted + 1;
    end if;
  end loop;

  return v_granted;
end;
$$;

-- Enregistre une vente d'un fichier. Une référence déjà connue de l'organisation
-- ne crée rien : rejouer un export est sans effet (E46).
create function private.record_partner_sale(
  p_participant_race_id uuid,
  p_edition_id uuid,
  p_organization_id uuid,
  p_reference text,
  p_import_id uuid
)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into public.partner_sale_lines
    (organization_id, edition_id, participant_race_id, external_reference, import_id)
  values (p_organization_id, p_edition_id, p_participant_race_id, left(p_reference, 120), p_import_id)
  on conflict (organization_id, external_reference) do nothing
  returning id into v_id;

  if v_id is null then
    return false;
  end if;

  perform private.record_audit('partner_sale.imported', 'partner_sale_lines', v_id);
  perform private.grant_partner_sales(p_participant_race_id);
  return true;
end;
$$;

-- ============================================================
-- 4. L'import : les ventes avec le fichier de participants
-- ============================================================

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
  v_partner_open boolean;
  v_organization uuid;
  v_created integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_kept integer := 0;
  v_withdrawn integer := 0;
  v_sales integer := 0;
begin
  select * into v_import from public.participant_imports i where i.id = p_import_id for update;
  if not found then
    raise exception 'import introuvable' using errcode = 'P0002';
  end if;
  perform private.assert_can_import_participants(v_import.edition_id);

  if v_import.status <> 'validating' then
    raise exception 'import non prêt' using errcode = '55000';
  end if;

  select ed.partner_sales_enabled, ev.organization_id into v_partner_open, v_organization
  from public.editions ed join public.events ev on ev.id = ed.event_id
  where ed.id = v_import.edition_id;

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
    else
      v_participant_id := v_effect.participant_id;

      -- Présent : dossard, vague et date d'inscription non vérifiée, seulement ce que le fichier apporte.
      if v_effect.apply_bib then
        update public.participant_races pr set bib_number = v_bib
        where pr.id = v_participant_id;
      end if;
      if v_effect.apply_wave then
        update public.participant_races pr
        set start_wave_id = v_effect.wave_id,
          declared_wave_name = case when v_effect.wave_id is null then left(v_wave, 120) end
        where pr.id = v_participant_id;
      end if;
      if v_effect.apply_registered_on then
        -- `is null` redit ici : la règle de figement tient même si l'effet était périmé.
        update public.participant_races pr set registered_on = v_registered_on
        where pr.id = v_participant_id and pr.registered_on is null;
      end if;

      if v_effect.kept then
        v_kept := v_kept + 1;
      end if;

      if v_effect.effect = 'updated' then
        update public.participant_import_rows r
        set status = 'imported', participant_race_id = v_participant_id,
          error_message = case when v_effect.kept then 'Correction à la main gardée.' end
        where r.id = v_row.id;
        v_updated := v_updated + 1;
      else
        update public.participant_import_rows r
        set status = 'skipped', participant_race_id = v_participant_id,
          error_message = case when v_effect.kept then 'Correction à la main gardée.' else 'Déjà dans la liste.' end
        where r.id = v_row.id;
        v_skipped := v_skipped + 1;
      end if;
    end if;

    -- Canal fermé : la colonne est lue, rien n'en sort (la vérification l'a dit).
    if v_partner_open and (v_data ->> 'partnerSale') = 'yes'
       and nullif(v_data ->> 'externalReference', '') is not null then
      if private.record_partner_sale(
           v_participant_id, v_import.edition_id, v_organization,
           v_data ->> 'externalReference', p_import_id) then
        v_sales := v_sales + 1;
      end if;
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
      'kept', v_kept, 'withdrawn', v_withdrawn, 'partnerSales', v_sales)
  );

  return jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped,
    'kept', v_kept, 'withdrawn', v_withdrawn, 'partnerSales', v_sales);
end;
$$;

/*
 * L'état d'un import pour son assistant. Effets, vagues inconnues et ventes se
 * calculent avec les règles de l'import : ce que l'organisation lit est ce qui
 * se passera.
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
  v_partner_open boolean;
  v_organization uuid;
begin
  select * into v_import from public.participant_imports i where i.id = p_import_id;
  if not found then
    raise exception 'import introuvable' using errcode = 'P0002';
  end if;
  perform private.assert_can_import_participants(v_import.edition_id);

  select ed.partner_sales_enabled, ev.organization_id into v_partner_open, v_organization
  from public.editions ed join public.events ev on ev.id = ed.event_id
  where ed.id = v_import.edition_id;

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
    ), sales as (
      select r.mapped_data ->> 'externalReference' as reference
      from public.participant_import_rows r
      where r.import_id = p_import_id and r.status = 'valid'
        and r.mapped_data ->> 'partnerSale' = 'yes'
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
      'partnerSales', jsonb_build_object(
        'open', v_partner_open,
        'rows', (select count(*)::integer from sales),
        'new', (
          select count(distinct s.reference)::integer from sales s
          where not exists (
            select 1 from public.partner_sale_lines l
            where l.organization_id = v_organization and l.external_reference = s.reference
          )
        )
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

-- ============================================================
-- 5. La liste : l'état de l'option, participant par participant
-- ============================================================

create or replace function public.list_edition_participants(p_edition_id uuid, p_limit integer default 500)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_can_see_contact boolean;
  v_member boolean;
begin
  v_member := private.user_can_manage_edition(p_edition_id, 'viewer');
  if not (v_member or private.is_pluka_admin()) then
    raise exception 'liste réservée à l''organisation de la course' using errcode = '42501';
  end if;

  -- Le support lit une liste nominative : la lecture laisse une trace (§104).
  if not v_member then
    perform private.record_audit('edition_participants.read', 'editions', p_edition_id);
  end if;

  v_can_see_contact := private.user_can_manage_edition(p_edition_id, 'admin') or private.is_pluka_admin();

  return (
    with edition_participants as (
      select pr.id, pr.race_id, pr.first_name_snapshot, pr.last_name_snapshot, pr.invite_email,
        pr.bib_number, pr.declared_wave_name, pr.user_id, r.name as race_name, w.name as wave_name,
        private.registration_reference(pr.registered_on, pr.created_at, r.timezone) as registration,
        -- Une vente accordée l'emporte sur une en attente, qui l'emporte sur un conflit.
        (select l.status from public.partner_sale_lines l
         where l.participant_race_id = pr.id
         order by case l.status when 'granted' then 0 when 'pending' then 1 else 2 end
         limit 1) as partner_sale,
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
          'activated', e.user_id is not null,
          'registration', e.registration,
          'partnerSale', e.partner_sale
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
      'partnerSales', jsonb_build_object(
        'open', (select ed.partner_sales_enabled from public.editions ed where ed.id = p_edition_id),
        'pending', (select count(*)::integer from public.partner_sale_lines l
                    where l.edition_id = p_edition_id and l.status = 'pending'),
        'granted', (select count(*)::integer from public.partner_sale_lines l
                    where l.edition_id = p_edition_id and l.status = 'granted'),
        'conflict', (select count(*)::integer from public.partner_sale_lines l
                     where l.edition_id = p_edition_id and l.status = 'conflict')
      ),
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

-- ============================================================
-- 6. L'activation : la vente suit la participation, puis s'accorde
-- ============================================================

create or replace function public.accept_participant_invitation(p_token_hash text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_invitation public.participant_invitations%rowtype;
  v_imported public.participant_races%rowtype;
  v_user_email extensions.citext;
  v_own uuid;
  v_target uuid;
  v_organization uuid;
  v_included boolean;
  v_granted boolean := false;
  v_sales integer := 0;
begin
  if v_user is null then
    raise exception 'connexion requise' using errcode = '42501';
  end if;

  -- §118 : une seule activation, même sous deux requêtes simultanées.
  select * into v_invitation
  from public.participant_invitations i
  where i.token_hash = p_token_hash
  for update;

  if not found then
    raise exception 'invitation introuvable' using errcode = 'P0002';
  end if;

  if v_invitation.status not in ('pending', 'sent') then
    raise exception 'invitation close (%)', v_invitation.status using errcode = '55000';
  end if;

  if v_invitation.expires_at <= now() then
    raise exception 'invitation expirée' using errcode = '55000';
  end if;

  -- §117 : le lien transféré ne suffit pas. Le refus ne cite pas l'adresse.
  select u.email into v_user_email from public.users u where u.id = v_user;

  if v_user_email is distinct from v_invitation.email then
    raise exception 'invitation destinée à une autre adresse' using errcode = '42501';
  end if;

  select * into v_imported
  from public.participant_races pr
  where pr.id = v_invitation.participant_race_id
  for update;

  if v_imported.status <> 'active'
     or (v_imported.user_id is not null and v_imported.user_id <> v_user) then
    raise exception 'participation indisponible' using errcode = '55000';
  end if;

  select e.organization_id, ed.participants_included into v_organization, v_included
  from public.races r
  join public.editions ed on ed.id = r.edition_id
  join public.events e on e.id = ed.event_id
  where r.id = v_imported.race_id;

  v_target := v_imported.id;

  if v_imported.user_id is null then
    select pr.id into v_own
    from public.participant_races pr
    where pr.race_id = v_imported.race_id and pr.user_id = v_user
    for update;

    if v_own is null then
      update public.participant_races
      set user_id = v_user, joined_at = now()
      where id = v_imported.id;
    else
      -- Fusion : la préparation du coureur reste où elle est. Ce que
      -- l'organisation savait de lui la rejoint, puis la ligne importée, qui
      -- ne porte aucune préparation, disparaît.
      update public.participant_invitations
      set participant_race_id = v_own
      where participant_race_id = v_imported.id;

      update public.participant_import_rows
      set participant_race_id = v_own
      where participant_race_id = v_imported.id;

      -- La vente suit le coureur : sans cela, la suppression ci-dessous la
      -- détacherait de toute participation (0086).
      update public.partner_sale_lines
      set participant_race_id = v_own
      where participant_race_id = v_imported.id;

      update private.participant_demographics
      set participant_race_id = v_own
      where participant_race_id = v_imported.id
        and not exists (
          select 1 from private.participant_demographics d where d.participant_race_id = v_own
        );

      update private.participant_performance_signals s
      set participant_race_id = v_own
      where s.participant_race_id = v_imported.id
        and not exists (
          select 1 from private.participant_performance_signals o
          where o.participant_race_id = v_own and o.provider = s.provider
        );

      delete from public.participant_races where id = v_imported.id;

      update public.participant_races
      set bib_number = coalesce(v_imported.bib_number, bib_number),
          start_wave_id = coalesce(v_imported.start_wave_id, start_wave_id),
          declared_wave_name = coalesce(v_imported.declared_wave_name, declared_wave_name),
          bib_set_manually = v_imported.bib_set_manually,
          wave_set_manually = v_imported.wave_set_manually,
          -- L'adresse du fichier reste l'identité d'import : un fichier repris
          -- retrouve cette participation.
          invite_email = v_imported.invite_email,
          external_registration_id =
            coalesce(v_imported.external_registration_id, external_registration_id),
          -- La date transmise par l'organisation prévaut sur la déclarative (0083).
          registered_on = coalesce(v_imported.registered_on, registered_on),
          first_name_snapshot = coalesce(first_name_snapshot, v_imported.first_name_snapshot),
          last_name_snapshot = coalesce(last_name_snapshot, v_imported.last_name_snapshot)
      where id = v_own;

      v_target := v_own;
    end if;
  end if;

  -- §13 : le droit existe avant toute mutation premium. §70 : un seul
  -- Organizer Included actif par participation, garanti par l'index unique.
  if v_included and v_organization is not null then
    insert into public.entitlements
      (kind, source, status, scope_type, user_id, participant_race_id, organization_id, metadata)
    values (
      'organizer_included', 'organization', 'active', 'participant_race',
      v_user, v_target, v_organization,
      jsonb_build_object('participantInvitationId', v_invitation.id)
    )
    on conflict do nothing;

    v_granted := found;
  end if;

  -- §73.2 : la vente encaissée par l'organisation devient un Race Pass.
  v_sales := private.grant_partner_sales(v_target);

  update public.participant_invitations
  set status = 'activated', activated_at = now(), accepted_by_user_id = v_user
  where id = v_invitation.id;

  perform private.record_audit(
    'participant_invitation.accept',
    'participant_invitations',
    v_invitation.id,
    jsonb_build_object('merged', v_target <> v_imported.id, 'included', v_granted,
      'partnerSales', v_sales)
  );

  return v_target;
end;
$$;

-- ============================================================
-- 7. L'invitation dit que la préparation est déjà réglée
-- ============================================================

drop function public.preview_participant_invitation(text);

create function public.preview_participant_invitation(p_token_hash text)
returns table (
  state text,
  event_name text,
  race_name text,
  race_start timestamptz,
  race_timezone text,
  organization_name text,
  masked_email text,
  included boolean,
  prepaid boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_invitation public.participant_invitations%rowtype;
  v_email text;
begin
  select * into v_invitation
  from public.participant_invitations i
  where i.token_hash = p_token_hash;

  if not found then
    return query select 'unknown'::text, null::text, null::text, null::timestamptz,
      null::text, null::text, null::text, null::boolean, null::boolean;
    return;
  end if;

  v_email := v_invitation.email::text;

  return query
  select
    case
      when v_invitation.status not in ('pending', 'sent') or pr.status <> 'active' then 'closed'
      when v_invitation.expires_at <= now() then 'expired'
      else 'valid'
    end,
    e.name,
    r.name,
    r.start_datetime,
    r.timezone::text,
    o.name,
    left(split_part(v_email, '@', 1), 1) || '***@' || split_part(v_email, '@', 2),
    ed.participants_included,
    exists (
      select 1 from public.partner_sale_lines l
      where l.participant_race_id = pr.id and l.status in ('pending', 'granted')
    )
  from public.participant_races pr
  join public.races r on r.id = pr.race_id
  join public.editions ed on ed.id = r.edition_id
  join public.events e on e.id = ed.event_id
  left join public.organizations o on o.id = e.organization_id
  where pr.id = v_invitation.participant_race_id;
end;
$$;

drop function public.worker_claim_participant_invitation(uuid, text);

create function public.worker_claim_participant_invitation(
  p_invitation_id uuid,
  p_token_hash text
)
returns table (
  sendable boolean,
  email text,
  first_name text,
  event_name text,
  race_name text,
  organization_name text,
  race_start timestamptz,
  race_timezone text,
  included boolean,
  prepaid boolean,
  attempt integer
)
language plpgsql security definer set search_path = '' as $$
declare
  v_invitation public.participant_invitations%rowtype;
begin
  select * into v_invitation
  from public.participant_invitations i
  where i.id = p_invitation_id
  for update;

  if not found
     or v_invitation.status <> 'pending'
     or v_invitation.expires_at <= now()
     or not exists (
       select 1 from public.participant_races pr
       where pr.id = v_invitation.participant_race_id
         and pr.status = 'active'
         and pr.user_id is null
     ) then
    return query select false, null::text, null::text, null::text, null::text, null::text,
      null::timestamptz, null::text, null::boolean, null::boolean, 0;
    return;
  end if;

  update public.participant_invitations
  set token_hash = p_token_hash, send_attempts = send_attempts + 1
  where id = p_invitation_id;

  return query
  select
    true,
    v_invitation.email::text,
    pr.first_name_snapshot,
    e.name,
    r.name,
    o.name,
    r.start_datetime,
    r.timezone::text,
    ed.participants_included,
    exists (
      select 1 from public.partner_sale_lines l
      where l.participant_race_id = pr.id and l.status = 'pending'
    ),
    v_invitation.send_attempts + 1
  from public.participant_races pr
  join public.races r on r.id = pr.race_id
  join public.editions ed on ed.id = r.edition_id
  join public.events e on e.id = ed.event_id
  left join public.organizations o on o.id = e.organization_id
  where pr.id = v_invitation.participant_race_id;
end;
$$;

-- ============================================================
-- 8. Droits d'exécution
-- ============================================================

revoke all on function private.guard_edition_partner_sales() from public, anon, authenticated;
revoke all on function private.grant_partner_sales(uuid) from public, anon, authenticated;
revoke all on function private.record_partner_sale(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;

revoke all on function public.admin_set_edition_partner_sales(uuid, boolean) from public, anon;
grant execute on function public.admin_set_edition_partner_sales(uuid, boolean) to authenticated;

revoke all on function public.preview_participant_invitation(text) from public;
grant execute on function public.preview_participant_invitation(text) to anon, authenticated;

revoke all on function public.worker_claim_participant_invitation(uuid, text)
  from public, anon, authenticated;
grant execute on function public.worker_claim_participant_invitation(uuid, text) to service_role;

commit;
