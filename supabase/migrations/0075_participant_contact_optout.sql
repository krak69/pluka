-- PLUKA V1 — Refuser d'être contacté
-- File target: supabase/migrations/0075_participant_contact_optout.sql
-- Référence : migration 0069 · docs/03_PRIVACY_RLS.md §28
--
-- POURQUOI
--
-- L'invitation part à une adresse que l'organisation a transmise à PLUKA. Le
-- coureur doit pouvoir refuser simplement, depuis l'e-mail, sans compte. Le
-- refus révoque l'invitation et met l'adresse à l'écart pour cette
-- organisation : ni un renvoi, ni un nouvel import ne la recontactent.
--
-- LE GESTE
--
-- Le lien de l'e-mail ouvre une page ; c'est un bouton qui refuse, jamais la
-- simple ouverture du lien — un antivirus qui suit les liens d'un e-mail ne
-- doit pas refuser à la place du coureur. Posséder le lien suffit : refuser
-- ne donne accès à rien.
--
-- CE QUE VOIT L'ORGANISATION
--
-- Qu'une ligne de sa liste a refusé d'être contactée, et rien d'autre. Le
-- journal ne porte aucune adresse.

begin;

create table private.participant_contact_optouts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email extensions.citext not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, email)
);

revoke all on private.participant_contact_optouts from public, anon, authenticated;

comment on table private.participant_contact_optouts is
  'Adresses qui ont refusé les invitations d''une organisation depuis l''e-mail (0075). Aucun envoi ne les recontacte.';

/* Rend `declined`, `closed` (invitation déjà activée) ou `unknown`. */
create function public.decline_participant_invitation(p_token_hash text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_invitation public.participant_invitations%rowtype;
  v_organization uuid;
begin
  select * into v_invitation
  from public.participant_invitations i
  where i.token_hash = p_token_hash
  for update;

  if not found then
    return 'unknown';
  end if;

  if v_invitation.status = 'activated' then
    return 'closed';
  end if;

  select e.organization_id into v_organization
  from public.participant_races pr
  join public.races r on r.id = pr.race_id
  join public.editions ed on ed.id = r.edition_id
  join public.events e on e.id = ed.event_id
  where pr.id = v_invitation.participant_race_id;

  update public.participant_invitations
  set status = 'revoked', revoked_at = coalesce(revoked_at, now())
  where participant_race_id = v_invitation.participant_race_id
    and status in ('pending', 'sent');

  if v_organization is not null then
    insert into private.participant_contact_optouts (organization_id, email)
    values (v_organization, v_invitation.email)
    on conflict do nothing;
  end if;

  perform private.record_audit(
    'participant_invitation.decline',
    'participant_invitations',
    v_invitation.id,
    jsonb_build_object('organizationId', v_organization)
  );

  return 'declined';
end;
$$;

/*
 * Les participations de l'édition dont l'adresse a refusé d'être contactée :
 * l'écran Participants le dit sur la ligne, sans autre détail.
 */
create function public.org_list_contact_optouts(p_edition_id uuid)
returns table (participant_race_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.user_can_manage_edition(p_edition_id, 'viewer') or private.is_pluka_admin()) then
    raise exception 'lecture réservée à l''organisation' using errcode = '42501';
  end if;

  return query
  select pr.id
  from public.participant_races pr
  join public.races r on r.id = pr.race_id
  join public.editions ed on ed.id = r.edition_id
  join public.events e on e.id = ed.event_id
  join private.participant_contact_optouts o
    on o.organization_id = e.organization_id and o.email = pr.invite_email
  where r.edition_id = p_edition_id;
end;
$$;

-- L'envoi de 0069, qui saute désormais les adresses à l'écart.
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
      -- 0075 : une adresse qui a refusé d'être contactée ne l'est plus par cette organisation.
      and not exists (
        select 1
        from private.participant_contact_optouts o
        join public.editions ed on ed.id = r.edition_id
        join public.events e on e.id = ed.event_id
        where o.organization_id = e.organization_id
          and o.email = pr.invite_email
      )
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

revoke all on function public.decline_participant_invitation(text) from public;
revoke all on function public.org_list_contact_optouts(uuid) from public, anon;
grant execute on function public.decline_participant_invitation(text) to anon, authenticated;
grant execute on function public.org_list_contact_optouts(uuid) to authenticated;

commit;
