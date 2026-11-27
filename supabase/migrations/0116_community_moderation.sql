-- PLUKA — Modération de la Communauté par l'organisation
-- File target: supabase/migrations/0116_community_moderation.sql
-- Référence : 03_PRIVACY_RLS §55 ; 05_ROUTES_FLOWS §6, §7.5 ; migrations 0029,
-- 0114, 0115 ; décisions du 2026-11-27.
--
-- POURQUOI
--
-- 0114 a confié la modération d'une communauté à l'owner et à l'admin de
-- l'organisation de l'édition, comme à l'admin PLUKA (§55), et retiré toute
-- écriture directe dans les tables. Aucun geste ne la portait encore : seule
-- la console PLUKA masquait un contenu signalé (0029), sans pouvoir le
-- rétablir.
--
-- CE QUE CETTE MIGRATION FAIT
--
-- 1. `community_moderation_queue(edition)` : les contenus signalés à traiter,
--    un par contenu avec ses signalements ouverts — motif, précisions, date,
--    **jamais le déclarant** (décision du 2026-11-27) —, et les contenus
--    masqués de l'édition.
-- 2. `hide_community_content(sujet | réponse)` : `published → hidden`, même
--    sans signalement. Clôt (`resolved`) les signalements ouverts du contenu
--    et, pour un sujet, ceux de ses réponses : la règle de 0029. Sur un
--    contenu déjà masqué, ou supprimé par son auteur, le contenu ne change
--    pas et ses signalements se closent.
-- 3. `restore_community_content(sujet | réponse)` : `hidden → published`. Ne
--    rouvre aucun signalement (0029).
-- 4. `keep_community_content(sujet | réponse)` : « Garder en ligne ». Les
--    signalements ouverts qui visent ce contenu passent `dismissed`. L'écran
--    de l'organisation présente ensemble les signalements d'un contenu : la
--    décision porte sur le contenu, pas sur un motif. La console PLUKA garde
--    son geste signalement par signalement (05 §7.5).
-- 5. `community_thread_read` dit aux modérateurs combien de signalements
--    ouverts visent le sujet et chacune de ses réponses ; 0 pour les autres.
--
-- GARDES
--
-- Chaque geste trouve l'édition du contenu, vérifie que l'appelant la modère,
-- verrouille la ligne (`for update`) et vérifie la transition sur l'état
-- verrouillé : deux modérateurs qui cliquent ensemble ne produisent pas deux
-- effets. L'écriture et `private.record_audit` partagent la transaction
-- (§104). Un geste qui ne change rien — contenu déjà masqué sans signalement
-- ouvert, contenu déjà en ligne — réussit sans rien écrire, journal compris :
-- un double clic n'est pas une erreur.
--
-- CODES D'ERREUR
--
-- `42501` refus — aussi pour un contenu introuvable : un non-modérateur
--         n'apprend pas qu'il existe ;
-- `22023` cible invalide (ni sujet ni réponse, ou les deux) ;
-- `55000` transition refusée (rétablir un contenu supprimé par son auteur).

begin;

-- La file lit les signalements ouverts d'une édition.
create index if not exists ix_community_reports_open
  on public.community_reports (created_at)
  where status in ('open', 'reviewed');

-- ============================================================
-- 1. La cible d'un geste
-- ============================================================

/*
 * Verrouille le sujet ou la réponse visé et rend son état. Une réponse dont le
 * sujet est supprimé compte comme supprimée : elle a disparu pour tous.
 */
create or replace function private.lock_community_target(
  p_thread_id uuid,
  p_post_id uuid,
  p_action text
)
returns table (
  kind text,
  target_id uuid,
  edition_id uuid,
  status public.community_content_status
)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_edition uuid;
  v_status public.community_content_status;
begin
  if (select auth.uid()) is null then
    raise exception '% : session requise', p_action using errcode = '42501';
  end if;
  if (p_thread_id is null) = (p_post_id is null) then
    raise exception 'INVALID_TARGET' using errcode = '22023';
  end if;

  if p_post_id is not null then
    select t.edition_id, case when t.status = 'deleted' then 'deleted' else p.status end
    into v_edition, v_status
    from public.community_posts p
    join public.community_threads t on t.id = p.thread_id
    where p.id = p_post_id;
  else
    select t.edition_id, t.status into v_edition, v_status
    from public.community_threads t
    where t.id = p_thread_id;
  end if;

  if v_edition is null or not private.user_can_moderate_community_edition(v_edition) then
    raise exception '% : modération refusée', p_action using errcode = '42501';
  end if;

  -- Le verrou, puis l'état relu sous verrou.
  if p_post_id is not null then
    select case when t.status = 'deleted' then 'deleted' else p.status end into v_status
    from public.community_posts p
    join public.community_threads t on t.id = p.thread_id
    where p.id = p_post_id
    for update of p;
  else
    select t.status into v_status
    from public.community_threads t
    where t.id = p_thread_id
    for update;
  end if;

  return query select
    case when p_post_id is null then 'thread' else 'post' end,
    coalesce(p_post_id, p_thread_id),
    v_edition,
    v_status;
end;
$$;

revoke all on function private.lock_community_target(uuid, uuid, text) from public;

/*
 * Un contenu tel que la modération le voit : le sujet qui le porte, son texte,
 * son auteur « Prénom N. » (§54). Un contenu supprimé par son auteur n'a plus
 * ni titre ni texte : il a disparu pour tous, modération comprise (§55).
 */
create or replace function private.community_moderation_item(p_thread_id uuid, p_post_id uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'kind', case when p.id is null then 'thread' else 'post' end,
    'threadId', t.id,
    'postId', p.id,
    'status', v.status,
    'threadTitle', case when t.status = 'deleted' then null else t.title end,
    'body', case when v.status = 'deleted' then null
                 when p.id is null then t.body
                 else p.body end,
    'authorLabel', private.community_author_label(
      case when p.id is null then t.author_user_id else p.author_user_id end
    ),
    'createdAt', case when p.id is null then t.created_at else p.created_at end,
    'changedAt', case when p.id is null then t.updated_at else p.updated_at end
  )
  from public.community_threads t
  left join public.community_posts p on p.id = p_post_id and p.thread_id = t.id
  cross join lateral (
    select case
      when t.status = 'deleted' then 'deleted'::public.community_content_status
      when p.id is null then t.status
      else p.status
    end as status
  ) v
  where t.id = p_thread_id
    and (p_post_id is null or p.id is not null);
$$;

revoke all on function private.community_moderation_item(uuid, uuid) from public;

-- ============================================================
-- 2. La file de modération d'une édition
-- ============================================================

create or replace function public.community_moderation_queue(p_edition_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_reported jsonb;
  v_hidden jsonb;
begin
  if (select auth.uid()) is null
    or not private.user_can_moderate_community_edition(p_edition_id)
  then
    raise exception 'modération refusée' using errcode = '42501';
  end if;

  -- Un contenu par entrée, ses signalements ouverts ensemble ; le plus
  -- récemment signalé d'abord. Ni le déclarant, ni son identifiant.
  with open_reports as (
    select
      r.id,
      r.reason,
      r.details,
      r.created_at,
      t.id as thread_id,
      r.post_id
    from public.community_reports r
    left join public.community_posts p on p.id = r.post_id
    join public.community_threads t on t.id = coalesce(r.thread_id, p.thread_id)
    where t.edition_id = p_edition_id
      and r.status in ('open', 'reviewed')
  ),
  grouped as (
    select
      o.thread_id,
      o.post_id,
      jsonb_agg(
        jsonb_build_object(
          'reportId', o.id,
          'reason', o.reason,
          'details', o.details,
          'createdAt', o.created_at
        ) order by o.created_at, o.id
      ) as reports,
      max(o.created_at) as last_at
    from open_reports o
    group by o.thread_id, o.post_id
    order by max(o.created_at) desc
    limit 200
  )
  select coalesce(
    jsonb_agg(
      private.community_moderation_item(g.thread_id, g.post_id)
        || jsonb_build_object('reports', g.reports, 'lastReportedAt', g.last_at)
      order by g.last_at desc
    ),
    '[]'::jsonb
  )
  into v_reported
  from grouped g;

  -- Les contenus masqués, à rétablir le cas échéant ; le plus récent d'abord.
  select coalesce(jsonb_agg(h.item order by h.changed_at desc), '[]'::jsonb)
  into v_hidden
  from (
    select private.community_moderation_item(x.thread_id, x.post_id) as item, x.changed_at
    from (
      select t.id as thread_id, null::uuid as post_id, t.updated_at as changed_at
      from public.community_threads t
      where t.edition_id = p_edition_id and t.status = 'hidden'
      union all
      select t.id, p.id, p.updated_at
      from public.community_posts p
      join public.community_threads t on t.id = p.thread_id
      where t.edition_id = p_edition_id and p.status = 'hidden' and t.status <> 'deleted'
    ) x
    order by x.changed_at desc
    limit 200
  ) h;

  return jsonb_build_object('reported', v_reported, 'hidden', v_hidden);
end;
$$;

comment on function public.community_moderation_queue(uuid) is
  'File de moderation d''une edition : contenus signales (motif, precisions, date ; jamais le declarant) et contenus masques. Owner / admin de l''organisation, admin PLUKA (03 §55).';

-- ============================================================
-- 3. Masquer
-- ============================================================

create or replace function public.hide_community_content(
  p_thread_id uuid default null,
  p_post_id uuid default null
)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v record;
  v_closed uuid[];
  v_to public.community_content_status;
begin
  select * into v from private.lock_community_target(p_thread_id, p_post_id, 'hide_community_content');

  v_to := case when v.status = 'published' then 'hidden' else v.status end;
  if v.status = 'published' then
    if v.kind = 'post' then
      update public.community_posts p set status = 'hidden' where p.id = v.target_id;
    else
      update public.community_threads t set status = 'hidden' where t.id = v.target_id;
    end if;
  end if;

  -- Masquer un sujet retire ses réponses de la lecture : leurs signalements
  -- se closent avec lui, sans quoi la même décision se prendrait deux fois.
  with closed as (
    update public.community_reports r
    set status = 'resolved', resolved_at = now()
    where r.status in ('open', 'reviewed')
      and (
        (v.kind = 'post' and r.post_id = v.target_id)
        or (
          v.kind = 'thread'
          and (
            r.thread_id = v.target_id
            or r.post_id in (
              select p.id from public.community_posts p where p.thread_id = v.target_id
            )
          )
        )
      )
    returning r.id
  )
  select coalesce(array_agg(id order by id), '{}') into v_closed from closed;

  if v.status <> 'published' and coalesce(array_length(v_closed, 1), 0) = 0 then
    return 0;
  end if;

  perform private.record_audit(
    'community.hide',
    case v.kind when 'post' then 'community_posts' else 'community_threads' end,
    v.target_id,
    jsonb_build_object(
      'editionId', v.edition_id,
      'statusFrom', v.status,
      'statusTo', v_to,
      'closedReportIds', to_jsonb(v_closed)
    )
  );

  return coalesce(array_length(v_closed, 1), 0);
end;
$$;

comment on function public.hide_community_content(uuid, uuid) is
  'Masque un sujet ou une reponse et clot ses signalements ouverts (ceux des reponses d''un sujet aussi), sous une entree d''audit. Rend le nombre de signalements clos.';

-- ============================================================
-- 4. Rétablir
-- ============================================================

create or replace function public.restore_community_content(
  p_thread_id uuid default null,
  p_post_id uuid default null
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v record;
begin
  select * into v from private.lock_community_target(p_thread_id, p_post_id, 'restore_community_content');

  if v.status = 'published' then
    return;
  end if;
  -- Supprimé par son auteur : il a disparu pour tous, sans retour (§55).
  if v.status <> 'hidden' then
    raise exception 'NOT_HIDDEN' using errcode = '55000';
  end if;

  if v.kind = 'post' then
    update public.community_posts p set status = 'published' where p.id = v.target_id;
  else
    update public.community_threads t set status = 'published' where t.id = v.target_id;
  end if;

  perform private.record_audit(
    'community.restore',
    case v.kind when 'post' then 'community_posts' else 'community_threads' end,
    v.target_id,
    jsonb_build_object('editionId', v.edition_id, 'statusFrom', 'hidden', 'statusTo', 'published')
  );
end;
$$;

comment on function public.restore_community_content(uuid, uuid) is
  'Remet en ligne un sujet ou une reponse masques. Ne rouvre aucun signalement (0029). Audite.';

-- ============================================================
-- 5. Garder en ligne
-- ============================================================

create or replace function public.keep_community_content(
  p_thread_id uuid default null,
  p_post_id uuid default null
)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v record;
  v_dismissed uuid[];
begin
  select * into v from private.lock_community_target(p_thread_id, p_post_id, 'keep_community_content');

  -- Les signalements de ce contenu seulement : garder un sujet ne juge pas
  -- ses réponses.
  with dismissed as (
    update public.community_reports r
    set status = 'dismissed', resolved_at = now()
    where r.status in ('open', 'reviewed')
      and (
        (v.kind = 'post' and r.post_id = v.target_id)
        or (v.kind = 'thread' and r.thread_id = v.target_id)
      )
    returning r.id
  )
  select coalesce(array_agg(id order by id), '{}') into v_dismissed from dismissed;

  if coalesce(array_length(v_dismissed, 1), 0) = 0 then
    return 0;
  end if;

  perform private.record_audit(
    'community.keep',
    case v.kind when 'post' then 'community_posts' else 'community_threads' end,
    v.target_id,
    jsonb_build_object(
      'editionId', v.edition_id,
      'contentStatus', v.status,
      'dismissedReportIds', to_jsonb(v_dismissed)
    )
  );

  return array_length(v_dismissed, 1);
end;
$$;

comment on function public.keep_community_content(uuid, uuid) is
  'Garde un contenu en ligne : ses signalements ouverts sont classes sans suite. Audite.';

-- ============================================================
-- 6. Le sujet, vu par la modération
-- ============================================================

-- Même lecture qu'en 0115, avec le nombre de signalements ouverts du sujet et
-- de chaque réponse pour les modérateurs (0 pour les autres).
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
      'authorAvatar', private.community_author_avatar(p.author_user_id),
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
      ),
      'openReportCount', case when v_moderator then (
        select count(*) from public.community_reports r
        where r.post_id = p.id and r.status in ('open', 'reviewed')
      ) else 0 end
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
    'authorAvatar', private.community_author_avatar(v_thread.author_user_id),
    'isMine', coalesce(v_thread.author_user_id = v_user, false),
    'status', v_thread.status,
    'createdAt', v_thread.created_at,
    'usefulCount', v_useful,
    'usefulByMe', v_useful_mine,
    'canReply', v_thread.status = 'published'
      and private.user_participates_in_edition(v_thread.edition_id),
    'canModerate', v_moderator,
    'openReportCount', case when v_moderator then (
      select count(*) from public.community_reports r
      where r.thread_id = v_thread.id and r.status in ('open', 'reviewed')
    ) else 0 end,
    'posts', v_posts
  );
end;
$$;

-- ============================================================
-- 7. Droits
-- ============================================================

revoke all on function public.community_moderation_queue(uuid) from public, anon;
revoke all on function public.hide_community_content(uuid, uuid) from public, anon;
revoke all on function public.restore_community_content(uuid, uuid) from public, anon;
revoke all on function public.keep_community_content(uuid, uuid) from public, anon;

grant execute on function public.community_moderation_queue(uuid) to authenticated;
grant execute on function public.hide_community_content(uuid, uuid) to authenticated;
grant execute on function public.restore_community_content(uuid, uuid) to authenticated;
grant execute on function public.keep_community_content(uuid, uuid) to authenticated;

commit;
