-- PLUKA V1 — Journal des transitions de statut d'un Event et d'une Edition
-- File target: supabase/migrations/0022_event_edition_status_journal.sql
-- Référence : docs/00_PRODUCT_SPEC.md §4.1, docs/03_PRIVACY_RLS.md §104, §170
--
-- POURQUOI
--
-- 0006 journalise les transitions d'une Race. Rien n'équivaut pour les deux
-- niveaux au-dessus, alors que §4.1 fait dépendre la publication d'une Race de
-- la leur :
--
--   « Une Race n'est publiquement lisible que si elle est `published`,
--     `cancelled`, `completed` ou `archived`, **et** que son Edition est
--     diffusée, **et** que son Event l'est aussi. »
--
-- La chaîne se publie donc de haut en bas — Event, puis Edition, puis Race —
-- et ces deux transitions-là n'étaient tracées nulle part. Deux exigences de
-- §4.1 leur manquaient tout autant qu'à la Race :
--
--   « Un changement de statut est journalisé : qui, quand, depuis quel statut. »
--   « retour au statut antérieur à l'archivage »
--
-- La seconde a besoin de la première : sans historique, un désarchivage ne
-- sait pas où ramener l'objet.
--
-- PORTÉE
--
-- Deux tables, deux triggers, sur le modèle exact de 0006 : même forme, même
-- alimentation par trigger, mêmes accès. Rien de nouveau n'est décidé ici —
-- l'écriture reste ouverte par 0005 et 0007, et c'est le use case qui arbitre
-- quelle transition est légale.
--
-- Les statuts diffèrent d'un niveau à l'autre, et le journal en hérite :
-- `events.status` est un `record_status` (draft / published / archived),
-- `editions.status` un `edition_status` (les cinq statuts de la Race). Un
-- journal typé par l'enum de sa table refuse par construction une entrée qui
-- n'appartient pas à son cycle de vie.

begin;

-- ============================================================
-- 01. Organisation gestionnaire d'un événement
-- ============================================================
-- Pendant de `private.organization_of_race` et `private.organization_of_edition`
-- (0005). Nul pour un événement maintenu par PLUKA : `user_is_org_member(null)`
-- est faux, et seul `is_pluka_admin()` ouvre alors la lecture — §4.1, « un
-- événement sans organisation gestionnaire n'est administrable que par
-- `pluka_admin` ».

create or replace function private.organization_of_event(p_event_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select e.organization_id
  from public.events e
  where e.id = p_event_id;
$$;

-- ============================================================
-- 02. Journaux
-- ============================================================

create table public.event_status_transitions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  from_status public.record_status not null,
  to_status public.record_status not null,
  actor_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (from_status <> to_status)
);

comment on table public.event_status_transitions is
  'Journal append-only des changements de statut d''un Event : qui, quand, depuis quel statut (00_PRODUCT_SPEC §4.1). Alimenté par trigger, jamais par le client.';

comment on column public.event_status_transitions.actor_user_id is
  'Auteur de la transition tel que vu par auth.uid(). Null lorsque le changement vient d''un traitement serveur sans session utilisateur — import, migration, worker. Jamais renseigné par l''appelant : un acteur déclaré ne serait pas une preuve.';

create table public.edition_status_transitions (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions(id) on delete cascade,
  from_status public.edition_status not null,
  to_status public.edition_status not null,
  actor_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (from_status <> to_status)
);

comment on table public.edition_status_transitions is
  'Journal append-only des changements de statut d''une Edition : qui, quand, depuis quel statut (00_PRODUCT_SPEC §4.1). Alimenté par trigger, jamais par le client.';

comment on column public.edition_status_transitions.actor_user_id is
  'Auteur de la transition tel que vu par auth.uid(). Null lorsque le changement vient d''un traitement serveur sans session utilisateur. Jamais renseigné par l''appelant.';

-- Le désarchivage relit la dernière entrée vers `archived` : la lecture se
-- fait toujours par objet, du plus récent au plus ancien.
create index ix_event_status_transitions_event
  on public.event_status_transitions(event_id, created_at desc);

create index ix_edition_status_transitions_edition
  on public.edition_status_transitions(edition_id, created_at desc);

-- ============================================================
-- 03. Triggers
-- ============================================================

create or replace function private.journal_event_status_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.event_status_transitions (event_id, from_status, to_status, actor_user_id)
  values (new.id, old.status, new.status, (select auth.uid()));

  return new;
end;
$$;

comment on function private.journal_event_status_change() is
  '`security definer` : la table n''accorde aucun insert aux rôles client, l''écriture appartient au moteur.';

create trigger events_journal_status_change
  after update of status on public.events
  for each row
  when (old.status is distinct from new.status)
  execute function private.journal_event_status_change();

create or replace function private.journal_edition_status_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.edition_status_transitions (edition_id, from_status, to_status, actor_user_id)
  values (new.id, old.status, new.status, (select auth.uid()));

  return new;
end;
$$;

comment on function private.journal_edition_status_change() is
  '`security definer` : la table n''accorde aucun insert aux rôles client, l''écriture appartient au moteur.';

create trigger editions_journal_status_change
  after update of status on public.editions
  for each row
  when (old.status is distinct from new.status)
  execute function private.journal_edition_status_change();

-- ============================================================
-- 04. Accès
-- ============================================================
-- §170 : le grant ouvre l'opération, la policy décide du périmètre. Aucun
-- insert, update ni delete n'est accordé — un journal réinscriptible
-- n'atteste plus rien.

alter table public.event_status_transitions enable row level security;
alter table public.edition_status_transitions enable row level security;

revoke all on public.event_status_transitions from anon, authenticated;
revoke all on public.edition_status_transitions from anon, authenticated;

grant select on public.event_status_transitions to authenticated;
grant select on public.edition_status_transitions to authenticated;

create policy event_status_transitions__select__org_member
  on public.event_status_transitions
  for select to authenticated
  using (private.user_is_org_member(private.organization_of_event(event_id)));

create policy event_status_transitions__select__pluka_admin
  on public.event_status_transitions
  for select to authenticated
  using (private.is_pluka_admin());

create policy edition_status_transitions__select__org_member
  on public.edition_status_transitions
  for select to authenticated
  using (private.user_is_org_member(private.organization_of_edition(edition_id)));

create policy edition_status_transitions__select__pluka_admin
  on public.edition_status_transitions
  for select to authenticated
  using (private.is_pluka_admin());

comment on policy event_status_transitions__select__org_member on public.event_status_transitions is
  'L''historique reste interne : ni anon ni participant n''y accèdent, comme pour `race_status_transitions` (0006).';

commit;
