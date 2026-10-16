-- PLUKA V1 — Le site de l'événement : formulaire de contact et documents diffusés
-- File target: supabase/migrations/0052_event_site_contact_and_documents.sql
-- Référence : docs/features/EVENT_SITE.md §3.4, §6 · migrations 0033, 0049 · AGENTS §31, §32, §33
--
-- DÉCISION PRODUIT DU 2026-10-16
--
-- Le message du formulaire part par le worker, comme les invitations
-- d'équipe : ni clé de service ni clé d'e-mail dans l'app. Le site dépose le
-- message dans une file privée ; le worker l'envoie à l'adresse de contact de
-- l'événement, `Reply-To` au coureur, puis en efface le contenu. Le contenu
-- n'existe en base que le temps de l'envoi ; la trace de 0049, sans contenu,
-- reste pour la limite de débit.
--
-- 0049 prévoyait une réservation appelée par le serveur sous clé de service
-- (`claim_event_site_contact`, `finish_event_site_contact`). Elle n'a plus
-- d'appelant : elle est retirée.
--
-- L'EMPREINTE D'IP
--
-- Calculée ici, avec un sel tiré par la base et changé chaque jour : l'app ne
-- tient aucun secret, et une empreinte d'hier ne se recoupe pas avec celle
-- d'aujourd'hui. L'adresse IP vient de l'app (en-tête de la requête) : un
-- appel direct à la fonction peut la falsifier et contourner la limite par
-- empreinte, pas la limite par événement.
--
-- LES DOCUMENTS
--
-- Un document diffusé (0049) se télécharge par une URL signée. La signer
-- demande de lire l'objet : une policy ouvre la lecture des seuls fichiers de
-- `race-sources` qui sont ceux d'un document diffusé d'un site en ligne.

begin;

drop function if exists public.claim_event_site_contact(uuid, text, interval, integer, integer);
drop function if exists public.finish_event_site_contact(bigint, text);
drop function if exists public.purge_event_site_contact_attempts(interval);

-- ============================================================
-- 01. Le sel du jour
-- ============================================================

create table private.event_site_contact_salts (
  day date primary key,
  salt bytea not null default extensions.gen_random_bytes(32)
);

comment on table private.event_site_contact_salts is
  'Sel des empreintes d''IP du formulaire de contact, un par jour, gardé deux jours.';

create or replace function private.contact_ip_hash(p_client_ip text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_salt bytea;
begin
  insert into private.event_site_contact_salts (day) values (current_date)
  on conflict (day) do nothing;

  select s.salt into v_salt from private.event_site_contact_salts s where s.day = current_date;

  return encode(
    extensions.digest(convert_to(coalesce(nullif(btrim(p_client_ip), ''), 'inconnue'), 'UTF8') || v_salt, 'sha256'),
    'hex');
end;
$$;

-- ============================================================
-- 02. La file des messages
-- ============================================================

create table private.event_site_contact_messages (
  id uuid primary key default gen_random_uuid(),
  attempt_id bigint not null references private.event_site_contact_attempts(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  race_id uuid references public.races(id) on delete set null,
  sender_name text not null check (char_length(btrim(sender_name)) between 1 and 120),
  sender_email extensions.citext not null check (
    char_length(sender_email) <= 254 and sender_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  send_attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);

comment on table private.event_site_contact_messages is
  'Messages du formulaire de contact en attente d''envoi. Le worker les efface une fois envoyés ou abandonnés (EVENT_SITE §6.2).';

/*
 * Envoyer un message depuis le site — visiteur anonyme ou connecté.
 *
 * Rend `sent` si le message est en file, `limited` si la limite de débit est
 * atteinte. Rien en ligne à cette adresse, ou pas d'adresse de contact :
 * `P0002`, sans dire lequel.
 *
 * Limites : 5 messages par heure et par empreinte, 50 par heure et par
 * événement. Seuils anti-abus, pas règle produit : ils se règlent ici.
 */
create or replace function public.submit_event_site_contact(
  p_slug text,
  p_client_ip text,
  p_sender_name text,
  p_sender_email text,
  p_race_slug text,
  p_body text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_window constant interval := interval '1 hour';
  c_max_per_ip constant integer := 5;
  c_max_per_event constant integer := 50;
  v_event_id uuid;
  v_race_id uuid;
  v_ip_hash text;
  v_attempt_id bigint;
  v_message_id uuid;
begin
  select e.id into v_event_id
  from public.events e
  join public.event_sites s on s.event_id = e.id
  where e.slug = lower(btrim(p_slug)) and s.contact_email is not null;

  if v_event_id is null or not private.event_site_is_public(v_event_id) then
    raise exception 'site introuvable' using errcode = 'P0002';
  end if;

  if nullif(btrim(p_race_slug), '') is not null then
    select r.id into v_race_id
    from public.races r
    join public.editions ed on ed.id = r.edition_id
    where ed.event_id = v_event_id
      and r.slug = btrim(p_race_slug)
      and private.race_is_publicly_readable(r.id)
    order by ed.start_date desc
    limit 1;
  end if;

  -- Ménage au passage : rien de ce formulaire ne se garde longtemps.
  delete from private.event_site_contact_messages m where m.created_at < now() - interval '7 days';
  delete from private.event_site_contact_attempts a where a.created_at < now() - interval '30 days';
  delete from private.event_site_contact_salts s where s.day < current_date - 1;

  v_ip_hash := private.contact_ip_hash(p_client_ip);

  perform pg_advisory_xact_lock(hashtextextended('event_site_contact:' || v_event_id::text, 0));

  if (select count(*) from private.event_site_contact_attempts a
      where a.ip_hash = v_ip_hash and a.created_at > now() - c_window) >= c_max_per_ip
    or (select count(*) from private.event_site_contact_attempts a
        where a.event_id = v_event_id and a.created_at > now() - c_window) >= c_max_per_event then
    return 'limited';
  end if;

  insert into private.event_site_contact_attempts (event_id, ip_hash)
  values (v_event_id, v_ip_hash)
  returning id into v_attempt_id;

  insert into private.event_site_contact_messages
    (attempt_id, event_id, race_id, sender_name, sender_email, body)
  values (v_attempt_id, v_event_id, v_race_id, btrim(p_sender_name), btrim(p_sender_email), btrim(p_body))
  returning id into v_message_id;

  insert into private.outbox_events
    (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
  values (
    'email.event_site_contact',
    'event_site_contact',
    v_message_id,
    jsonb_build_object('contactMessageId', v_message_id),
    'email.event_site_contact:' || v_message_id
  );

  return 'sent';
end;
$$;

-- ============================================================
-- 03. Le worker envoie, puis efface
-- ============================================================

/*
 * Le message à envoyer, ou `sendable = false` s'il n'existe plus (déjà
 * envoyé, abandonné, effacé) : un message pgmq rejoué s'arrête là.
 */
create or replace function public.worker_claim_event_site_contact(p_message_id uuid)
returns table (
  sendable boolean,
  recipient_email text,
  event_name text,
  race_name text,
  sender_name text,
  sender_email text,
  body text,
  attempt integer
)
language plpgsql security definer set search_path = '' as $$
declare
  v_message private.event_site_contact_messages%rowtype;
  v_to text;
  v_event_name text;
begin
  select * into v_message from private.event_site_contact_messages m
  where m.id = p_message_id for update;

  if not found then
    return query select false, null::text, null::text, null::text, null::text, null::text, null::text, 0;
    return;
  end if;

  select s.contact_email::text, e.name into v_to, v_event_name
  from public.event_sites s join public.events e on e.id = s.event_id
  where s.event_id = v_message.event_id;

  update private.event_site_contact_messages m
  set send_attempts = m.send_attempts + 1
  where m.id = p_message_id;

  return query select
    v_to is not null,
    v_to,
    v_event_name,
    (select r.name from public.races r where r.id = v_message.race_id),
    v_message.sender_name,
    v_message.sender_email::text,
    v_message.body,
    v_message.send_attempts + 1;
end;
$$;

create or replace function public.worker_complete_event_site_contact(p_message_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update private.event_site_contact_attempts a set status = 'sent'
  from private.event_site_contact_messages m
  where m.id = p_message_id and a.id = m.attempt_id;

  delete from private.event_site_contact_messages m where m.id = p_message_id;
end;
$$;

/*
 * Un envoi en échec. `p_abandon` : le contenu est effacé et la trace marquée
 * `failed`. Sinon l'erreur est notée pour la relance. Rend le nombre d'envois
 * tentés.
 */
create or replace function public.worker_fail_event_site_contact(
  p_message_id uuid,
  p_error text,
  p_abandon boolean
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_attempts integer;
begin
  select m.send_attempts into v_attempts from private.event_site_contact_messages m
  where m.id = p_message_id;

  if p_abandon then
    update private.event_site_contact_attempts a set status = 'failed'
    from private.event_site_contact_messages m
    where m.id = p_message_id and a.id = m.attempt_id;

    delete from private.event_site_contact_messages m where m.id = p_message_id;
  else
    update private.event_site_contact_messages m set last_error = left(p_error, 500)
    where m.id = p_message_id;
  end if;

  return coalesce(v_attempts, 0);
end;
$$;

-- ============================================================
-- 04. Les documents diffusés
-- ============================================================

create or replace function private.is_site_downloadable_object(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.sources so
    join public.editions ed on ed.id = so.edition_id
    where so.storage_path = p_name
      and so.public_download_at is not null
      and so.status <> 'archived'
      and ed.status in ('published', 'completed')
      and private.event_site_is_public(ed.event_id)
  );
$$;

comment on function private.is_site_downloadable_object(text) is
  'Un fichier de race-sources est lisible par tous seulement s''il est celui d''un document diffusé d''un site en ligne (EVENT_SITE §3.4).';

create policy race_sources__select__site_document on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'race-sources' and private.is_site_downloadable_object(name));

/* Le chemin du fichier d'un document diffusé, pour en signer l'adresse. Nul sinon. */
create or replace function public.event_site_document_path(p_source_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select so.storage_path
  from public.sources so
  where so.id = p_source_id
    and so.storage_path is not null
    and private.is_site_downloadable_object(so.storage_path);
$$;

-- ============================================================
-- 05. Droits d'exécution
-- ============================================================

revoke all on function private.contact_ip_hash(text) from public, anon, authenticated;
revoke all on function private.is_site_downloadable_object(text) from public;
grant execute on function private.is_site_downloadable_object(text) to anon, authenticated;

revoke all on function public.submit_event_site_contact(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_event_site_contact(text, text, text, text, text, text)
  to anon, authenticated;

revoke all on function public.event_site_document_path(uuid) from public, anon, authenticated;
grant execute on function public.event_site_document_path(uuid) to anon, authenticated;

revoke all on function public.worker_claim_event_site_contact(uuid) from public, anon, authenticated;
revoke all on function public.worker_complete_event_site_contact(uuid) from public, anon, authenticated;
revoke all on function public.worker_fail_event_site_contact(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.worker_claim_event_site_contact(uuid) to service_role;
grant execute on function public.worker_complete_event_site_contact(uuid) to service_role;
grant execute on function public.worker_fail_event_site_contact(uuid, text, boolean) to service_role;

commit;
