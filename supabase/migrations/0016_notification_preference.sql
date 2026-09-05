-- PLUKA V1 — Préférence de notification du coureur
-- File target: supabase/migrations/0016_notification_preference.sql
-- Référence : docs/02_DATA_MODEL.md §9.2 · docs/00_PRODUCT_SPEC.md §35 ·
--             docs/engines/SOURCES_EXTRACTION.md §46
--
-- POURQUOI
--
-- 0015 envoie une notification à chaque coureur concerné par un changement
-- officiel. §46 le veut — « le coureur est informé » — mais le modèle n'offrait
-- aucun moyen de dire non, et une notification qu'on ne peut pas couper finit
-- par être ignorée, ou pire, par faire quitter le produit.
--
-- LE DÉFAUT EST « ACTIVÉ »
--
-- §46 fait de l'information la règle : un changement de barrière qui n'atteint
-- pas le coureur est un changement qu'il découvrira le jour J. Se taire par
-- défaut inverserait la charge, et personne ne va chercher un réglage dont il
-- ignore l'existence. Le silence est donc un choix explicite du coureur.
--
-- CE QUE LA PRÉFÉRENCE NE COUPE PAS
--
-- L'impact lui-même. `participant_change_impacts` continue d'être écrit et
-- reste lisible dans l'application : c'est le canal qui ne dépend ni d'un
-- fournisseur, ni d'un réglage. Couper la notification coupe l'email, pas
-- l'information — sans quoi §46 ne serait plus tenu du tout.

begin;

-- ============================================================
-- 01. La préférence
-- ============================================================

alter table public.participant_race_settings
  add column notifications_enabled boolean not null default true;

comment on column public.participant_race_settings.notifications_enabled is
  'Notifications de changement officiel (§46). Vrai par défaut : informer est la règle, se taire est un choix du coureur. Ne coupe que l''email — l''impact reste lisible dans l''application.';

-- ============================================================
-- 02. La boucle de livraison la respecte
-- ============================================================
-- La fonction de 0015 est remplacée pour filtrer sur la préférence. Le reste
-- est identique : les impacts sont écrits comme avant, et seule la demande de
-- notification est conditionnée.

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
  -- §46 — le coureur est informé, s'il le veut bien
  -- ---------------------------------------------------------
  -- Une livraison par coureur concerné, pas par impact. Trois conditions, et
  -- chacune ferme un cas distinct :
  --
  --   `user_id is not null` — un invité jamais activé n'a pas d'adresse ;
  --   `notifications_enabled` — le coureur a choisi le silence ;
  --   `left join` + `coalesce` — la ligne de réglages est facultative, et son
  --   absence vaut « activé », conformément au défaut de la colonne.
  --
  -- L'impact, lui, a déjà été écrit : couper la notification ne coupe pas
  -- l'information.
  for v_participant in
    select distinct i.participant_race_id
    from public.participant_change_impacts i
    join public.participant_races pr on pr.id = i.participant_race_id
    left join public.participant_race_settings s on s.participant_race_id = pr.id
    where i.change_event_id = v_event.id
      and pr.user_id is not null
      and coalesce(s.notifications_enabled, true)
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
  'Impact Analyzer de §44, et demande de notification de §46 dans la même transaction (§22.2), sous réserve de la préférence du coureur. Ne touche à aucun objet downstream (§46).';

commit;
