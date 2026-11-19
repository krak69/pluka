-- ============================================================
-- 0109 — Assistance : « Envoyer à mon accompagnant » la liste Nutrition
-- ============================================================
--
-- NUTRITION_ENGINE §55 ; décision du 2026-11-19. La stratégie Nutrition se
-- calcule à la lecture, côté coureur : la page privée de l'accompagnant
-- (`assistant_link_view`, 0100) ne peut pas la calculer. Le coureur envoie
-- donc une copie figée de ce qu'il faut lui donner, rendez-vous par
-- rendez-vous. Elle s'enregistre dans `assistance_items`, en
-- `item_type = 'nutrition'` (0001), à côté de ce qu'il a noté lui-même.
--
-- L'accompagnant ne voit que des quantités (« 3 × Gel 25 ») : ni objectifs,
-- ni stratégie (§55). Si la stratégie change ensuite, l'écran du coureur
-- compare la copie au calcul et l'alerte ; rien ne se renvoie tout seul.

/*
 * Remplace la liste Nutrition d'un rendez-vous par `p_labels`, dans l'ordre.
 * Une liste vide retire ce qui avait été envoyé. Les éléments notés à la main
 * ne sont pas touchés.
 */
create or replace function public.send_assistance_nutrition(
  p_assignment_id uuid,
  p_labels text[]
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_assistant_id uuid;
begin
  select aa.assistant_id into v_assistant_id
  from public.assistance_assignments aa
  where aa.id = p_assignment_id;

  if v_assistant_id is null or not private.user_owns_assistant(v_assistant_id) then
    raise exception 'rendez-vous introuvable' using errcode = '42501';
  end if;

  if cardinality(coalesce(p_labels, '{}')) > 50 then
    raise exception 'liste trop longue' using errcode = '22023';
  end if;

  delete from public.assistance_items ai
  where ai.assistance_assignment_id = p_assignment_id
    and ai.item_type = 'nutrition';

  -- Un instant par ligne, dans l'ordre reçu : la page de l'accompagnant trie
  -- par date de création.
  insert into public.assistance_items (assistance_assignment_id, item_type, label, created_at)
  select p_assignment_id, 'nutrition', btrim(label.value),
         now() + make_interval(secs => label.position / 1000000.0)
  from unnest(coalesce(p_labels, '{}')) with ordinality as label(value, position);
end;
$$;

revoke all on function public.send_assistance_nutrition(uuid, text[]) from public, anon;
grant execute on function public.send_assistance_nutrition(uuid, text[]) to authenticated;

/*
 * La page de l'accompagnant — 0100, inchangée sauf l'ordre de « À me donner » :
 * la liste Nutrition envoyée d'abord, puis ce que le coureur a noté.
 */
create or replace function public.assistant_link_view(p_token_hash text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_token public.assistant_access_tokens%rowtype;
  v_assistant public.race_assistants%rowtype;
  v_participation public.participant_races%rowtype;
  v_race public.races%rowtype;
  v_plan public.race_plans%rowtype;
  v_until timestamptz;
begin
  select * into v_token
  from public.assistant_access_tokens t
  where t.token_hash = p_token_hash;

  if not found then
    return jsonb_build_object('state', 'unknown');
  end if;

  if v_token.revoked_at is not null then
    return jsonb_build_object('state', 'revoked');
  end if;

  select * into v_assistant from public.race_assistants a where a.id = v_token.assistant_id;
  select * into v_participation
  from public.participant_races pr where pr.id = v_assistant.participant_race_id;
  select * into v_race from public.races r where r.id = v_participation.race_id;
  select * into v_plan
  from public.race_plans rp
  where rp.participant_race_id = v_participation.id and rp.status = 'active';

  v_until := greatest(
    v_race.start_datetime,
    v_plan.planned_finish_datetime,
    (select max(c.cutoff_datetime) from public.race_cutoffs c where c.race_id = v_race.id)
  ) + interval '3 days';

  if (v_token.expires_at is not null and v_token.expires_at <= now())
     or now() > v_until
     or v_assistant.status <> 'active'
     or v_participation.status = 'archived' then
    return jsonb_build_object('state', 'expired');
  end if;

  update public.assistant_access_tokens set last_used_at = now() where id = v_token.id;

  return jsonb_build_object(
    'state', 'valid',
    'runnerFirstName', (select u.first_name from public.users u where u.id = v_participation.user_id),
    'assistantFirstName', v_assistant.first_name,
    'raceName', v_race.name,
    'eventName', (
      select e.name from public.editions ed join public.events e on e.id = ed.event_id
      where ed.id = v_race.edition_id
    ),
    'timezone', v_race.timezone,
    'startAt', coalesce(v_plan.input_snapshot ->> 'start_at', to_jsonb(v_race.start_datetime) #>> '{}'),
    'planUpdatedAt', v_plan.updated_at,
    'rendezvous', coalesce((
      select jsonb_agg(jsonb_build_object(
        'pointName', w.name,
        'distanceKm', w.distance_km,
        'instructions', aa.instructions,
        'plannedElapsedSeconds', pw.planned_elapsed_seconds,
        'items', coalesce((
          select jsonb_agg(ai.label order by (ai.item_type = 'nutrition') desc, ai.created_at)
          from public.assistance_items ai where ai.assistance_assignment_id = aa.id
        ), '[]'::jsonb)
      ) order by w.distance_km)
      from public.assistance_assignments aa
      join public.race_waypoints w on w.id = aa.race_waypoint_id
      left join public.plan_waypoints pw
        on pw.race_plan_id = v_plan.id and pw.race_waypoint_id = aa.race_waypoint_id
      where aa.assistant_id = v_assistant.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.assistant_link_view(text) from public;
grant execute on function public.assistant_link_view(text) to anon, authenticated;
