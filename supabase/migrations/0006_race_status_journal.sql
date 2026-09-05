-- PLUKA V1 — Journal des transitions de statut d'une Race
-- File target: supabase/migrations/0006_race_status_journal.sql
-- Référence : docs/00_PRODUCT_SPEC.md §4.1, docs/03_PRIVACY_RLS.md §104, §170
--
-- POURQUOI
--
-- §4.1 pose deux exigences qu'aucune colonne de `races` ne peut porter :
--
--   « Un changement de statut est journalisé : qui, quand, depuis quel statut. »
--   « archived → completed / archived → cancelled — retour au statut antérieur
--     à l'archivage. »
--
-- La seconde a besoin de la première : sans historique, un désarchivage
-- accepterait indifféremment `completed` ou `cancelled`, alors que la règle
-- veut qu'il ramène la course exactement là où elle était. Une colonne
-- `previous_status` suffirait au désarchivage mais ne journaliserait rien.
--
-- `private.audit_logs` ne convient pas : le schéma `private` n'est jamais
-- exposé au client (02_DATA_MODEL §25), or l'organisation gestionnaire doit
-- pouvoir relire l'historique de ses propres courses.
--
-- ALIMENTATION PAR TRIGGER
--
-- Le journal est écrit par la base, pas par l'application : la transition et
-- sa trace vivent ainsi dans la même transaction, et aucun chemin d'écriture
-- — use case, correction manuelle, worker futur — ne peut oublier de
-- journaliser. C'est la seule façon d'en faire un invariant plutôt qu'une
-- convention.

begin;

-- ============================================================
-- 01. Journal
-- ============================================================

create table public.race_status_transitions (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races(id) on delete cascade,
  from_status public.race_status not null,
  to_status public.race_status not null,
  actor_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (from_status <> to_status)
);

comment on table public.race_status_transitions is
  'Journal append-only des changements de statut d''une Race : qui, quand, depuis quel statut (00_PRODUCT_SPEC §4.1). Alimenté par trigger, jamais par le client.';

comment on column public.race_status_transitions.actor_user_id is
  'Auteur de la transition tel que vu par auth.uid(). Null lorsque le changement vient d''un traitement serveur sans session utilisateur — import, migration, worker. Jamais renseigné par l''appelant : un acteur déclaré ne serait pas une preuve.';

-- Le désarchivage relit la dernière entrée vers `archived` : la lecture se
-- fait toujours par course, du plus récent au plus ancien.
create index ix_race_status_transitions_race
  on public.race_status_transitions(race_id, created_at desc);

-- ============================================================
-- 02. Trigger
-- ============================================================

create or replace function private.journal_race_status_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.race_status_transitions (race_id, from_status, to_status, actor_user_id)
  values (new.id, old.status, new.status, (select auth.uid()));

  return new;
end;
$$;

comment on function private.journal_race_status_change() is
  '`security definer` : la table n''accorde aucun insert aux rôles client, l''écriture appartient au moteur.';

create trigger races_journal_status_change
  after update of status on public.races
  for each row
  when (old.status is distinct from new.status)
  execute function private.journal_race_status_change();

-- ============================================================
-- 03. Accès
-- ============================================================
-- §170 : le grant ouvre l'opération, la policy décide du périmètre. Aucun
-- insert, update ni delete n'est accordé — un journal réinscriptible
-- n'atteste plus rien.

alter table public.race_status_transitions enable row level security;

revoke all on public.race_status_transitions from anon, authenticated;
grant select on public.race_status_transitions to authenticated;

create policy race_status_transitions__select__org_member
  on public.race_status_transitions
  for select to authenticated
  using (private.user_is_org_member(private.organization_of_race(race_id)));

create policy race_status_transitions__select__pluka_admin
  on public.race_status_transitions
  for select to authenticated
  using (private.is_pluka_admin());

comment on policy race_status_transitions__select__org_member on public.race_status_transitions is
  'L''historique reste interne : ni anon ni participant n''y accèdent. Une course annulée s''affiche « Annulée » (§4.1), elle n''expose pas qui l''a annulée ni quand.';

commit;
