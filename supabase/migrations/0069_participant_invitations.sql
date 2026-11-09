-- PLUKA V1 — Invitations des participants
-- File target: supabase/migrations/0069_participant_invitations.sql
-- Référence : docs/00_PRODUCT_SPEC.md §3.2, §7.3, §29.2 · docs/03_PRIVACY_RLS.md §28,
--             §115–§118 · docs/04_ENTITLEMENTS.md §12, §13, §65, §66, §70 ·
--             docs/02_DATA_MODEL.md §20.2
--
-- POURQUOI
--
-- `participant_invitations` existe depuis 0001 sans écriture. Un participant
-- importé n'a donc aucun moyen d'activer PLUKA. Cette migration livre l'envoi,
-- le lien, et l'activation qui rattache la participation au compte.
--
-- LA MÉCANIQUE EST CELLE DE L'ÉQUIPE (0033)
--
-- Pas de jeton à la création : le worker le tire à l'envoi, n'en garde que le
-- SHA-256, et le met en clair dans l'email, seul endroit où il existe (AGENTS
-- §64). Une seule invitation ouverte par participation ; renvoyer révoque la
-- précédente. Activer exige un compte dont l'adresse est celle de
-- l'invitation (§117) ; l'activation est unique, sous verrou (§118).
--
-- DÉCISIONS PRODUIT DU 2026-11-09
--
-- - le lien vaut jusqu'au départ de l'épreuve : les inscriptions arrivent des
--   mois avant la course ;
-- - l'accès « Inclus par l'organisation » dépend de l'édition, réglée par
--   PLUKA selon le contrat (`editions.participants_included`, coupé par
--   défaut). Sans lui, l'activation rattache seulement le compte ;
-- - un coureur déjà inscrit seul garde sa participation et sa préparation : la
--   ligne importée y est fusionnée (dossard, vague, adresse du fichier), puis
--   supprimée. Rien de ce qu'il a fait n'est perdu.
--
-- QUI ENVOIE
--
-- Un owner ou un admin, comme l'import (`assert_can_import_participants`). On
-- n'invite ni un participant retiré, ni une ligne sans adresse, ni un compte
-- déjà rattaché, ni une épreuve non publiée, annulée ou déjà partie. Retirer un
-- participant révoque son invitation ouverte.
--
-- L'interrupteur de mise en production est applicatif (flag
-- `participant_invitations`) : la base sert l'environnement qui l'allume.
--
-- CODES D'ERREUR
--
-- `42501` refus ou autre adresse · `P0002` introuvable · `55000` invitation
-- close, expirée, ou participation qui n'est plus la sienne.

begin;

-- ============================================================
-- 1. L'accès inclus, par édition
-- ============================================================

alter table public.editions
  add column participants_included boolean not null default false;

comment on column public.editions.participants_included is
  'Accès Organizer Included ouvert à l''activation d''une invitation (04_ENTITLEMENTS §12, §65). Contractuel : seul PLUKA le change.';

-- La policy d'écriture des éditions ouvre la ligne aux éditeurs de
-- l'organisation. Ce droit-là est facturé : il ne se pose pas soi-même.
create function private.guard_edition_participants_included()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.participants_included is distinct from old.participants_included
     and (select auth.uid()) is not null
     and not private.is_pluka_admin() then
    raise exception 'l''accès inclus d''une édition est réglé par PLUKA' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_editions_participants_included
  before update of participants_included on public.editions
  for each row execute function private.guard_edition_participants_included();

create function public.admin_set_edition_participants_included(
  p_edition_id uuid,
  p_included boolean
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_before boolean;
begin
  if not private.is_pluka_admin() then
    raise exception 'réservé à l''équipe PLUKA' using errcode = '42501';
  end if;

  select participants_included into v_before
  from public.editions where id = p_edition_id for update;

  if not found then
    raise exception 'édition introuvable' using errcode = 'P0002';
  end if;

  if v_before = p_included then
    return;
  end if;

  update public.editions set participants_included = p_included where id = p_edition_id;

  perform private.record_audit(
    'edition.participants_included',
    'editions',
    p_edition_id,
    jsonb_build_object('included', p_included)
  );
end;
$$;

-- ============================================================
-- 2. Les invitations
-- ============================================================

alter table public.participant_invitations
  alter column token_hash drop not null,
  alter column expires_at set not null,
  add column invited_by_user_id uuid references public.users(id) on delete set null,
  add column accepted_by_user_id uuid references public.users(id) on delete set null,
  add column send_attempts integer not null default 0 check (send_attempts >= 0),
  -- Erreur normalisée du dernier envoi raté — jamais l'adresse ni le contenu.
  add column last_send_error text,
  add column revoked_at timestamptz,
  -- Rien ne mesure l'ouverture d'un email, et ce n'est pas souhaité (0033).
  add constraint participant_invitations_not_opened check (status <> 'opened');

create unique index ux_participant_invitations_open
  on public.participant_invitations(participant_race_id)
  where status in ('pending', 'sent');

create index ix_participant_invitations_participant
  on public.participant_invitations(participant_race_id, created_at desc);

comment on table public.participant_invitations is
  'Invitation d''un participant importé à activer PLUKA. Jeton tiré par le worker à l''envoi, seul son SHA-256 est stocké. Écritures uniquement par les fonctions de 0069.';

-- Un participant retiré n'est plus invité : son lien cesse de fonctionner.
create function private.revoke_invitations_of_withdrawn()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.participant_invitations
  set status = 'revoked', revoked_at = now()
  where participant_race_id = new.id and status in ('pending', 'sent');
  return null;
end;
$$;

create trigger trg_participant_races_revoke_invitations
  after update of status on public.participant_races
  for each row
  when (new.status <> 'active' and old.status = 'active')
  execute function private.revoke_invitations_of_withdrawn();

-- ============================================================
-- 3. Envoyer
-- ============================================================

/*
 * Sans liste : toutes les participations invitables de l'édition qui n'ont
 * pas d'invitation ouverte, ou dont le dernier envoi a échoué — réparer
 * l'envoi ne doit pas obliger à renvoyer ligne par ligne. Avec une liste : un
 * renvoi, qui remplace l'invitation ouverte de chacune. Rend le nombre
 * d'invitations créées.
 */
create or replace function public.org_send_participant_invitations(
  p_edition_id uuid,
  p_participant_race_ids uuid[] default null
)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_target record;
  v_invitation_id uuid;
  v_count integer := 0;
begin
  perform private.assert_can_import_participants(p_edition_id);

  for v_target in
    select pr.id, pr.invite_email, r.start_datetime
    from public.participant_races pr
    join public.races r on r.id = pr.race_id
    where r.edition_id = p_edition_id
      and (p_participant_race_ids is null or pr.id = any(p_participant_race_ids))
      and pr.status = 'active'
      and pr.user_id is null
      and pr.invite_email is not null
      and r.status = 'published'
      and r.start_datetime > now()
      and (
        p_participant_race_ids is not null
        or not exists (
          select 1 from public.participant_invitations i
          where i.participant_race_id = pr.id
            and i.status in ('pending', 'sent')
            and i.expires_at > now()
            and i.last_send_error is null
        )
      )
    order by pr.id
    for update of pr
  loop
    update public.participant_invitations
    set status = 'revoked', revoked_at = now()
    where participant_race_id = v_target.id and status in ('pending', 'sent');

    insert into public.participant_invitations
      (participant_race_id, email, invited_by_user_id, expires_at)
    values (v_target.id, v_target.invite_email, (select auth.uid()), v_target.start_datetime)
    returning id into v_invitation_id;

    -- §22.2 : l'envoi part dans la transaction qui a créé l'invitation.
    insert into private.outbox_events
      (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
    values (
      'email.participant_invitation',
      'participant_invitation',
      v_invitation_id,
      jsonb_build_object('participantInvitationId', v_invitation_id),
      'email.participant_invitation:' || v_invitation_id
    );

    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    -- Une ligne par geste, jamais d'adresse (§92).
    perform private.record_audit(
      'participant_invitation.send',
      'editions',
      p_edition_id,
      jsonb_build_object('count', v_count, 'resend', p_participant_race_ids is not null)
    );
  end if;

  return v_count;
end;
$$;

/*
 * L'état d'invitation de chaque participation de l'édition, sans adresse : la
 * liste des participants porte déjà ce que l'organisation peut voir (§28).
 * Une invitation dont la date est passée est rendue `expired` à la lecture.
 */
create function public.org_list_participant_invitations(p_edition_id uuid)
returns table (
  participant_race_id uuid,
  status public.invitation_status,
  send_failed boolean,
  sent_at timestamptz,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.user_can_manage_edition(p_edition_id, 'viewer') or private.is_pluka_admin()) then
    raise exception 'lecture réservée à l''organisation' using errcode = '42501';
  end if;

  return query
  select distinct on (i.participant_race_id)
    i.participant_race_id,
    case
      when i.status in ('pending', 'sent') and i.expires_at <= now()
        then 'expired'::public.invitation_status
      else i.status
    end,
    i.status = 'pending' and i.last_send_error is not null,
    i.sent_at,
    i.created_at
  from public.participant_invitations i
  join public.participant_races pr on pr.id = i.participant_race_id
  join public.races r on r.id = pr.race_id
  where r.edition_id = p_edition_id
  order by i.participant_race_id, i.created_at desc;
end;
$$;

-- ============================================================
-- 4. Le lien d'invitation
-- ============================================================

/*
 * Aperçu avant connexion — §115 : l'événement, l'épreuve, l'organisation et
 * l'adresse masquée, pour que le coureur sache avec quel compte se connecter.
 * Ni nom, ni dossard, ni vague : ce qui est personnel attend l'authentification.
 */
create or replace function public.preview_participant_invitation(p_token_hash text)
returns table (
  state text,
  event_name text,
  race_name text,
  race_start timestamptz,
  race_timezone text,
  organization_name text,
  masked_email text,
  included boolean
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
      null::text, null::text, null::text, null::boolean;
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
    ed.participants_included
  from public.participant_races pr
  join public.races r on r.id = pr.race_id
  join public.editions ed on ed.id = r.edition_id
  join public.events e on e.id = ed.event_id
  left join public.organizations o on o.id = e.organization_id
  where pr.id = v_invitation.participant_race_id;
end;
$$;

/*
 * Activer. Rend la participation à ouvrir : celle de l'invitation, ou celle
 * que le coureur avait déjà créée seul, dans laquelle la ligne importée est
 * fusionnée.
 */
create function public.accept_participant_invitation(p_token_hash text)
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

  update public.participant_invitations
  set status = 'activated', activated_at = now(), accepted_by_user_id = v_user
  where id = v_invitation.id;

  perform private.record_audit(
    'participant_invitation.accept',
    'participant_invitations',
    v_invitation.id,
    jsonb_build_object('merged', v_target <> v_imported.id, 'included', v_granted)
  );

  return v_target;
end;
$$;

-- ============================================================
-- 5. Envoi — worker uniquement
-- ============================================================

/*
 * Le worker réclame l'envoi avec le hash du jeton qu'il vient de tirer. Rend
 * `sendable = false` pour une invitation déjà envoyée, close ou expirée, ou une
 * participation retirée ou déjà rattachée : le message de file a alors rempli
 * son office.
 */
create or replace function public.worker_claim_participant_invitation(
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
      null::timestamptz, null::text, null::boolean, 0;
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
    v_invitation.send_attempts + 1
  from public.participant_races pr
  join public.races r on r.id = pr.race_id
  join public.editions ed on ed.id = r.edition_id
  join public.events e on e.id = ed.event_id
  left join public.organizations o on o.id = e.organization_id
  where pr.id = v_invitation.participant_race_id;
end;
$$;

create function public.worker_complete_participant_invitation(p_invitation_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.participant_invitations
  set status = 'sent', sent_at = now(), last_send_error = null
  where id = p_invitation_id and status = 'pending';
$$;

/* Rend le nombre de tentatives faites : le worker abandonne au-delà de 5. */
create function public.worker_fail_participant_invitation(
  p_invitation_id uuid,
  p_error text
)
returns integer language sql security definer set search_path = '' as $$
  update public.participant_invitations
  set last_send_error = left(p_error, 500)
  where id = p_invitation_id
  returning send_attempts;
$$;

-- ============================================================
-- 6. Droits d'exécution
-- ============================================================

revoke all on function private.guard_edition_participants_included() from public, anon, authenticated;
revoke all on function private.revoke_invitations_of_withdrawn() from public, anon, authenticated;

revoke all on function public.admin_set_edition_participants_included(uuid, boolean) from public, anon;
revoke all on function public.org_send_participant_invitations(uuid, uuid[]) from public, anon;
revoke all on function public.org_list_participant_invitations(uuid) from public, anon;
revoke all on function public.preview_participant_invitation(text) from public;
revoke all on function public.accept_participant_invitation(text) from public, anon;

grant execute on function public.admin_set_edition_participants_included(uuid, boolean) to authenticated;
grant execute on function public.org_send_participant_invitations(uuid, uuid[]) to authenticated;
grant execute on function public.org_list_participant_invitations(uuid) to authenticated;
-- L'aperçu précède la connexion : la page d'invitation l'appelle en anonyme.
grant execute on function public.preview_participant_invitation(text) to anon, authenticated;
grant execute on function public.accept_participant_invitation(text) to authenticated;

revoke all on function public.worker_claim_participant_invitation(uuid, text) from public, anon, authenticated;
revoke all on function public.worker_complete_participant_invitation(uuid) from public, anon, authenticated;
revoke all on function public.worker_fail_participant_invitation(uuid, text) from public, anon, authenticated;
grant execute on function public.worker_claim_participant_invitation(uuid, text) to service_role;
grant execute on function public.worker_complete_participant_invitation(uuid) to service_role;
grant execute on function public.worker_fail_participant_invitation(uuid, text) to service_role;

commit;
