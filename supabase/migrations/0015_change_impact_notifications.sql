-- PLUKA V1 — Notification du coureur après un changement officiel
-- File target: supabase/migrations/0015_change_impact_notifications.sql
-- Référence : docs/engines/SOURCES_EXTRACTION.md §44, §46 ·
--             docs/00_PRODUCT_SPEC.md §35, §37 ·
--             docs/01_ARCHITECTURE.md §22.1, §22.2, §35 · docs/03_PRIVACY_RLS.md §35
--
-- PÉRIMÈTRE
--
-- §46 : « le Plan existant est marqué potentiellement impacté ; **le coureur
-- est informé** ». 0014 a produit les impacts ; ce fichier les fait suivre
-- d'une notification, par la file `pluka_email`.
--
-- UNE NOTIFICATION PAR CHANGEMENT, PAS PAR MODULE
--
-- Un changement d'heure de départ concerne le Plan, la Préparation et les
-- Conditions : trois impacts, et trois emails si l'on n'y prend garde. La
-- livraison est donc unique par couple (coureur, changement), et le message
-- énumère les modules. §46 veut que le coureur soit informé, pas assailli.
--
-- IDEMPOTENCE
--
-- Deux verrous, parce que la fenêtre entre « le provider a accepté » et « la
-- base le sait » ne se ferme pas toute seule :
--
--   1. la ligne de livraison porte une `idempotency_key` unique, et la
--      réclamer est un compare-and-set : un message pgmq qui revient trouve la
--      livraison déjà `sent` et ne fait rien ;
--   2. cette même clé part au fournisseur (contrat `EmailMessage`), qui
--      dédoublonne de son côté si le worker meurt entre l'envoi et l'écriture.
--
-- CE QUE LA LIVRAISON NE STOCKE PAS
--
-- Ni adresse, ni nom, ni contenu du message. Elle porte un participant et un
-- changement ; le destinataire se relit au moment de l'envoi. Une table de
-- suivi qui accumulerait des adresses deviendrait une seconde base de données
-- personnelles, sans que personne l'ait décidé.

begin;

-- ============================================================
-- 01. Les notifications atteignent leur file
-- ============================================================
-- `pluka_email` porte `email.send` — « invitation / notification | envoi »
-- (01_ARCHITECTURE §22).

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
    -- Groupement par domaine, pas une queue par type de job (0002).
    v_queue := case
      when v_event.event_type like 'gpx.%' then 'pluka_geo'
      when v_event.event_type like 'source.%' then 'pluka_sources'
      -- §44 : un changement de course descend vers les objets dépendants.
      when v_event.event_type like 'race.%' then 'pluka_plan'
      -- §46 : et le coureur concerné en est informé.
      when v_event.event_type like 'email.%' then 'pluka_email'
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
-- 02. Le registre des livraisons
-- ============================================================

create table private.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'email' check (channel in ('email')),
  kind text not null check (kind in ('race_change_impact')),
  participant_race_id uuid not null references public.participant_races(id) on delete cascade,
  change_event_id uuid not null references public.race_change_events(id) on delete cascade,
  -- §22.1 : la clé rend le rejeu inoffensif, et l'unicité la rend efficace.
  idempotency_key text not null unique,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  provider text,
  provider_message_id text,
  template_version text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  -- Une seule notification par coureur et par changement, quel que soit le
  -- nombre de modules concernés.
  unique (participant_race_id, change_event_id, kind)
);

create index ix_private_notification_deliveries_pending
  on private.notification_deliveries(status, created_at)
  where status in ('pending', 'sending');

revoke all on private.notification_deliveries from public, anon, authenticated;

comment on table private.notification_deliveries is
  'Suivi des notifications de §46. Ne stocke ni adresse ni contenu : le destinataire est relu au moment de l''envoi, pour ne pas constituer une seconde base de données personnelles.';

-- ============================================================
-- 03. L'analyse d'impact demande la notification
-- ============================================================
-- §22.2 : l'événement part dans la transaction qui l'a rendu vrai. La fonction
-- de 0014 est remplacée pour enchaîner, sans qu'aucun appelant ait à y penser.
--
-- La demande est enfilée **après** l'écriture des impacts, et seulement s'il y
-- en a : notifier un coureur que rien ne le concerne serait exactement le
-- bruit que §44 cherche à éviter.

create or replace function private.analyze_change_impact(p_change_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event record;
  v_category public.fact_category;
  v_modules text[];
  v_module text;
  v_dependent_plans boolean;
  v_created integer := 0;
  v_inserted integer;
  v_participant record;
  v_delivery_id uuid;
begin
  select ce.id, ce.race_id, ce.from_version_id, ce.to_version_id, ce.fact_id
  into v_event
  from public.race_change_events ce
  where ce.id = p_change_event_id;

  if not found then
    raise exception 'événement de changement introuvable' using errcode = 'no_data_found';
  end if;

  select f.category into v_category
  from public.race_facts f
  where f.id = v_event.fact_id;

  v_modules := private.impacted_modules(v_category);

  if array_length(v_modules, 1) is null then
    -- Rien à signaler : ce n'est pas un échec, c'est une analyse dont la
    -- conclusion est « personne n'est concerné ».
    return 0;
  end if;

  select exists (
    select 1
    from public.plan_version_dependencies d
    where d.race_fact_version_id = v_event.from_version_id
  ) into v_dependent_plans;

  foreach v_module in array v_modules
  loop
    insert into public.participant_change_impacts
      (change_event_id, participant_race_id, impacted_module)
    select v_event.id, pr.id, v_module
    from public.participant_races pr
    where pr.race_id = v_event.race_id
      and pr.status = 'active'
      and case v_module
        when 'plan' then
          case
            when v_dependent_plans then exists (
              select 1
              from public.race_plans rp
              join public.plan_version_dependencies d on d.race_plan_id = rp.id
              where rp.participant_race_id = pr.id
                and rp.status = 'active'
                and d.race_fact_version_id = v_event.from_version_id
            )
            else exists (
              select 1 from public.race_plans rp
              where rp.participant_race_id = pr.id and rp.status = 'active'
            )
          end
        when 'nutrition' then exists (
          select 1
          from public.nutrition_plans np
          join public.race_plans rp on rp.id = np.race_plan_id
          where rp.participant_race_id = pr.id and rp.status = 'active' and np.enabled
        )
        when 'assistance' then exists (
          select 1 from public.race_assistants ra
          where ra.participant_race_id = pr.id and ra.status = 'active'
        )
        when 'conditions' then exists (
          select 1 from public.race_plans rp
          where rp.participant_race_id = pr.id and rp.status = 'active'
        )
        else true
      end
    on conflict (change_event_id, participant_race_id, impacted_module) do nothing;

    get diagnostics v_inserted = row_count;
    v_created := v_created + v_inserted;
  end loop;

  -- ---------------------------------------------------------
  -- §46 — le coureur est informé
  -- ---------------------------------------------------------
  -- Une livraison par coureur concerné, pas par impact. Un coureur sans compte
  -- — invité mais jamais activé — n'a pas d'adresse à qui écrire : il verra
  -- l'impact dans l'application quand il la rejoindra.
  for v_participant in
    select distinct i.participant_race_id
    from public.participant_change_impacts i
    join public.participant_races pr on pr.id = i.participant_race_id
    where i.change_event_id = v_event.id
      and pr.user_id is not null
  loop
    insert into private.notification_deliveries
      (kind, participant_race_id, change_event_id, idempotency_key)
    values (
      'race_change_impact',
      v_participant.participant_race_id,
      v_event.id,
      'race_change_impact:' || v_event.id::text || ':' || v_participant.participant_race_id::text
    )
    on conflict (participant_race_id, change_event_id, kind) do nothing
    returning id into v_delivery_id;

    -- Une livraison déjà créée par un tour précédent ne réenfile rien :
    -- rejouer l'analyse ne doit pas produire un second email.
    if v_delivery_id is not null then
      insert into private.outbox_events
        (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
      values (
        'email.send',
        'notification_delivery',
        v_delivery_id,
        jsonb_build_object(
          'deliveryId', v_delivery_id,
          'kind', 'race_change_impact',
          'idempotencyKey', 'email.send:' || v_delivery_id::text
        ),
        'email.send:' || v_delivery_id::text
      )
      on conflict (idempotency_key) do nothing;
    end if;
  end loop;

  return v_created;
end;
$$;

comment on function private.analyze_change_impact is
  'Impact Analyzer de §44, et demande de notification de §46 dans la même transaction (§22.2). Ne touche à aucun objet downstream (§46).';

-- ============================================================
-- 04. Réclamer une livraison
-- ============================================================
-- Compare-and-set : la livraison passe de `pending` / `failed` à `sending` et
-- rend de quoi écrire le message. Une livraison déjà `sent` n'est pas rendue —
-- c'est ce qui rend le rejeu d'un message pgmq inoffensif.
--
-- Les données personnelles rendues ici sont celles du destinataire, et rien
-- d'autre : adresse, prénom, langue. Le nom de course et le titre du
-- changement sont des informations de course.

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
  join public.race_change_events ce on ce.id = v_delivery.change_event_id
  where pr.id = v_delivery.participant_race_id;
end;
$$;

create or replace function private.complete_notification_delivery(
  p_delivery_id uuid,
  p_provider text,
  p_provider_message_id text,
  p_template_version text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.notification_deliveries
  set status = 'sent',
      sent_at = now(),
      provider = p_provider,
      provider_message_id = p_provider_message_id,
      template_version = p_template_version,
      last_error = null
  where id = p_delivery_id;
$$;

create or replace function private.fail_notification_delivery(p_delivery_id uuid, p_error text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  -- §35 : « l'invitation reste persistée et le job est retenté ». Une
  -- livraison en échec redevient `pending` tant qu'il reste des tentatives ;
  -- au-delà elle reste `failed`, et l'impact demeure lisible dans
  -- l'application. Rien n'est perdu en silence.
  update private.notification_deliveries
  set status = case when attempts >= max_attempts then 'failed' else 'pending' end,
      last_error = left(p_error, 500)
  where id = p_delivery_id
  returning status into v_status;

  return v_status;
end;
$$;

-- ============================================================
-- 05. Surface d'appel du worker
-- ============================================================

create or replace function public.worker_claim_notification(p_delivery_id uuid)
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
language sql
security definer
set search_path = ''
as $$
  select * from private.claim_notification_delivery(p_delivery_id);
$$;

create or replace function public.worker_complete_notification(
  p_delivery_id uuid,
  p_provider text,
  p_provider_message_id text,
  p_template_version text
)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.complete_notification_delivery(
    p_delivery_id, p_provider, p_provider_message_id, p_template_version);
$$;

create or replace function public.worker_fail_notification(p_delivery_id uuid, p_error text)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.fail_notification_delivery(p_delivery_id, p_error);
$$;

-- Lecture réservée au diagnostic et aux tests. Elle rend un statut, jamais une
-- adresse ni un contenu.
create or replace function public.worker_read_notifications(p_change_event_id uuid)
returns table (
  delivery_id uuid,
  participant_race_id uuid,
  status text,
  attempts integer,
  provider text,
  template_version text,
  last_error text
)
language sql
security definer
set search_path = ''
as $$
  select d.id, d.participant_race_id, d.status, d.attempts, d.provider,
         d.template_version, d.last_error
  from private.notification_deliveries d
  where d.change_event_id = p_change_event_id
  order by d.created_at;
$$;

do $do$
declare
  f text;
  signatures text[] := array[
    'public.worker_claim_notification(uuid)',
    'public.worker_complete_notification(uuid, text, text, text)',
    'public.worker_fail_notification(uuid, text)',
    'public.worker_read_notifications(uuid)'
  ];
begin
  foreach f in array signatures loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$do$;

revoke all on all functions in schema private from anon, authenticated;

commit;
