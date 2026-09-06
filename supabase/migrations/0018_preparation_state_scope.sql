-- PLUKA — preparation_state ne porte plus de résultat de course
-- Migration: 0018_preparation_state_scope.sql
--
-- Référence : 02_DATA_MODEL.md §9.3
--
-- preparation_state et status sont deux axes distincts :
--   preparation_state  où en est le coureur dans sa préparation
--   status             ce qu'est devenue sa participation
--
-- dns, dnf et finished sont des faits de course : ils appartiennent à status seul.
-- Un coureur peut être 'ready' et finir en 'dnf' — dériver une colonne de l'autre
-- écraserait cette distinction.
--
-- PostgreSQL ne sait pas retirer une valeur d'un enum : on crée le type resserré,
-- on bascule la colonne, on remplace l'ancien.
--
-- AVANT D'APPLIQUER : vérifier qu'aucun autre objet du schéma ne référence
-- public.preparation_state (autre table, vue, fonction, policy, contrainte).
--   grep -rn "preparation_state" supabase/migrations/

begin;

-- ============================================================
-- 01. Report des faits de course vers status
-- ============================================================
-- Une participation marquée dns/dnf/completed sur l'axe préparation voit ce fait
-- remonter dans status avant que la colonne ne soit rétrécie. On ne touche pas aux
-- lignes dont status porte déjà une valeur autre qu'active : elle fait autorité.

update public.participant_races
set status = case preparation_state
    when 'dns' then 'dns'::public.participant_race_status
    when 'dnf' then 'dnf'::public.participant_race_status
    when 'completed' then 'finished'::public.participant_race_status
    else status
  end
where preparation_state in ('dns', 'dnf', 'completed')
  and status = 'active';

-- ============================================================
-- 02. Type resserré
-- ============================================================

create type public.preparation_state_v2 as enum ('to_prepare', 'preparing', 'ready');

alter table public.participant_races
  alter column preparation_state drop default;

-- Les trois valeurs retirées deviennent 'ready' : la préparation d'un coureur qui a
-- pris le départ, ou terminé, était achevée. Le fait de course est déjà dans status.
alter table public.participant_races
  alter column preparation_state type public.preparation_state_v2
  using (
    case
      when preparation_state in ('dns', 'dnf', 'completed') then 'ready'
      else preparation_state::text
    end
  )::public.preparation_state_v2;

alter table public.participant_races
  alter column preparation_state set default 'to_prepare';

drop type public.preparation_state;
alter type public.preparation_state_v2 rename to preparation_state;

-- ============================================================
-- 03. Invariants documentés
-- ============================================================

comment on column public.participant_races.preparation_state is
  'Avancement de la préparation du coureur. Jamais un résultat de course : dns, dnf et finished vivent dans status (02_DATA_MODEL.md §9.3).';

comment on column public.participant_races.status is
  'Devenir de la participation. Autoritaire sur dns, dnf, finished et archived. Jamais dérivé de preparation_state.';

commit;
