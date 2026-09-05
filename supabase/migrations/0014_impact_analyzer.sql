-- PLUKA V1 — Impact Analyzer
-- File target: supabase/migrations/0014_impact_analyzer.sql
-- Référence : docs/engines/SOURCES_EXTRACTION.md §43, §44, §45, §46 ·
--             docs/00_PRODUCT_SPEC.md §35, §37 · docs/02_DATA_MODEL.md ·
--             docs/03_PRIVACY_RLS.md §35 · docs/01_ARCHITECTURE.md §22.1, §22.2
--
-- PÉRIMÈTRE
--
-- §44 : « race.fact.published → Impact Analyzer → Plans dépendants,
-- Préparation, Assistance, Nutrition… Le moteur Sources ne réécrit pas
-- lui-même les objets downstream. Il signale le changement. »
--
-- Ce fichier fait donc une seule chose : à partir d'un `race_change_event`,
-- déterminer *qui* est réellement concerné et *par quoi*, et écrire les
-- `participant_change_impacts` correspondants. Aucun Plan, aucune Nutrition,
-- aucune Assistance n'est touché — §46 : « le Plan existant est marqué
-- potentiellement impacté ; le coureur est informé ; le recalcul se fait selon
-- le workflow produit ».
--
-- POURQUOI L'ANALYSE EST ÉCRITE EN SQL
--
-- « L'analyse ne lit jamais de données personnelles au-delà de ce qui est
-- strictement nécessaire pour déterminer l'affectation. »
--
-- La lecture la plus stricte de cette règle est que ces données ne quittent
-- jamais la base. Un analyseur applicatif devrait charger la liste des
-- participants, de leurs Plans et de leurs assistants pour décider — donc
-- faire transiter par la mémoire du worker, et potentiellement par ses logs,
-- exactement ce que §37 du PRODUCT_SPEC interdit d'exposer.
--
-- Ici, le worker envoie un identifiant d'événement et reçoit un nombre. Rien
-- d'autre ne franchit la frontière. Ce que la fonction lit ne sort pas de la
-- transaction qui l'a lu, et elle ne lit que des existences : « ce coureur
-- a-t-il un Plan actif », jamais ce que ce Plan contient.
--
-- CORRECTION D'UN DÉFAUT DU LOT PRÉCÉDENT
--
-- `dispatch_outbox_events` (0008) ne connaissait que `gpx.%` et `source.%`.
-- L'événement `race.fact.published`, produit par la publication de 0012,
-- tombait donc dans la branche « aucune queue » et était marqué `failed` :
-- l'événement métier partait bien, mais n'atteignait personne.

begin;

-- ============================================================
-- 01. Les événements de course atteignent enfin une file
-- ============================================================
-- `pluka_plan` porte déjà « plan.recompute, nutrition.recompute,
-- assistance.refresh » (0002) : c'est le domaine de ce que l'analyse signale.

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
-- 02. Quels modules un changement peut-il concerner
-- ============================================================
-- §44 nomme les destinataires : Plans, Préparation, Assistance, Nutrition.
-- Le lien entre la catégorie du fact et ces modules est une règle produit, et
-- elle est écrite une seule fois, ici.
--
-- Trois catégories ne produisent rien : `general`, `other` et `contact`. Un
-- numéro de téléphone d'organisation qui change ne modifie ni un pacing, ni un
-- sac, ni une stratégie — signaler cela à chaque coureur transformerait le
-- signal en bruit, et §44 demande d'identifier les préparations *réellement*
-- concernées.

create or replace function private.impacted_modules(p_category public.fact_category)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_category
    -- L'heure de départ décale tout le Plan, et donc les Conditions calées
    -- dessus (00_PRODUCT_SPEC §18.5).
    when 'start' then array['plan', 'preparation', 'conditions']
    -- §84 : une barrière change les marges, donc le pacing.
    when 'cutoff' then array['plan']
    when 'course' then array['plan', 'course', 'conditions']
    when 'gpx' then array['plan', 'course', 'conditions']
    -- Un ravitaillement change ce qu'il faut porter et ce qu'on y trouve.
    when 'aid' then array['plan', 'nutrition']
    when 'equipment' then array['preparation']
    when 'assistance' then array['assistance', 'preparation']
    when 'bag' then array['assistance', 'preparation']
    when 'transport' then array['preparation']
    when 'safety' then array['preparation']
    when 'withdrawal' then array['preparation']
    when 'bib' then array['preparation']
    when 'rules' then array['preparation']
    when 'weather' then array['conditions']
    else array[]::text[]
  end;
$$;

comment on function private.impacted_modules is
  'Modules qu''une catégorie de fact peut concerner (§44). `general`, `other` et `contact` n''en concernent aucun : signaler un changement sans effet transformerait le signal en bruit.';

-- ============================================================
-- 03. L'analyse
-- ============================================================

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

  -- §45 : « lorsqu'un Plan est confirmé, le domaine conserve les versions
  -- exactes des facts utilisés. Ainsi, si un fact change, PLUKA peut retrouver
  -- les Plans dépendants de fact_version N. » On regarde donc d'abord s'il
  -- existe des dépendances déclarées sur la version remplacée : quand c'est le
  -- cas, elles font autorité et le module `plan` ne concerne qu'elles.
  select exists (
    select 1
    from public.plan_version_dependencies d
    where d.race_fact_version_id = v_event.from_version_id
  ) into v_dependent_plans;

  foreach v_module in array v_modules
  loop
    -- Un module n'est signalé qu'aux coureurs qui l'utilisent : annoncer une
    -- Nutrition impactée à qui n'en a pas serait du bruit, et lire son contenu
    -- pour en juger serait de la curiosité. La condition ne teste qu'une
    -- existence.
    insert into public.participant_change_impacts
      (change_event_id, participant_race_id, impacted_module)
    select v_event.id, pr.id, v_module
    from public.participant_races pr
    where pr.race_id = v_event.race_id
      -- Un coureur qui a abandonné, n'est pas parti ou a archivé sa course
      -- n'a plus de préparation à ajuster.
      and pr.status = 'active'
      and case v_module
        when 'plan' then
          case
            -- Des dépendances déclarées : elles désignent exactement les Plans
            -- construits sur la valeur qui vient d'être remplacée.
            when v_dependent_plans then exists (
              select 1
              from public.race_plans rp
              join public.plan_version_dependencies d on d.race_plan_id = rp.id
              where rp.participant_race_id = pr.id
                and rp.status = 'active'
                and d.race_fact_version_id = v_event.from_version_id
            )
            -- Aucune dépendance déclarée — première publication, ou Plans
            -- antérieurs au suivi de §45 : tout Plan actif peut être concerné.
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
        -- Préparation et course concernent tout coureur engagé : il n'y a rien
        -- à « avoir activé » pour être concerné par un changement de matériel
        -- obligatoire ou de parcours.
        else true
      end
    -- §22.1 : rejouer le message ne doit pas créer un second impact. La
    -- contrainte d'unicité porte le triplet (événement, coureur, module).
    on conflict (change_event_id, participant_race_id, impacted_module) do nothing;

    get diagnostics v_inserted = row_count;
    v_created := v_created + v_inserted;
  end loop;

  return v_created;
end;
$$;

comment on function private.analyze_change_impact is
  'Impact Analyzer de §44 : détermine qui est concerné et par quoi, et ne touche à aucun objet downstream (§46). Écrit en SQL pour que les données de préparation ne quittent jamais la base (00_PRODUCT_SPEC §37).';

-- ============================================================
-- 04. Surface d'appel du worker
-- ============================================================

create or replace function public.worker_analyze_change_impact(p_change_event_id uuid)
returns integer
language sql
security definer
set search_path = ''
as $$
  select private.analyze_change_impact(p_change_event_id);
$$;

-- Lecture réservée au diagnostic et aux tests de bout en bout. Elle rend des
-- identifiants et des modules, jamais un contenu de préparation.
create or replace function public.worker_read_change_impacts(p_change_event_id uuid)
returns table (
  participant_race_id uuid,
  impacted_module text,
  status public.change_impact_status,
  created_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select i.participant_race_id, i.impacted_module, i.status, i.created_at
  from public.participant_change_impacts i
  where i.change_event_id = p_change_event_id
  order by i.participant_race_id, i.impacted_module;
$$;

do $do$
declare
  f text;
  signatures text[] := array[
    'public.worker_analyze_change_impact(uuid)',
    'public.worker_read_change_impacts(uuid)'
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
