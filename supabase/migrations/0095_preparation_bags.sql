-- ============================================================
-- 0095 — Sacs de la Préparation
-- ============================================================
--
-- 00_PRODUCT_SPEC §14.4 : la Préparation gère au minimum le sac de départ,
-- les drop bags autorisés, les sacs d'assistance et le sac d'arrivée.
-- `bags` et `bag_items` existent depuis 0001, privés (03_PRIVACY_RLS §38,
-- policies 0005) ; cette migration leur donne les règles qui leur manquaient.
--
-- Décisions produit du 2026-11-16 :
--
-- - l'onglet s'ouvre vide, avec des suggestions tirées de la course que le
--   coureur accepte d'un clic, ou écarte (« Pas besoin ») pour cette course ;
-- - un drop bag se rattache à un point où l'organisation l'accepte (0094) ;
--   un sac d'assistance, à un point d'assistance ;
-- - le contenu reprend la checklist, « Mon matériel » ou du texte libre. Les
--   coches du sac sont indépendantes de la checklist : « prêt » dans la
--   checklist dit « je l'ai », coché dans un sac dit « il est dedans ». Une
--   pièce reprise est donc copiée par son intitulé (`item_type = 'free_text'`),
--   sans lien : renommer ou retirer la pièce de la checklist ne vide pas le sac.

-- ------------------------------------------------------------
-- 01. Bornes des intitulés
-- ------------------------------------------------------------

alter table public.bags
  add constraint bags_name_length check (char_length(btrim(name)) between 1 and 80);

alter table public.bag_items
  add constraint bag_items_label_length
  check (label is null or char_length(btrim(label)) between 1 and 120);

create index ix_bags_participant_race on public.bags(participant_race_id);
create index ix_bag_items_bag on public.bag_items(bag_id);

-- ------------------------------------------------------------
-- 02. Un seul sac par rôle
-- ------------------------------------------------------------
-- Accepter deux fois la même suggestion — double clic, deux onglets — ne crée
-- pas deux sacs (AGENTS §32). Un sac de départ, un sac d'arrivée, un drop bag
-- et un sac d'assistance par point. Les sacs « autres » sont libres.
--
-- L'index par point ignore les sacs dont le point a disparu : `on delete set
-- null` les détache quand l'organisation retire un point, et deux sacs
-- orphelins ne doivent pas faire échouer la réécriture de son parcours.

create unique index ux_bags_start_finish
  on public.bags(participant_race_id, bag_type)
  where bag_type in ('start', 'finish');

create unique index ux_bags_point
  on public.bags(participant_race_id, bag_type, race_waypoint_id)
  where bag_type in ('drop_bag', 'assistance') and race_waypoint_id is not null;

-- ------------------------------------------------------------
-- 03. Le bon point pour le bon sac
-- ------------------------------------------------------------
-- Une policy ne voit pas ces règles : le point appartient à la course de la
-- participation, un drop bag va là où l'organisation l'accepte, un sac
-- d'assistance à un point d'assistance. Départ, arrivée et « autre » n'ont
-- pas de point.
--
-- Un point qui disparaît met `race_waypoint_id` à nul (FK) : c'est une
-- mise à jour légitime, que la garde laisse passer. Un point qui cesse
-- d'accepter un drop bag ne touche pas aux sacs existants : l'écran le dit.

create function private.check_bag_waypoint()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_waypoint record;
begin
  if new.bag_type in ('start', 'finish', 'other') then
    if new.race_waypoint_id is not null then
      raise exception 'ce sac ne se rattache à aucun point' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.race_waypoint_id is null then
    if tg_op = 'INSERT' then
      raise exception 'un drop bag ou un sac d''assistance se rattache à un point'
        using errcode = '23514';
    end if;
    return new;
  end if;

  select w.waypoint_type, w.drop_bag_allowed into v_waypoint
  from public.race_waypoints w
  join public.participant_races pr on pr.race_id = w.race_id
  where w.id = new.race_waypoint_id and pr.id = new.participant_race_id;

  if not found then
    raise exception 'ce point n''appartient pas à la course de cette participation'
      using errcode = '23514';
  end if;

  if new.bag_type = 'drop_bag' and not v_waypoint.drop_bag_allowed then
    raise exception 'l''organisation n''accepte pas de drop bag à ce point'
      using errcode = '23514';
  end if;

  if new.bag_type = 'assistance' and v_waypoint.waypoint_type <> 'assistance' then
    raise exception 'ce point n''est pas un point d''assistance' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.check_bag_waypoint() from public;

create trigger trg_bags_waypoint
  before insert or update of race_waypoint_id, bag_type, participant_race_id on public.bags
  for each row execute function private.check_bag_waypoint();

-- ------------------------------------------------------------
-- 04. Suggestions écartées
-- ------------------------------------------------------------
-- « Pas besoin » masque une suggestion pour cette participation. La clé
-- nomme la suggestion, pas un sac : `start`, `finish`, `drop_bag:<point>`,
-- `assistance:<point>`. Privée comme les sacs (§38) : aucune policy
-- organisation.

create table public.bag_suggestion_dismissals (
  participant_race_id uuid not null references public.participant_races(id) on delete cascade,
  suggestion_key text not null check (
    suggestion_key ~ '^(start|finish|(drop_bag|assistance):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'
  ),
  created_at timestamptz not null default now(),
  primary key (participant_race_id, suggestion_key)
);

comment on table public.bag_suggestion_dismissals is
  'Suggestions de sacs écartées par le coureur (« Pas besoin »), par participation (0095). Privé.';

alter table public.bag_suggestion_dismissals enable row level security;

create policy bag_suggestion_dismissals__select__owner on public.bag_suggestion_dismissals
  for select to authenticated using (private.user_owns_participant_race(participant_race_id));

create policy bag_suggestion_dismissals__insert__owner on public.bag_suggestion_dismissals
  for insert to authenticated with check (private.user_owns_participant_race(participant_race_id));

create policy bag_suggestion_dismissals__delete__owner on public.bag_suggestion_dismissals
  for delete to authenticated using (private.user_owns_participant_race(participant_race_id));

grant select, insert, delete on public.bag_suggestion_dismissals to authenticated;
