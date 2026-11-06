-- PLUKA V1 — Avertir d'une annulation
-- File target: supabase/migrations/0068_race_cancelled_notification.sql
-- Référence : docs/00_PRODUCT_SPEC.md §4.1
--
-- POURQUOI
--
-- 0067 avertit quand une annulation est levée, alors que l'annulation elle-même
-- ne disait rien : un coureur pouvait apprendre la levée d'une annulation dont
-- il n'avait jamais entendu parler.
--
-- LA PRÉFÉRENCE NE S'APPLIQUE PAS
--
-- Savoir si sa course a lieu relève de la sécurité, pas d'une mise à jour :
-- `notifications_enabled` coupe les changements officiels (0016), pas ce
-- message. Le rétablissement suit la même règle, ce qui corrige 0067 : qui a
-- appris l'annulation doit apprendre qu'elle est levée, sans quoi il ne
-- viendrait pas à une course maintenue.
--
-- SEULE L'ANNULATION RÉELLE ÉCRIT
--
-- `archived → cancelled` est un désarchivage, pas une annulation : personne
-- n'a de nouvelle à recevoir.

begin;

alter table private.notification_deliveries
  drop constraint notification_deliveries_kind_check,
  add constraint notification_deliveries_kind_check
    check (kind in ('race_change_impact', 'race_reinstated', 'race_cancelled'));

alter table private.notification_deliveries
  drop constraint notification_deliveries_subject_check,
  add constraint notification_deliveries_subject_check check (
    (kind = 'race_change_impact' and change_event_id is not null and race_transition_id is null)
    or (
      kind in ('race_reinstated', 'race_cancelled')
      and change_event_id is null
      and race_transition_id is not null
    )
  );

comment on column private.notification_deliveries.race_transition_id is
  'La transition que la livraison annonce : annulation ou rétablissement. Nulle pour un changement officiel.';

drop trigger race_reinstated_notifies on public.race_status_transitions;
drop function private.notify_race_reinstated();

create function private.notify_race_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := case new.to_status
    when 'cancelled' then 'race_cancelled'
    else 'race_reinstated'
  end;
  v_participant record;
  v_delivery_id uuid;
begin
  for v_participant in
    select pr.id
    from public.participant_races pr
    where pr.race_id = new.race_id
      and pr.user_id is not null
      and pr.status = 'active'
  loop
    v_delivery_id := null;

    insert into private.notification_deliveries
      (kind, participant_race_id, race_transition_id, idempotency_key)
    values (
      v_kind,
      v_participant.id,
      new.id,
      v_kind || ':' || new.id::text || ':' || v_participant.id::text
    )
    on conflict (participant_race_id, race_transition_id, kind) do nothing
    returning id into v_delivery_id;

    if v_delivery_id is not null then
      insert into private.outbox_events
        (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
      values (
        'email.send',
        'notification_delivery',
        v_delivery_id,
        jsonb_build_object(
          'deliveryId', v_delivery_id,
          'kind', v_kind,
          'idempotencyKey', 'email.send:' || v_delivery_id::text
        ),
        'email.send:' || v_delivery_id::text
      )
      on conflict (idempotency_key) do nothing;
    end if;
  end loop;

  return null;
end;
$$;

comment on function private.notify_race_status_change() is
  'Avertit les participants qu''une course est annulée ou rétablie (§4.1), dans la transaction de la transition (§22.2). Ignore notifications_enabled : information de sécurité.';

create trigger race_status_notifies
  after insert on public.race_status_transitions
  for each row
  when (
    (new.from_status = 'published' and new.to_status = 'cancelled')
    or (new.from_status = 'cancelled' and new.to_status = 'published')
  )
  execute function private.notify_race_status_change();

revoke all on all functions in schema private from anon, authenticated;

commit;
