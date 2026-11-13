-- PLUKA V1 — Acheter un Race Pass : offre, achat, confirmation
-- File target: supabase/migrations/0088_race_pass_checkout.sql
-- Référence : docs/00_PRODUCT_SPEC.md §6.2, §6.5 · docs/04_ENTITLEMENTS.md §26, §70 à §73.1
--             docs/01_ARCHITECTURE.md §28.1 · 05_ROUTES_FLOWS §12.8
--
-- POURQUOI
--
-- Le paiement est l'aboutissement de l'early bird : le prix dépend du moment de
-- l'achat (§6.5.2), la vente est attribuée à l'organisation dont le coureur a
-- suivi le lien (§73.1), et un Race Pass déjà accordé par le canal B interdit
-- un second achat (§70, E47).
--
-- Le prestataire n'est pas choisi. Ce qui suit ne dépend d'aucun : le domaine
-- crée l'achat, un adaptateur ouvre la page de paiement hébergée, et seul un
-- webhook vérifié confirme le paiement et crée le droit (§28.1).
--
-- Règles :
--
--   - les prix vivent dans `billing_products`, jamais dans le code (§72) ;
--   - le produit applicable (`race_pass` ou `race_pass_early`) est décidé ici,
--     par la base, à l'heure de la base : le client ne transmet ni prix, ni
--     date, ni éligibilité (§72.1). Le domaine applique la même règle pour
--     l'affichage ; les tests des deux côtés fixent les mêmes bornes ;
--   - un seul achat en attente par participation : un second clic reprend le
--     premier ;
--   - le webhook est idempotent par identifiant d'événement : rejoué, il ne
--     crée rien (AC-BILL-02) ;
--   - un paiement confirmé sur une participation déjà couverte n'écrase rien :
--     l'achat est marqué en conflit, à rembourser.

begin;

-- ============================================================
-- 1. Le catalogue
-- ============================================================

create table public.billing_products (
  product_key text primary key check (product_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  kind public.entitlement_kind not null,
  label text not null check (char_length(label) between 1 and 80),
  -- Montant TTC en centimes (§6.5.6).
  amount_minor integer not null check (amount_minor >= 0),
  currency character(3) not null default 'EUR' check (currency = upper(currency)),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.billing_products is
  'Catalogue commercial (§72) : prix TTC par clé produit. Le domaine ne connaît que les clés. Lu par les fonctions de 0088 seulement.';

alter table public.billing_products enable row level security;
revoke all on table public.billing_products from anon, authenticated;

create trigger trg_billing_products_updated_at
  before update on public.billing_products
  for each row execute function private.set_updated_at();

-- Prix de référence après la phase de test (00_PRODUCT_SPEC §6.2, §6.3, §6.5.2).
insert into public.billing_products (product_key, kind, label, amount_minor) values
  ('race_pass', 'race_pass', 'Race Pass', 1490),
  ('race_pass_early', 'race_pass', 'Race Pass — tarif inscrit', 990),
  ('plus_annual', 'plus', 'PLUKA+ annuel', 4490);

-- ============================================================
-- 2. L'achat : canal et attribution
-- ============================================================

alter table public.purchases
  add column channel text not null default 'app' check (channel in ('app', 'organizer_link')),
  add column organization_id uuid references public.organizations(id) on delete set null,
  add column referral_code_id uuid references public.organization_referral_codes(id) on delete set null,
  add constraint purchases_channel_attributed
    check (channel = 'app' or organization_id is not null);

create unique index ux_purchases_pending_race_pass
  on public.purchases(participant_race_id)
  where status = 'pending' and participant_race_id is not null;

comment on column public.purchases.channel is
  'app ou organizer_link (§73.1) : la vente est attribuée à l''organisation dont le coureur a suivi le lien. Le prix n''en dépend jamais.';

-- ============================================================
-- 3. La règle du tarif, côté base
-- ============================================================

-- Même règle que packages/domain/src/billing/early-bird.ts : 15 jours civils
-- dans le fuseau de la course, le dernier en entier (décision du 2026-11-12),
-- et au moins 60 jours avant le départ.
create function private.race_pass_early_ends_before(p_participant_race_id uuid)
returns timestamptz
language sql stable security definer set search_path = '' as $$
  select least(
    ((coalesce(pr.registered_on, (pr.created_at at time zone r.timezone)::date) + 16)::timestamp
       at time zone r.timezone),
    r.start_datetime - interval '60 days' + interval '1 millisecond'
  )
  from public.participant_races pr
  join public.races r on r.id = pr.race_id
  where pr.id = p_participant_race_id
$$;

-- Ce qui couvre déjà la participation : un Race Pass, l'accès inclus, ou PLUKA+.
create function private.race_pass_coverage(p_participant_race_id uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (
      select 1 from public.entitlements e
      where e.participant_race_id = p_participant_race_id and e.status = 'active'
        and e.kind = 'race_pass' and (e.ends_at is null or e.ends_at > now()))
      then 'race_pass'
    when exists (
      select 1 from public.entitlements e
      where e.participant_race_id = p_participant_race_id and e.status = 'active'
        and e.kind = 'organizer_included' and (e.ends_at is null or e.ends_at > now()))
      then 'organizer_included'
    when exists (
      select 1 from public.entitlements e
      join public.participant_races pr on pr.user_id = e.user_id
      where pr.id = p_participant_race_id and e.status = 'active'
        and e.kind = 'plus' and (e.ends_at is null or e.ends_at > now()))
      then 'plus'
  end
$$;

-- ============================================================
-- 4. L'offre, pour le coureur
-- ============================================================

create function public.get_race_pass_offer(p_participant_race_id uuid)
returns table (
  coverage text,
  registration_day date,
  registration_origin text,
  race_start timestamptz,
  race_timezone text,
  standard_amount_minor integer,
  early_amount_minor integer,
  currency text,
  pending_purchase_id uuid
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.participant_races pr
    where pr.id = p_participant_race_id and pr.user_id = (select auth.uid())
  ) then
    raise exception 'participation introuvable' using errcode = 'P0002';
  end if;

  return query
  select
    private.race_pass_coverage(pr.id),
    coalesce(pr.registered_on, (pr.created_at at time zone r.timezone)::date),
    case when pr.registered_on is null then 'declared' else 'verified' end,
    r.start_datetime,
    r.timezone::text,
    (select p.amount_minor from public.billing_products p where p.product_key = 'race_pass' and p.active),
    (select p.amount_minor from public.billing_products p where p.product_key = 'race_pass_early' and p.active),
    (select p.currency::text from public.billing_products p where p.product_key = 'race_pass'),
    (select pu.id from public.purchases pu
     where pu.participant_race_id = pr.id and pu.status = 'pending')
  from public.participant_races pr
  join public.races r on r.id = pr.race_id
  where pr.id = p_participant_race_id;
end;
$$;

-- ============================================================
-- 5. Commencer un achat
-- ============================================================

create function public.start_race_pass_purchase(p_participant_race_id uuid, p_provider text)
returns table (purchase_id uuid, product_key text, amount_minor integer, currency text, reused boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_participation public.participant_races%rowtype;
  v_product public.billing_products%rowtype;
  v_existing public.purchases%rowtype;
  v_code public.organization_referral_codes%rowtype;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'connexion requise' using errcode = '42501';
  end if;

  select * into v_participation from public.participant_races pr
  where pr.id = p_participant_race_id and pr.user_id = v_user
  for update;

  if not found then
    raise exception 'participation introuvable' using errcode = 'P0002';
  end if;

  -- §70, §74, §75 : rien à vendre sur une course déjà couverte.
  if private.race_pass_coverage(p_participant_race_id) is not null then
    raise exception 'course déjà couverte (%)', private.race_pass_coverage(p_participant_race_id)
      using errcode = '23505';
  end if;

  -- Un second clic reprend l'achat en cours, au prix décidé la première fois.
  select * into v_existing from public.purchases pu
  where pu.participant_race_id = p_participant_race_id and pu.status = 'pending';

  if found then
    return query select v_existing.id, v_existing.product_key, v_existing.amount_minor,
      v_existing.currency::text, true;
    return;
  end if;

  -- §72.1 : le produit se décide ici, à l'heure de la base.
  select * into v_product from public.billing_products p
  where p.active and p.product_key = case
    when now() < private.race_pass_early_ends_before(p_participant_race_id) then 'race_pass_early'
    else 'race_pass'
  end;

  if not found then
    raise exception 'produit indisponible' using errcode = '55000';
  end if;

  -- §73.1 : la vente revient à l'organisation dont le coureur a suivi le lien.
  if v_participation.referral_code_id is not null then
    select * into v_code from public.organization_referral_codes c
    where c.id = v_participation.referral_code_id;
  end if;

  insert into public.purchases
    (user_id, product_key, participant_race_id, provider, status, amount_minor, currency,
     channel, organization_id, referral_code_id)
  values
    (v_user, v_product.product_key, p_participant_race_id, left(p_provider, 40), 'pending',
     v_product.amount_minor, v_product.currency,
     case when v_code.id is null then 'app' else 'organizer_link' end,
     v_code.organization_id, v_code.id)
  returning id into v_id;

  return query select v_id, v_product.product_key, v_product.amount_minor,
    v_product.currency::text, false;
end;
$$;

-- La référence de la session de paiement, posée une fois par l'achat qui l'a ouverte.
create function public.set_purchase_checkout_reference(p_purchase_id uuid, p_reference text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.purchases pu
  set provider_checkout_reference = left(p_reference, 200)
  where pu.id = p_purchase_id
    and pu.user_id = (select auth.uid())
    and pu.status = 'pending';

  if not found then
    raise exception 'achat introuvable' using errcode = 'P0002';
  end if;
end;
$$;

-- L'état d'un achat, pour l'écran de retour du paiement.
create function public.get_my_purchase(p_purchase_id uuid)
returns table (
  status text,
  product_key text,
  amount_minor integer,
  currency text,
  participant_race_id uuid,
  conflict boolean,
  provider text,
  provider_checkout_reference text
)
language sql stable security definer set search_path = '' as $$
  select pu.status::text, pu.product_key, pu.amount_minor, pu.currency::text,
    pu.participant_race_id, coalesce((pu.metadata ->> 'conflict')::boolean, false),
    pu.provider, pu.provider_checkout_reference
  from public.purchases pu
  where pu.id = p_purchase_id and pu.user_id = (select auth.uid())
$$;

-- ============================================================
-- 6. La confirmation, par le webhook vérifié
-- ============================================================

create function public.billing_record_checkout_event(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_payload_hash text,
  p_checkout_reference text,
  p_payment_reference text,
  p_outcome text,
  p_occurred_at timestamptz
)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_event uuid;
  v_purchase public.purchases%rowtype;
  v_product public.billing_products%rowtype;
  v_entitlement uuid;
begin
  if p_outcome not in ('paid', 'failed', 'cancelled') then
    raise exception 'issue de paiement inconnue' using errcode = '22023';
  end if;

  -- AC-BILL-02 : un événement rejoué ne crée rien.
  insert into private.billing_webhook_events (provider, provider_event_id, event_type, payload_hash)
  values (p_provider, p_event_id, p_event_type, p_payload_hash)
  on conflict (provider, provider_event_id) do nothing
  returning id into v_event;

  if v_event is null then
    return 'duplicate';
  end if;

  select * into v_purchase from public.purchases pu
  where pu.provider = p_provider and pu.provider_checkout_reference = p_checkout_reference
  for update;

  if not found then
    update private.billing_webhook_events
    set status = 'ignored', processed_at = now(), error_code = 'PURCHASE_UNKNOWN'
    where id = v_event;
    return 'unknown_purchase';
  end if;

  if v_purchase.status <> 'pending' then
    update private.billing_webhook_events
    set status = 'ignored', processed_at = now(), error_code = 'PURCHASE_NOT_PENDING'
    where id = v_event;
    return 'already_settled';
  end if;

  if p_outcome <> 'paid' then
    update public.purchases set status = p_outcome::public.purchase_status where id = v_purchase.id;
    update private.billing_webhook_events set status = 'processed', processed_at = now() where id = v_event;
    return p_outcome;
  end if;

  select * into v_product from public.billing_products p where p.product_key = v_purchase.product_key;

  -- §70 : un seul Race Pass actif par participation. Si un autre canal l'a
  -- accordé entre-temps, le paiement est gardé et signalé : à rembourser.
  insert into public.entitlements
    (kind, source, status, scope_type, user_id, participant_race_id, external_reference, metadata)
  values
    (v_product.kind, 'purchase', 'active', 'participant_race', v_purchase.user_id,
     v_purchase.participant_race_id, v_purchase.id::text,
     jsonb_build_object('purchaseId', v_purchase.id, 'productKey', v_purchase.product_key))
  on conflict do nothing
  returning id into v_entitlement;

  update public.purchases
  set status = 'paid',
      paid_at = coalesce(p_occurred_at, now()),
      provider_payment_reference = left(p_payment_reference, 200),
      entitlement_id = v_entitlement,
      metadata = case when v_entitlement is null
        then metadata || jsonb_build_object('conflict', true) else metadata end
  where id = v_purchase.id;

  update private.billing_webhook_events set status = 'processed', processed_at = now() where id = v_event;

  perform private.record_audit(
    case when v_entitlement is null then 'purchase.conflict' else 'purchase.paid' end,
    'purchases', v_purchase.id,
    jsonb_build_object('productKey', v_purchase.product_key, 'channel', v_purchase.channel)
  );

  return case when v_entitlement is null then 'conflict' else 'granted' end;
end;
$$;

-- ============================================================
-- 7. Droits d'exécution
-- ============================================================

revoke all on function private.race_pass_early_ends_before(uuid) from public, anon, authenticated;
revoke all on function private.race_pass_coverage(uuid) from public, anon, authenticated;

revoke all on function public.get_race_pass_offer(uuid) from public, anon;
revoke all on function public.start_race_pass_purchase(uuid, text) from public, anon;
revoke all on function public.set_purchase_checkout_reference(uuid, text) from public, anon;
revoke all on function public.get_my_purchase(uuid) from public, anon;
grant execute on function public.get_race_pass_offer(uuid) to authenticated;
grant execute on function public.start_race_pass_purchase(uuid, text) to authenticated;
grant execute on function public.set_purchase_checkout_reference(uuid, text) to authenticated;
grant execute on function public.get_my_purchase(uuid) to authenticated;

-- Le webhook, et lui seul : appelé par le Route Handler après vérification de la signature.
revoke all on function public.billing_record_checkout_event(text, text, text, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.billing_record_checkout_event(text, text, text, text, text, text, text, timestamptz)
  to service_role;

commit;
