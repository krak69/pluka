-- PLUKA — Communauté d'édition : lecture, écriture, utile, signalement
-- File target: supabase/migrations/0114_community.sql
-- Référence : 00_PRODUCT_SPEC §21 ; 03_PRIVACY_RLS §53 à §55 ; 05_ROUTES_FLOWS
-- §12.4 ; ACCEPTANCE AC-COM-01 à AC-COM-04 ; décisions du 2026-11-27.
--
-- CE QUE CETTE MIGRATION FAIT
--
-- 1. Une communauté est celle d'une édition. La lire demande une participation
--    non archivée à l'une de ses courses, ou d'être owner / admin de
--    l'organisation de l'édition, ou admin PLUKA. 0005 l'ouvrait à tout compte
--    capable de lire la course — donc à tout le monde pour une course
--    publique — et à tout membre de l'organisation, `viewer` compris : c'est
--    ce que §53 et §55 interdisent.
-- 2. La modération passe à l'owner et à l'admin de l'organisation de
--    l'édition, et à l'admin PLUKA (§55, décision du 2026-11-27).
-- 3. Plus aucune écriture directe dans les tables : 0005 laissait un auteur
--    republier un contenu masqué par la modération, ou déplacer son sujet dans
--    une autre édition. Les écritures passent par des fonctions qui vérifient
--    la participation, la portée (course et point de l'édition) et l'état du
--    contenu (AGENTS §27).
-- 4. Les lectures passent par des fonctions qui construisent l'auteur affiché,
--    « Prénom N. » (§54) : `users` reste fermé aux autres comptes.
-- 5. Bornes de longueur et index des lectures de la communauté.
--
-- CE QU'ELLE NE FAIT PAS
--
-- Pas encore de geste de modération côté organisation (masquer, rétablir) :
-- il viendra avec son écran. L'admin PLUKA modère déjà par sa console (0029).
-- Pas de « meilleure réponse », pas de suivi de sujet : ni la spec ni le
-- modèle ne les définissent.

begin;

-- ============================================================
-- 1. Bornes et index
-- ============================================================

-- La communauté n'a jamais été branchée : aucune ligne existante à reprendre.
alter table public.community_threads
  add constraint community_threads_title_length
    check (char_length(btrim(title)) between 3 and 140),
  add constraint community_threads_body_length
    check (char_length(body) <= 4000);

alter table public.community_posts
  add constraint community_posts_body_length
    check (char_length(btrim(body)) between 1 and 4000);

alter table public.community_reports
  add constraint community_reports_details_length
    check (details is null or char_length(details) <= 1000);

create index if not exists ix_community_threads_edition
  on public.community_threads (edition_id, created_at desc);
create index if not exists ix_community_reactions_thread
  on public.community_reactions (thread_id) where thread_id is not null;
create index if not exists ix_community_reactions_post
  on public.community_reactions (post_id) where post_id is not null;
create index if not exists ix_community_reports_thread
  on public.community_reports (thread_id) where thread_id is not null;
create index if not exists ix_community_reports_post
  on public.community_reports (post_id) where post_id is not null;

-- ============================================================
-- 2. Qui lit, qui modère
-- ============================================================

-- Une participation archivée est sortie de la circulation (02 §11) : elle
-- n'ouvre plus la communauté.
create or replace function private.user_participates_in_edition(p_edition_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.participant_races pr
    join public.races r on r.id = pr.race_id
    where r.edition_id = p_edition_id
      and pr.user_id = (select auth.uid())
      and pr.status <> 'archived'
  );
$$;

-- §55 : owner et admin de l'organisation de l'édition ; jamais editor ni
-- viewer. `user_has_org_role` compare des rangs explicites (AGENTS §81).
create or replace function private.user_can_moderate_community_edition(p_edition_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.user_has_org_role(private.organization_of_edition(p_edition_id), 'admin')
    or private.is_pluka_admin();
$$;

create or replace function private.user_can_read_community_edition(p_edition_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.user_participates_in_edition(p_edition_id)
    or private.user_can_moderate_community_edition(p_edition_id);
$$;

-- Redéfinies sur l'édition : les policies de lecture de 0005, et celle de
-- `pluka_conversations`, suivent sans être réécrites.
create or replace function private.user_can_moderate_community_thread(p_thread_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.community_threads t
    where t.id = p_thread_id
      and private.user_can_moderate_community_edition(t.edition_id)
  );
$$;

create or replace function private.user_can_read_community_thread(p_thread_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.community_threads t
    where t.id = p_thread_id
      and private.user_can_read_community_edition(t.edition_id)
  );
$$;

-- §54 : « Prénom N. », rien d'autre. « Compte supprimé » après 0078.
create or replace function private.community_author_label(p_user_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p_user_id is null then 'Compte supprimé'
    else coalesce(
      (
        select case
          when nullif(btrim(u.first_name), '') is null then null
          else btrim(u.first_name)
            || coalesce(' ' || upper(left(nullif(btrim(u.last_name), ''), 1)) || '.', '')
        end
        from public.users u
        where u.id = p_user_id
      ),
      'Participant'
    )
  end;
$$;

-- Appelée seulement par les fonctions de lecture ci-dessous, jamais par une policy.
revoke all on function private.community_author_label(uuid) from public;

-- ============================================================
-- 3. Plus d'écriture directe
-- ============================================================

drop policy community_threads__insert__participant on public.community_threads;
drop policy community_threads__update__author on public.community_threads;
drop policy community_threads__update__moderator on public.community_threads;
drop policy community_posts__insert__participant on public.community_posts;
drop policy community_posts__update__author on public.community_posts;
drop policy community_posts__update__moderator on public.community_posts;
drop policy community_reactions__insert__owner on public.community_reactions;
drop policy community_reactions__delete__owner on public.community_reactions;
drop policy community_reports__insert__reporter on public.community_reports;

-- Une policy d'écriture sans grant est morte, un grant sans policy aussi :
-- les deux partent ensemble (0005 §02). La lecture reste.
revoke insert, update, delete on public.community_threads from authenticated;
revoke insert, update, delete on public.community_posts from authenticated;
revoke insert, update, delete on public.community_reactions from authenticated;
revoke insert, update, delete on public.community_reports from authenticated;

-- ============================================================
-- 4. Lectures
-- ============================================================

-- Les sujets d'une édition, du plus récemment actif au plus ancien. Un sujet
-- masqué par la modération reste visible de son auteur, signalé comme tel.
create or replace function public.community_threads_list(p_edition_id uuid)
returns table (
  id uuid,
  race_id uuid,
  race_name text,
  category public.community_category,
  title text,
  waypoint_id uuid,
  waypoint_name text,
  author_label text,
  is_mine boolean,
  status public.community_content_status,
  created_at timestamptz,
  last_activity_at timestamptz,
  reply_count integer,
  useful_count integer,
  useful_by_me boolean
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null or not private.user_can_read_community_edition(p_edition_id) then
    raise exception 'communauté inaccessible' using errcode = '42501';
  end if;

  return query
  select
    t.id,
    t.race_id,
    r.name,
    t.category,
    t.title,
    t.linked_waypoint_id,
    w.name,
    private.community_author_label(t.author_user_id),
    coalesce(t.author_user_id = v_user, false),
    t.status,
    t.created_at,
    greatest(t.created_at, coalesce(posts.last_at, t.created_at)),
    coalesce(posts.n, 0),
    coalesce(useful.n, 0),
    coalesce(useful.mine, false)
  from public.community_threads t
  left join public.races r on r.id = t.race_id
  left join public.race_waypoints w on w.id = t.linked_waypoint_id
  left join lateral (
    select count(*)::integer as n, max(p.created_at) as last_at
    from public.community_posts p
    where p.thread_id = t.id and p.status = 'published'
  ) posts on true
  left join lateral (
    select count(*)::integer as n, bool_or(c.user_id = v_user) as mine
    from public.community_reactions c
    where c.thread_id = t.id and c.reaction_type = 'useful'
  ) useful on true
  where t.edition_id = p_edition_id
    and (t.status = 'published' or (t.status = 'hidden' and t.author_user_id = v_user))
  order by greatest(t.created_at, coalesce(posts.last_at, t.created_at)) desc, t.id
  limit 300;
end;
$$;

-- Un sujet et ses réponses, dans l'ordre. Un DTO explicite (AGENTS §79) :
-- jamais l'identifiant d'un autre compte, seulement son libellé.
create or replace function public.community_thread_read(p_thread_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_thread public.community_threads;
  v_moderator boolean;
  v_posts jsonb;
  v_useful integer;
  v_useful_mine boolean;
begin
  if v_user is null then
    raise exception 'session requise' using errcode = '42501';
  end if;

  select * into v_thread from public.community_threads t where t.id = p_thread_id;
  if not found or not private.user_can_read_community_edition(v_thread.edition_id) then
    raise exception 'sujet inaccessible' using errcode = '42501';
  end if;

  v_moderator := private.user_can_moderate_community_edition(v_thread.edition_id);
  if v_thread.status = 'deleted'
    or (v_thread.status = 'hidden' and v_thread.author_user_id is distinct from v_user and not v_moderator)
  then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'authorLabel', private.community_author_label(p.author_user_id),
      'isMine', coalesce(p.author_user_id = v_user, false),
      'status', p.status,
      'body', p.body,
      'createdAt', p.created_at,
      'usefulCount', (
        select count(*) from public.community_reactions c
        where c.post_id = p.id and c.reaction_type = 'useful'
      ),
      'usefulByMe', exists (
        select 1 from public.community_reactions c
        where c.post_id = p.id and c.reaction_type = 'useful' and c.user_id = v_user
      )
    ) order by p.created_at, p.id), '[]'::jsonb)
  into v_posts
  from public.community_posts p
  where p.thread_id = p_thread_id
    and (
      p.status = 'published'
      or (p.status = 'hidden' and (p.author_user_id = v_user or v_moderator))
    );

  select count(*)::integer, coalesce(bool_or(c.user_id = v_user), false)
  into v_useful, v_useful_mine
  from public.community_reactions c
  where c.thread_id = p_thread_id and c.reaction_type = 'useful';

  return jsonb_build_object(
    'id', v_thread.id,
    'editionId', v_thread.edition_id,
    'raceId', v_thread.race_id,
    'raceName', (select r.name from public.races r where r.id = v_thread.race_id),
    'category', v_thread.category,
    'title', v_thread.title,
    'body', v_thread.body,
    'waypointId', v_thread.linked_waypoint_id,
    'waypointName', (select w.name from public.race_waypoints w where w.id = v_thread.linked_waypoint_id),
    'authorLabel', private.community_author_label(v_thread.author_user_id),
    'isMine', coalesce(v_thread.author_user_id = v_user, false),
    'status', v_thread.status,
    'createdAt', v_thread.created_at,
    'usefulCount', v_useful,
    'usefulByMe', v_useful_mine,
    'canReply', v_thread.status = 'published'
      and private.user_participates_in_edition(v_thread.edition_id),
    'canModerate', v_moderator,
    'posts', v_posts
  );
end;
$$;

-- ============================================================
-- 5. Écritures du participant
-- ============================================================

-- Un nouveau sujet. Sa course et son point appartiennent à l'édition ; un
-- point sans course désigne la sienne. Un double envoi du même sujet dans
-- les deux minutes rend le sujet déjà créé (AGENTS §32).
create or replace function public.create_community_thread(
  p_edition_id uuid,
  p_category public.community_category,
  p_title text,
  p_body text,
  p_race_id uuid default null,
  p_waypoint_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_race uuid := p_race_id;
  v_waypoint_race uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if v_user is null or not private.user_participates_in_edition(p_edition_id) then
    raise exception 'communauté inaccessible' using errcode = '42501';
  end if;

  if p_waypoint_id is not null then
    select w.race_id into v_waypoint_race from public.race_waypoints w where w.id = p_waypoint_id;
    if v_waypoint_race is null or (v_race is not null and v_race <> v_waypoint_race) then
      raise exception 'INVALID_WAYPOINT' using errcode = '22023';
    end if;
    v_race := v_waypoint_race;
  end if;

  if v_race is not null and not exists (
    select 1 from public.races r where r.id = v_race and r.edition_id = p_edition_id
  ) then
    raise exception 'INVALID_RACE' using errcode = '22023';
  end if;

  select t.id into v_id
  from public.community_threads t
  where t.edition_id = p_edition_id
    and t.author_user_id = v_user
    and t.title = v_title
    and t.status <> 'deleted'
    and t.created_at > now() - interval '2 minutes'
  limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.community_threads
    (edition_id, race_id, author_user_id, category, title, body, linked_waypoint_id)
  values (p_edition_id, v_race, v_user, p_category, v_title, v_body, p_waypoint_id)
  returning id into v_id;

  return v_id;
end;
$$;

-- Une réponse, à un sujet publié de son édition. Même garde contre le double envoi.
create or replace function public.reply_community_thread(p_thread_id uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_edition uuid;
  v_status public.community_content_status;
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  select t.edition_id, t.status into v_edition, v_status
  from public.community_threads t where t.id = p_thread_id;

  if v_user is null or v_edition is null or not private.user_participates_in_edition(v_edition) then
    raise exception 'sujet inaccessible' using errcode = '42501';
  end if;
  if v_status <> 'published' then
    raise exception 'THREAD_CLOSED' using errcode = '22023';
  end if;

  select p.id into v_id
  from public.community_posts p
  where p.thread_id = p_thread_id
    and p.author_user_id = v_user
    and p.body = v_body
    and p.status <> 'deleted'
    and p.created_at > now() - interval '2 minutes'
  limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.community_posts (thread_id, author_user_id, body)
  values (p_thread_id, v_user, v_body)
  returning id into v_id;

  return v_id;
end;
$$;

-- La cible d'un geste : exactement un sujet ou une réponse, publiés, de
-- l'édition du participant. Rend l'édition, ou lève.
create or replace function private.community_target_edition(p_thread_id uuid, p_post_id uuid)
returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_edition uuid;
begin
  if (p_thread_id is null) = (p_post_id is null) then
    raise exception 'INVALID_TARGET' using errcode = '22023';
  end if;

  if p_thread_id is not null then
    select t.edition_id into v_edition
    from public.community_threads t
    where t.id = p_thread_id and t.status = 'published';
  else
    select t.edition_id into v_edition
    from public.community_posts p
    join public.community_threads t on t.id = p.thread_id
    where p.id = p_post_id and p.status = 'published' and t.status = 'published';
  end if;

  if v_edition is null or not private.user_participates_in_edition(v_edition) then
    raise exception 'contenu inaccessible' using errcode = '42501';
  end if;

  return v_edition;
end;
$$;

revoke all on function private.community_target_edition(uuid, uuid) from public;

-- « Utile » posé ou retiré ; idempotent dans les deux sens. Rend le compte.
create or replace function public.set_community_useful(
  p_thread_id uuid,
  p_post_id uuid,
  p_useful boolean
)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'session requise' using errcode = '42501';
  end if;
  perform private.community_target_edition(p_thread_id, p_post_id);

  if p_useful then
    insert into public.community_reactions (user_id, thread_id, post_id, reaction_type)
    values (v_user, p_thread_id, p_post_id, 'useful')
    on conflict do nothing;
  else
    delete from public.community_reactions c
    where c.user_id = v_user
      and c.reaction_type = 'useful'
      and c.thread_id is not distinct from p_thread_id
      and c.post_id is not distinct from p_post_id;
  end if;

  return (
    select count(*)::integer from public.community_reactions c
    where c.reaction_type = 'useful'
      and c.thread_id is not distinct from p_thread_id
      and c.post_id is not distinct from p_post_id
  );
end;
$$;

-- Un signalement ; le même signaleur sur le même contenu, tant qu'il est
-- ouvert, n'en crée pas un second (AGENTS §32).
create or replace function public.report_community_content(
  p_thread_id uuid,
  p_post_id uuid,
  p_reason public.report_reason,
  p_details text default null
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
begin
  if v_user is null then
    raise exception 'session requise' using errcode = '42501';
  end if;
  perform private.community_target_edition(p_thread_id, p_post_id);

  select r.id into v_id
  from public.community_reports r
  where r.reporter_user_id = v_user
    and r.status = 'open'
    and r.thread_id is not distinct from p_thread_id
    and r.post_id is not distinct from p_post_id
  limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.community_reports (reporter_user_id, thread_id, post_id, reason, details)
  values (v_user, p_thread_id, p_post_id, p_reason, nullif(btrim(coalesce(p_details, '')), ''))
  returning id into v_id;

  return v_id;
end;
$$;

-- L'auteur supprime son sujet ou sa réponse, même masqués : sans retour.
create or replace function public.delete_community_content(p_thread_id uuid, p_post_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_count integer;
begin
  if v_user is null then
    raise exception 'session requise' using errcode = '42501';
  end if;
  if (p_thread_id is null) = (p_post_id is null) then
    raise exception 'INVALID_TARGET' using errcode = '22023';
  end if;

  if p_thread_id is not null then
    update public.community_threads t set status = 'deleted', updated_at = now()
    where t.id = p_thread_id and t.author_user_id = v_user and t.status <> 'deleted';
  else
    update public.community_posts p set status = 'deleted', updated_at = now()
    where p.id = p_post_id and p.author_user_id = v_user and p.status <> 'deleted';
  end if;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'contenu inaccessible' using errcode = '42501';
  end if;
end;
$$;

-- ============================================================
-- 6. Droits
-- ============================================================

revoke all on function public.community_threads_list(uuid) from public, anon;
revoke all on function public.community_thread_read(uuid) from public, anon;
revoke all on function public.create_community_thread(
  uuid, public.community_category, text, text, uuid, uuid
) from public, anon;
revoke all on function public.reply_community_thread(uuid, text) from public, anon;
revoke all on function public.set_community_useful(uuid, uuid, boolean) from public, anon;
revoke all on function public.report_community_content(uuid, uuid, public.report_reason, text)
  from public, anon;
revoke all on function public.delete_community_content(uuid, uuid) from public, anon;

grant execute on function public.community_threads_list(uuid) to authenticated;
grant execute on function public.community_thread_read(uuid) to authenticated;
grant execute on function public.create_community_thread(
  uuid, public.community_category, text, text, uuid, uuid
) to authenticated;
grant execute on function public.reply_community_thread(uuid, text) to authenticated;
grant execute on function public.set_community_useful(uuid, uuid, boolean) to authenticated;
grant execute on function public.report_community_content(uuid, uuid, public.report_reason, text)
  to authenticated;
grant execute on function public.delete_community_content(uuid, uuid) to authenticated;

commit;
