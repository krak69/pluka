-- PLUKA V1 — Photo de profil, illustration par défaut, sexe facultatif
-- File target: supabase/migrations/0115_profile_avatar.sql
-- Référence : docs/02_DATA_MODEL.md §4.1 · docs/03_PRIVACY_RLS.md §12, §54, §54.1 ·
--             migrations 0005, 0051, 0114
--
-- DÉCISIONS DU 2026-11-27
--
-- - Une photo de profil facultative, déposée par le coureur depuis Mon profil.
--   Sans photo, une illustration : celle qu'il a choisie (Homme, Femme,
--   Neutre) ; sans choix, celle de son sexe s'il l'a renseigné ; sinon Neutre.
-- - Le sexe est facultatif et ne se lit que sur sa propre ligne (`users`,
--   0005). Les autres n'en voient que l'illustration qui en découle, et
--   seulement s'il n'en a pas choisi une lui-même.
-- - La photo ne se voit que là où il a écrit : par qui peut lire un sujet ou
--   une réponse publiés de lui (participants de l'édition, modération, 0114).
--   Ni annuaire, ni affichage ailleurs.
--
-- LE STOCKAGE
--
-- Bucket privé `avatars`. Le chemin est une clé aléatoire, sans l'identifiant
-- du compte : il passe dans les DTO de la Communauté, qui ne portent jamais
-- l'identifiant d'un autre compte (0114). Le propriétaire est `owner_id`, que
-- le stockage pose depuis la session. L'app réencode l'image avant de la
-- déposer (WebP carré, métadonnées retirées, comme 0051) ; le bucket n'accepte
-- de toute façon que du WebP d'un mégaoctet au plus.
--
-- `users.avatar_path` ne s'écrit que par `set_my_avatar_photo`, qui vérifie
-- que la clé désigne un fichier du compte. Le sexe et l'illustration
-- s'écrivent comme le prénom : colonne accordée, ligne du compte (0005).

begin;

-- ============================================================
-- 1. Le profil
-- ============================================================

alter table public.users
  add column sex text check (sex in ('female', 'male', 'other')),
  add column avatar_illustration text check (avatar_illustration in ('neutral', 'man', 'woman')),
  add column avatar_path text check (
    avatar_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
  );

comment on column public.users.sex is
  'Facultatif, déclaré par le coureur (female, male, other). Ne sert qu''à l''illustration par défaut ; lisible par lui seul.';
comment on column public.users.avatar_illustration is
  'Illustration choisie quand il n''y a pas de photo. Nulle : celle du sexe s''il est renseigné, sinon neutral.';
comment on column public.users.avatar_path is
  'Clé de la photo dans le bucket avatars (aléatoire, sans identifiant de compte). Écrite par set_my_avatar_photo seulement.';

grant update (sex, avatar_illustration) on public.users to authenticated;

-- ============================================================
-- 2. Le bucket
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 1048576, array['image/webp'])
on conflict (id) do nothing;

-- ============================================================
-- 3. Qui voit une photo
-- ============================================================

-- Les sujets et réponses d'un auteur se cherchent par auteur.
create index if not exists ix_community_threads_author
  on public.community_threads (author_user_id) where status = 'published';
create index if not exists ix_community_posts_author
  on public.community_posts (author_user_id) where status = 'published';

-- La photo d'un compte : à lui-même, et à qui peut lire une édition où il a
-- publié un sujet ou une réponse encore visibles.
create or replace function private.user_can_see_avatar(p_owner text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_owner uuid;
begin
  if p_owner is null
    or p_owner !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    return false;
  end if;
  v_owner := p_owner::uuid;

  return v_owner = (select auth.uid())
    or exists (
      select 1 from public.community_threads t
      where t.author_user_id = v_owner
        and t.status = 'published'
        and private.user_can_read_community_edition(t.edition_id)
    )
    or exists (
      select 1
      from public.community_posts p
      join public.community_threads t on t.id = p.thread_id
      where p.author_user_id = v_owner
        and p.status = 'published'
        and t.status = 'published'
        and private.user_can_read_community_edition(t.edition_id)
    );
end;
$$;

comment on function private.user_can_see_avatar(text) is
  'Une photo de profil se voit là où son auteur a écrit, et nulle part ailleurs (03_PRIVACY_RLS §54.1).';

revoke all on function private.user_can_see_avatar(text) from public, anon;
grant execute on function private.user_can_see_avatar(text) to authenticated;

create or replace function private.is_avatar_key(p_name text)
returns boolean language sql immutable set search_path = '' as $$
  select p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$';
$$;

revoke all on function private.is_avatar_key(text) from public, anon;
grant execute on function private.is_avatar_key(text) to authenticated;

-- Déposer : dans son propre nom, sous une clé aléatoire. Jamais de
-- remplacement : une nouvelle photo est un nouveau fichier.
create policy avatars__insert__own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and owner_id = (select auth.uid())::text
    and private.is_avatar_key(name)
  );

create policy avatars__select__visible on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and private.user_can_see_avatar(owner_id));

create policy avatars__delete__own on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and owner_id = (select auth.uid())::text);

-- ============================================================
-- 4. Poser ou retirer sa photo
-- ============================================================

-- Rend la clé de la photo précédente : l'app retire le fichier. Une clé nulle
-- retire la photo ; une clé qui ne désigne pas un fichier du compte est
-- refusée (INVALID_AVATAR).
create or replace function public.set_my_avatar_photo(p_path text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_previous text;
begin
  if v_user is null then
    raise exception 'session requise' using errcode = '42501';
  end if;

  if p_path is not null and not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'avatars' and o.name = p_path and o.owner_id = v_user::text
  ) then
    raise exception 'INVALID_AVATAR' using errcode = '22023';
  end if;

  select u.avatar_path into v_previous from public.users u where u.id = v_user for update;
  update public.users set avatar_path = p_path where id = v_user;

  return case when v_previous is distinct from p_path then v_previous end;
end;
$$;

revoke all on function public.set_my_avatar_photo(text) from public, anon;
grant execute on function public.set_my_avatar_photo(text) to authenticated;

-- ============================================================
-- 5. L'avatar de l'auteur, dans les lectures de la Communauté
-- ============================================================

-- Une photo seulement si le lecteur peut la voir ; sinon l'illustration.
-- Jamais l'identifiant du compte, jamais son sexe en clair.
create or replace function private.community_author_avatar(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(
    (
      select case
        when u.avatar_path is not null and private.user_can_see_avatar(u.id::text)
          then jsonb_build_object('kind', 'photo', 'path', u.avatar_path)
        else jsonb_build_object(
          'kind',
          coalesce(
            u.avatar_illustration,
            case u.sex when 'male' then 'man' when 'female' then 'woman' else 'neutral' end
          )
        )
      end
      from public.users u
      where u.id = p_user_id
    ),
    jsonb_build_object('kind', 'neutral')
  );
$$;

revoke all on function private.community_author_avatar(uuid) from public;

-- La forme de retour change : la fonction se recrée.
drop function public.community_threads_list(uuid);

create function public.community_threads_list(p_edition_id uuid)
returns table (
  id uuid,
  race_id uuid,
  race_name text,
  category public.community_category,
  title text,
  waypoint_id uuid,
  waypoint_name text,
  author_label text,
  author_avatar jsonb,
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
    private.community_author_avatar(t.author_user_id),
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

revoke all on function public.community_threads_list(uuid) from public, anon;
grant execute on function public.community_threads_list(uuid) to authenticated;

-- Même lecture qu'en 0114, avec l'avatar de chaque auteur.
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
    'authorAvatar', private.community_author_avatar(v_thread.author_user_id),
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

commit;
