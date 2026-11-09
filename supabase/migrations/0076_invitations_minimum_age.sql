-- PLUKA V1 — Pas d'invitation avant 15 ans
-- File target: supabase/migrations/0076_invitations_minimum_age.sql
-- Référence : docs/legal/RGPD_AUTO_EVALUATION.md §4 · pluka.run/confidentialite
--
-- POURQUOI
--
-- Décision du 2026-11-09 : PLUKA s'adresse aux personnes de 15 ans et plus.
-- Une organisation peut importer un inscrit plus jeune, avec sa date de
-- naissance (0060, schéma privé). L'invitation ne part pas vers lui : la
-- ligne reste dans la liste de l'organisation, sans e-mail de PLUKA.
--
-- Sans date de naissance connue, rien n'est supposé : PLUKA ne demande pas
-- l'âge à l'organisation, et la règle est rappelée dans les CGU.

begin;

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
      -- 0076 : PLUKA s'adresse aux 15 ans et plus. Sans date de naissance, rien
      -- n'est supposé : la ligne reste invitable.
      and not exists (
        select 1 from private.participant_demographics d
        where d.participant_race_id = pr.id
          and d.birth_date is not null
          and d.birth_date > (current_date - interval '15 years')::date
      )
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

commit;
