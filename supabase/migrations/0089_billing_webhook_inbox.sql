-- PLUKA V1 — Le webhook de paiement passe par le worker
-- File target: supabase/migrations/0089_billing_webhook_inbox.sql
-- Référence : docs/01_ARCHITECTURE.md §28.1, §31 · docs/03_PRIVACY_RLS.md §8 · 0088
--
-- POURQUOI
--
-- L'application web n'emploie jamais la clé de service (03_PRIVACY_RLS §8,
-- apps/app/tests/no-direct-sql.test.ts). Le webhook du prestataire ne peut
-- donc pas confirmer un paiement depuis son Route Handler. Il dépose la
-- livraison telle quelle — corps brut, signature — et c'est le worker, seul
-- détenteur de la clé, qui vérifie la signature avec l'adaptateur du
-- prestataire, puis confirme (0088).
--
-- Déposer ne décide rien : la boîte accepte n'importe quelle livraison, que le
-- worker rejette si la signature ne tient pas. Les tailles sont bornées, et le
-- dépôt suit le même chemin que tout effet asynchrone : outbox, puis file.

begin;

-- ============================================================
-- 1. La file du domaine paiement
-- ============================================================

do $$
begin
  if not exists (select 1 from pgmq.list_queues() where queue_name = 'pluka_billing') then
    perform pgmq.create('pluka_billing');
  end if;
end
$$;

create or replace function private.dispatch_outbox_events(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event record;
  v_queue text;
  v_dispatched integer := 0;
begin
  for v_event in
    select id, event_type, payload
    from private.outbox_events
    where status = 'pending' and available_at <= now()
    order by created_at
    limit p_limit
    for update skip locked
  loop
    -- Groupement par domaine, pas une queue par type de job (0002). Toute
    -- redéfinition future doit garder ces lignes : le test pgTAP 23 les
    -- vérifie une à une.
    v_queue := case
      when v_event.event_type like 'gpx.%' then 'pluka_geo'
      -- Le référentiel de parcours nourrit le même prétraitement que le GPX (0025).
      when v_event.event_type like 'course.%' then 'pluka_geo'
      when v_event.event_type like 'source.%' then 'pluka_sources'
      -- §44 : un changement de course descend vers les objets dépendants (0014).
      when v_event.event_type like 'race.%' then 'pluka_plan'
      -- §46 et 0033 : notifications et invitations d'équipe (0015).
      when v_event.event_type like 'email.%' then 'pluka_email'
      -- §28.1 : le webhook de paiement, vérifié et appliqué par le worker (0089).
      when v_event.event_type like 'billing.%' then 'pluka_billing'
      else null
    end;

    if v_queue is null then
      -- Un événement sans destination n'est pas une panne du dispatcher :
      -- il est marqué et laissé visible, plutôt que réessayé en boucle.
      update private.outbox_events
      set status = 'failed',
          attempts = attempts + 1,
          last_error = 'aucune queue pour ' || v_event.event_type
      where id = v_event.id;
      continue;
    end if;

    perform pgmq.send(v_queue, v_event.payload);

    update private.outbox_events
    set status = 'published', published_at = now(), attempts = attempts + 1
    where id = v_event.id;

    v_dispatched := v_dispatched + 1;
  end loop;

  return v_dispatched;
end;
$$;

-- ============================================================
-- 2. La boîte de réception
-- ============================================================

create table private.billing_webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider ~ '^[a-z][a-z0-9_-]{1,39}$'),
  raw_body text not null check (octet_length(raw_body) <= 65536),
  signature text not null check (octet_length(signature) <= 2048),
  status text not null default 'received'
    check (status in ('received', 'processed', 'rejected')),
  -- Ce que la base a répondu (`granted`, `duplicate`…) ou le motif du rejet.
  result text check (result is null or char_length(result) <= 80),
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index ix_private_billing_webhook_inbox_status
  on private.billing_webhook_inbox(status, received_at);

comment on table private.billing_webhook_inbox is
  'Livraisons brutes du webhook de paiement, déposées par le Route Handler et appliquées par le worker après vérification de la signature (0089). Le corps brut est gardé tel quel : la signature se vérifie dessus.';

-- Le Route Handler n'a aucune session : le prestataire ne s'authentifie que par sa signature.
create function public.billing_receive_webhook(p_provider text, p_raw_body text, p_signature text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into private.billing_webhook_inbox (provider, raw_body, signature)
  values (p_provider, p_raw_body, coalesce(p_signature, ''))
  returning id into v_id;

  insert into private.outbox_events (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
  values ('billing.webhook_received', 'billing_webhook', v_id,
          jsonb_build_object('billingWebhookId', v_id), 'billing.webhook_received:' || v_id);

  return v_id;
end;
$$;

-- ============================================================
-- 3. Le worker
-- ============================================================

create function public.worker_claim_billing_webhook(p_id uuid)
returns table (provider text, raw_body text, signature text)
language sql security definer set search_path = '' as $$
  select i.provider, i.raw_body, i.signature
  from private.billing_webhook_inbox i
  where i.id = p_id and i.status = 'received'
$$;

create function public.worker_settle_billing_webhook(p_id uuid, p_status text, p_result text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('processed', 'rejected') then
    raise exception 'issue inconnue' using errcode = '22023';
  end if;

  update private.billing_webhook_inbox
  set status = p_status, result = left(p_result, 80), processed_at = now()
  where id = p_id and status = 'received';
end;
$$;

revoke all on function public.billing_receive_webhook(text, text, text) from public;
grant execute on function public.billing_receive_webhook(text, text, text) to anon, authenticated;

revoke all on function public.worker_claim_billing_webhook(uuid) from public, anon, authenticated;
revoke all on function public.worker_settle_billing_webhook(uuid, text, text) from public, anon, authenticated;
grant execute on function public.worker_claim_billing_webhook(uuid) to service_role;
grant execute on function public.worker_settle_billing_webhook(uuid, text, text) to service_role;

commit;
