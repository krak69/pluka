-- ============================================================
-- 0100 — Lien privé de l'accompagnant (`/a/[token]`)
-- ============================================================
--
-- 00_PRODUCT_SPEC §15.4 ; 03_PRIVACY_RLS §44 à §47, §144 ; 05_ROUTES_FLOWS
-- §1.5, §4.1 ; AC-ASST-06, AC-ASST-07 ; décisions du 2026-11-17.
--
-- LE JETON
--
-- 96 bits aléatoires, tirés par le serveur de l'application. Seule son
-- empreinte SHA-256 entre en base (`token_hash`) : le lien en clair n'est
-- montré qu'une fois, au coureur, à sa création. Un lien perdu se régénère,
-- ce qui éteint l'ancien. Un seul lien actif par personne (index de 0001).
--
-- SA DURÉE
--
-- Décision du 2026-11-17 : valable jusqu'à 3 jours après la course, et cette
-- fin suit la course si elle bouge. Elle n'est donc pas écrite dans
-- `expires_at` (qui reste disponible pour une durée choisie), elle se calcule
-- à chaque lecture : le plus tard du départ, de l'arrivée prévue au Plan et de
-- la dernière barrière, plus 3 jours. Un ultra de plusieurs jours garde son
-- lien jusqu'au bout.
--
-- SA LECTURE
--
-- `assistant_access_tokens` n'a toujours ni grant ni policy (0005, §45) : le
-- navigateur ne l'interroge jamais. La page publique appelle
-- `assistant_link_view` avec l'empreinte du jeton reçu ; la fonction valide le
-- lien et rend une projection sûre (§46) — ni objectif, ni Plan complet, ni
-- Nutrition, ni téléphone, ni rien d'une autre personne.

-- ------------------------------------------------------------
-- 1. Côté coureur : créer, révoquer, lister
-- ------------------------------------------------------------

/*
 * Crée le lien d'une personne, en éteignant celui qui existait. Propriété
 * vérifiée ici ; le droit commercial (Race Pass, `assistance.share`) l'est
 * dans le domaine avant l'appel, comme pour le reste de la Préparation.
 */
create or replace function public.create_assistant_link(p_assistant_id uuid, p_token_hash text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.user_owns_assistant(p_assistant_id) then
    raise exception 'personne introuvable' using errcode = '42501';
  end if;

  if p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'empreinte de jeton invalide' using errcode = '22023';
  end if;

  update public.assistant_access_tokens
  set revoked_at = now()
  where assistant_id = p_assistant_id and revoked_at is null;

  insert into public.assistant_access_tokens (assistant_id, token_hash)
  values (p_assistant_id, p_token_hash);
end;
$$;

/* Révoque le lien d'une personne. Toujours permis : couper un accès n'est pas une personnalisation. */
create or replace function public.revoke_assistant_link(p_assistant_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.user_owns_assistant(p_assistant_id) then
    raise exception 'personne introuvable' using errcode = '42501';
  end if;

  update public.assistant_access_tokens
  set revoked_at = now()
  where assistant_id = p_assistant_id and revoked_at is null;
end;
$$;

/* Les liens actifs d'une participation : quand, et dernière ouverture. Jamais l'empreinte. */
create or replace function public.list_assistant_links(p_participant_race_id uuid)
returns table (assistant_id uuid, created_at timestamptz, last_used_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select t.assistant_id, t.created_at, t.last_used_at
  from public.assistant_access_tokens t
  join public.race_assistants a on a.id = t.assistant_id
  where a.participant_race_id = p_participant_race_id
    and private.user_owns_participant_race(p_participant_race_id)
    and t.revoked_at is null;
$$;

-- ------------------------------------------------------------
-- 2. Côté accompagnant : la page publique
-- ------------------------------------------------------------

/*
 * `state` : `valid`, `expired`, `revoked` ou `unknown`. Hors `valid`, rien
 * d'autre n'est rendu. Le jeton fait 96 bits : distinguer `unknown` n'aide
 * pas à le deviner.
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
          select jsonb_agg(ai.label order by ai.created_at)
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

revoke all on function public.create_assistant_link(uuid, text) from public, anon;
revoke all on function public.revoke_assistant_link(uuid) from public, anon;
revoke all on function public.list_assistant_links(uuid) from public, anon;
revoke all on function public.assistant_link_view(text) from public;

grant execute on function public.create_assistant_link(uuid, text) to authenticated;
grant execute on function public.revoke_assistant_link(uuid) to authenticated;
grant execute on function public.list_assistant_links(uuid) to authenticated;
-- L'accompagnant n'a pas de compte : la page l'appelle en anonyme (§44).
grant execute on function public.assistant_link_view(text) to anon, authenticated;
