-- ============================================================
-- 0094 — Drop bag autorisé, point par point
-- ============================================================
--
-- 00_PRODUCT_SPEC §14.4 : la Préparation gère les « sacs / drop bags
-- autorisés ». Un drop bag n'est pas offert à chaque ravitaillement : sur un
-- ultra, l'organisation l'accepte à un ou deux points, souvent une base vie.
-- Jusqu'ici seule une consigne en texte (`race_facts` de catégorie `bag`) le
-- disait ; le coureur ne pouvait pas rattacher son sac au bon point.
--
-- Décision produit du 2026-11-16 : l'organisation coche « Drop bag » sur
-- n'importe quel point intermédiaire. Ni le départ ni l'arrivée : un sac qu'on
-- y laisse est un sac de départ ou d'arrivée, pas un drop bag.
--
-- La donnée fait partie du référentiel de parcours, publique comme lui : elle
-- s'écrit avec les points, par `set_race_waypoints`, dans la même réécriture.

alter table public.race_waypoints
  add column drop_bag_allowed boolean not null default false;

alter table public.race_waypoints
  add constraint race_waypoints_drop_bag_intermediate
  check (not drop_bag_allowed or waypoint_type not in ('start', 'finish'));

comment on column public.race_waypoints.drop_bag_allowed is
  'Vrai quand l''organisation accepte un drop bag à ce point (00_PRODUCT_SPEC §14.4). Jamais au départ ni à l''arrivée.';

-- ------------------------------------------------------------
-- set_race_waypoints : la clé `dropBagAllowed` rejoint la chaîne
-- ------------------------------------------------------------
-- Absente, elle vaut faux : la réécriture porte toute la chaîne, comme pour
-- les barrières.

create or replace function public.set_race_waypoints(p_race_id uuid, p_waypoints jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_geometry_id uuid;
  v_fingerprint text;
  v_key text;
begin
  -- Même garde que `enqueue_race_gpx` (0008) : écrire le référentiel de
  -- parcours, c'est modifier le contenu de course. Sans session — worker,
  -- reprise de données — l'appelant est `service_role`, tenu de vérifier
  -- lui-même ce qu'il fait (03_PRIVACY_RLS §8).
  if (select auth.uid()) is not null and not (
    private.user_can_manage_race(p_race_id, 'editor') or private.is_pluka_admin()
  ) then
    raise exception 'action non autorisée sur cette épreuve'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.races r where r.id = p_race_id) then
    raise exception 'épreuve introuvable' using errcode = 'P0002';
  end if;

  -- La chaîne demandée, numérotée par sa position. L'ordre du tableau fait foi :
  -- c'est lui que l'écran manipule.
  --
  -- `on commit drop` ne suffit pas : deux appels dans une même transaction —
  -- corriger deux épreuves d'affilée — trouveraient la table encore là.
  drop table if exists wanted;

  create temporary table wanted on commit drop as
  select
    row_number() over () as sort_order,
    nullif(entry ->> 'id', '')::uuid as id,
    entry ->> 'name' as name,
    (entry ->> 'waypointType')::public.waypoint_type as waypoint_type,
    (entry ->> 'distanceKm')::numeric(7, 2) as distance_km,
    nullif(entry ->> 'cutoffAt', '')::timestamptz as cutoff_at,
    coalesce(nullif(entry ->> 'cutoffType', ''), 'hard')::public.cutoff_type as cutoff_type,
    coalesce((entry ->> 'dropBagAllowed')::boolean, false) as drop_bag_allowed
  from jsonb_array_elements(p_waypoints) as entry;

  select count(*) into v_count from wanted;

  -- L'ordre des écritures est contraint par les `restrict` du schéma. Un
  -- waypoint ne peut partir qu'une fois que plus aucun segment ne le désigne,
  -- et les segments ne peuvent être redirigés qu'une fois les nouveaux
  -- waypoints présents. D'où : barrières, waypoints, segments, puis les
  -- waypoints retirés — dans cet ordre et pas un autre.

  -- Les barrières dont le waypoint n'a plus d'heure, ou disparaît.
  delete from public.race_cutoffs c
  where c.race_id = p_race_id
    and not exists (
      select 1 from wanted w where w.id = c.race_waypoint_id and w.cutoff_at is not null
    );

  -- Rangs mis au négatif avant d'être réattribués : `(race_id, sort_order)`
  -- est unique et non différable, et permuter deux waypoints en une passe
  -- violerait la contrainte au milieu de l'instruction. Les rangs négatifs
  -- servent ensuite de marque : ce qui reste négatif n'est plus voulu.
  update public.race_waypoints
  set sort_order = -sort_order - 1
  where race_id = p_race_id;

  update public.race_waypoints w
  set name = x.name,
      waypoint_type = x.waypoint_type,
      distance_km = x.distance_km,
      sort_order = x.sort_order,
      drop_bag_allowed = x.drop_bag_allowed,
      updated_at = now()
  from wanted x
  where w.id = x.id and w.race_id = p_race_id;

  insert into public.race_waypoints (race_id, name, waypoint_type, distance_km, sort_order, drop_bag_allowed)
  select p_race_id, x.name, x.waypoint_type, x.distance_km, x.sort_order, x.drop_bag_allowed
  from wanted x
  where x.id is null or not exists (
    select 1 from public.race_waypoints w where w.id = x.id and w.race_id = p_race_id
  );

  -- ----------------------------------------------------------
  -- Segments dérivés : un par intervalle, dans l'ordre de la chaîne.
  -- ----------------------------------------------------------
  -- Mis à jour en place plutôt que remplacés : `plan_segments` les référence
  -- en `restrict`, et un Plan existant ne doit pas être détruit par une
  -- correction de référentiel (§46).
  --
  -- Seuls les waypoints conservés entrent dans la chaîne : ceux qui gardent un
  -- rang négatif sont sur le départ, et les faire figurer ici recréerait un
  -- segment vers ce qu'on s'apprête à retirer.
  with chain as (
    select
      w.id,
      w.sort_order,
      w.distance_km,
      lead(w.id) over (order by w.sort_order) as next_id,
      lead(w.distance_km) over (order by w.sort_order) as next_distance
    from public.race_waypoints w
    where w.race_id = p_race_id and w.sort_order > 0
  ),
  intervals as (
    select
      (row_number() over (order by sort_order) - 1)::smallint as sort_order,
      id as from_id,
      next_id as to_id,
      next_distance - distance_km as distance_km
    from chain
    where next_id is not null
  ),
  updated as (
    update public.race_segments s
    set from_waypoint_id = i.from_id,
        to_waypoint_id = i.to_id,
        distance_km = i.distance_km
    from intervals i
    where s.race_id = p_race_id and s.sort_order = i.sort_order
    returning s.sort_order
  )
  insert into public.race_segments (race_id, from_waypoint_id, to_waypoint_id, distance_km, sort_order)
  select p_race_id, i.from_id, i.to_id, i.distance_km, i.sort_order
  from intervals i
  where i.sort_order not in (select sort_order from updated);

  -- Les segments surnuméraires, qui pointaient encore vers l'ancienne chaîne.
  delete from public.race_segments s
  where s.race_id = p_race_id and s.sort_order >= greatest(v_count - 1, 0);

  -- Plus rien ne les désigne : les waypoints retirés peuvent partir. Un sac ou
  -- une assistance qui les référencerait encore fait échouer la réécriture, et
  -- c'est voulu (§46).
  delete from public.race_waypoints w
  where w.race_id = p_race_id and w.sort_order < 0;

  -- ----------------------------------------------------------
  -- Barrières horaires.
  -- ----------------------------------------------------------
  insert into public.race_cutoffs (race_id, race_waypoint_id, cutoff_datetime, cutoff_type)
  select p_race_id, w.id, x.cutoff_at, x.cutoff_type
  from wanted x
  join public.race_waypoints w on w.race_id = p_race_id and w.sort_order = x.sort_order
  where x.cutoff_at is not null
  on conflict (race_id, race_waypoint_id, cutoff_type)
  do update set cutoff_datetime = excluded.cutoff_datetime;

  -- ----------------------------------------------------------
  -- Relance du prétraitement — §22.2.
  -- ----------------------------------------------------------
  -- `drop_bag_allowed` n'entre pas dans l'empreinte : il ne change rien au
  -- calcul du parcours, et cocher un drop bag ne relance aucun traitement.
  select r.current_course_geometry_id into v_geometry_id
  from public.races r where r.id = p_race_id;

  select md5(string_agg(
           w.sort_order || ':' || w.waypoint_type || ':' || w.distance_km, '|'
           order by w.sort_order))
  into v_fingerprint
  from public.race_waypoints w
  where w.race_id = p_race_id;

  v_key := 'course.waypoints:' || p_race_id::text || ':' ||
           coalesce(v_geometry_id::text, 'sans-geometrie') || ':' || coalesce(v_fingerprint, '');

  -- `do nothing` : réenregistrer la même chaîne sur la même géométrie ne
  -- redemande pas un traitement qui produirait exactement le même résultat.
  insert into private.outbox_events
    (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
  values (
    'course.waypoints.changed',
    'race',
    p_race_id,
    jsonb_build_object(
      'eventType', 'course.waypoints.changed',
      'raceId', p_race_id,
      'courseGeometryId', v_geometry_id,
      'waypointCount', v_count,
      'idempotencyKey', v_key
    ),
    v_key
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'raceId', p_race_id,
    'waypointCount', v_count,
    'courseGeometryId', v_geometry_id,
    'preprocessingRequested', v_geometry_id is not null
  );
end;
$$;

comment on function public.set_race_waypoints(uuid, jsonb) is
  'Réécrit le référentiel de parcours d''une épreuve — waypoints, segments dérivés, barrières — et enfile la relance du prétraitement, en une transaction (§31, §22.2). Les segments ne sont pas saisis : ce sont les intervalles entre waypoints consécutifs (PLAN_ENGINE §7).';

revoke all on function public.set_race_waypoints(uuid, jsonb) from public, anon;
grant execute on function public.set_race_waypoints(uuid, jsonb) to authenticated, service_role;
