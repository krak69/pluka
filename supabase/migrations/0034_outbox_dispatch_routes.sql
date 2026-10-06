-- PLUKA V1 — Rétablir les routes `race.%` et `email.%` du dispatcher d'outbox
-- File target: supabase/migrations/0034_outbox_dispatch_routes.sql
-- Référence : docs/01_ARCHITECTURE.md §22 · migrations 0008, 0014, 0015, 0025
--
-- LA RÉGRESSION
--
-- `private.dispatch_outbox_events` a été redéfinie quatre fois :
--
--   0008  gpx.%  source.%
--   0014  + race.%   → pluka_plan   (analyse d'impact, §44)
--   0015  + email.%  → pluka_email  (notifications, §46)
--   0025  + course.% → pluka_geo    — mais réécrite à partir de 0008
--
-- 0025 a donc retiré `race.%` et `email.%` sans le dire. Depuis, tout
-- événement de ces deux familles est marqué `failed` (« aucune queue pour … ») :
-- ni analyse d'impact, ni notification de changement, ni invitation d'équipe
-- (0033) n'atteint sa file. La découverte vient du premier envoi réel d'une
-- invitation ; le test pgTAP 23 fixe désormais chaque route.
--
-- CE QUE CETTE MIGRATION FAIT
--
-- Elle redéfinit le dispatcher avec les cinq routes. Rien d'autre ne change :
-- même sélection, même verrou, même marquage.
--
-- CE QU'ELLE NE FAIT PAS
--
-- Elle ne rejoue pas les événements marqués `failed` pendant la régression.
-- Rejouer une analyse d'impact ou une notification vieille de plusieurs
-- semaines enverrait des messages périmés : la décision appartient à
-- l'exploitation, événement par événement.

begin;

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
    -- Groupement par domaine, pas une queue par type de job (0002). Toute
    -- redéfinition future doit garder ces cinq lignes : le test pgTAP 23 les
    -- vérifie une à une.
    v_queue := case
      when v_event.event_type like 'gpx.%' then 'pluka_geo'
      -- Le référentiel de parcours nourrit le même prétraitement que le GPX (0025).
      when v_event.event_type like 'course.%' then 'pluka_geo'
      when v_event.event_type like 'source.%' then 'pluka_sources'
      -- §44 : un changement de course descend vers les objets dépendants (0014).
      when v_event.event_type like 'race.%' then 'pluka_plan'
      -- §46 et 0033 : notifications et invitations d'équipe (0015).
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

commit;
