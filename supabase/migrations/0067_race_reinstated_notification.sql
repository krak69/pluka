-- PLUKA V1 — Rétablir une course annulée
-- File target: supabase/migrations/0067_race_reinstated_notification.sql
-- Référence : docs/00_PRODUCT_SPEC.md §4.1
--
-- POURQUOI
--
-- Une annulation peut être une erreur, ou être levée. §4.1 autorise désormais
-- `cancelled → published` et veut que les participants en soient avertis.
-- Le coureur qui s'était réorganisé ne doit pas découvrir seul que sa course
-- a lieu.
--
-- LA DEMANDE PART DANS LA TRANSACTION
--
-- Le trigger est posé sur le journal des statuts : c'est lui qui dit qu'une
-- transition a eu lieu, quel que soit le chemin qui l'a produite (§22.2). Une
-- nouvelle ligne de journal donne une nouvelle livraison : annuler puis
-- rétablir une seconde fois mérite un second message, rejouer un envoi non.
--
-- QUI EST AVERTI
--
-- Les mêmes que pour un changement officiel : un compte actif sur la course,
-- qui n'a pas coupé ses notifications. Un participant retiré (`archived`) n'est
-- plus concerné, et une ligne importée jamais activée n'a pas consenti à
-- recevoir des emails de PLUKA.

begin;

-- ============================================================
-- 01. Une livraison porte un changement officiel, ou un rétablissement
-- ============================================================

alter table private.notification_deliveries
  drop constraint notification_deliveries_kind_check,
  add constraint notification_deliveries_kind_check
    check (kind in ('race_change_impact', 'race_reinstated'));

alter table private.notification_deliveries
  alter column change_event_id drop not null,
  add column race_transition_id uuid
    references public.race_status_transitions(id) on delete cascade,
  add constraint notification_deliveries_subject_check check (
    (kind = 'race_change_impact' and change_event_id is not null and race_transition_id is null)
    or (kind = 'race_reinstated' and change_event_id is null and race_transition_id is not null)
  ),
  add constraint notification_deliveries_transition_key
    unique (participant_race_id, race_transition_id, kind);

comment on column private.notification_deliveries.race_transition_id is
  'La transition cancelled → published que la livraison annonce. Nulle pour un changement officiel.';

-- ============================================================
-- 02. Le rétablissement demande la notification
-- ============================================================

create function private.notify_race_reinstated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant record;
  v_delivery_id uuid;
begin
  for v_participant in
    select pr.id
    from public.participant_races pr
    left join public.participant_race_settings s on s.participant_race_id = pr.id
    where pr.race_id = new.race_id
      and pr.user_id is not null
      and pr.status = 'active'
      and coalesce(s.notifications_enabled, true)
  loop
    insert into private.notification_deliveries
      (kind, participant_race_id, race_transition_id, idempotency_key)
    values (
      'race_reinstated',
      v_participant.id,
      new.id,
      'race_reinstated:' || new.id::text || ':' || v_participant.id::text
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
          'kind', 'race_reinstated',
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

comment on function private.notify_race_reinstated() is
  'Demande de notification quand une course annulée est rétablie (§4.1), dans la transaction de la transition (§22.2).';

create trigger race_reinstated_notifies
  after insert on public.race_status_transitions
  for each row
  when (new.from_status = 'cancelled' and new.to_status = 'published')
  execute function private.notify_race_reinstated();

-- ============================================================
-- 03. La réclamation accepte une livraison sans changement officiel
-- ============================================================
-- Fonction de 0015, à une jointure près : un rétablissement n'a ni titre, ni
-- sévérité, ni modules. Le worker choisit le gabarit d'après le message.

create or replace function private.claim_notification_delivery(p_delivery_id uuid)
returns table (
  delivery_id uuid,
  already_sent boolean,
  attempts integer,
  max_attempts integer,
  idempotency_key text,
  recipient_email text,
  recipient_first_name text,
  locale text,
  event_name text,
  race_name text,
  race_id uuid,
  change_title text,
  severity public.change_severity,
  modules text[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery record;
begin
  select d.* into v_delivery
  from private.notification_deliveries d
  where d.id = p_delivery_id
  for update;

  if not found then
    raise exception 'livraison introuvable' using errcode = 'no_data_found';
  end if;

  if v_delivery.status = 'sent' then
    return query select v_delivery.id, true, v_delivery.attempts, v_delivery.max_attempts,
      v_delivery.idempotency_key, null::text, null::text, null::text, null::text, null::text,
      null::uuid, null::text, null::public.change_severity, null::text[];
    return;
  end if;

  -- Les colonnes de sortie de `returns table` sont aussi des variables
  -- PL/pgSQL : `attempts` désignerait à la fois la colonne et la variable.
  -- L'alias lève l'ambiguïté.
  update private.notification_deliveries d
  set status = 'sending', attempts = d.attempts + 1
  where d.id = p_delivery_id;

  return query
  select
    v_delivery.id,
    false,
    v_delivery.attempts + 1,
    v_delivery.max_attempts,
    v_delivery.idempotency_key,
    u.email::text,
    u.first_name,
    u.locale::text,
    e.name,
    r.name,
    r.id,
    ce.title,
    ce.severity,
    array(
      select i.impacted_module
      from public.participant_change_impacts i
      where i.change_event_id = v_delivery.change_event_id
        and i.participant_race_id = v_delivery.participant_race_id
      order by i.impacted_module
    )
  from public.participant_races pr
  join public.users u on u.id = pr.user_id
  join public.races r on r.id = pr.race_id
  join public.editions ed on ed.id = r.edition_id
  join public.events e on e.id = ed.event_id
  left join public.race_change_events ce on ce.id = v_delivery.change_event_id
  where pr.id = v_delivery.participant_race_id;
end;
$$;

revoke all on all functions in schema private from anon, authenticated;

commit;
