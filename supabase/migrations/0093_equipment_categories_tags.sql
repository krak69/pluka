-- PLUKA — « Mon matériel » : catégories et tags
-- Référence : docs/00_PRODUCT_SPEC.md §20 · docs/02_DATA_MODEL.md §17.2 · migration 0092
--
-- Décisions produit du 2026-11-13 :
--   - une catégorie par pièce, dans une liste fixe commune à tous (filtres simples) ;
--   - des tags libres, plusieurs par pièce (« hiver », « nuit », « ultra ») ;
--   - la catégorie est devinée à l'ajout par mots-clés, dans le domaine (pas d'IA),
--     et le coureur la corrige ; à défaut, « Divers ».
--
-- Les tags sont normalisés par le domaine (minuscules, espaces réduits) ; la base
-- vérifie leur forme quel que soit le chemin d'écriture (trigger, comme 0091) :
-- 0 à 10 tags, de 1 à 30 caractères, sans doublon.
--
-- `gear_category` et non `equipment_category` : ce dernier (0001) appartient au
-- catalogue `equipment_items`, inutilisé depuis 0045, et ses valeurs ne sont pas
-- celles retenues ici.

create type public.gear_category as enum (
  'clothing',     -- Vêtements et accessoires
  'lighting',     -- Éclairage
  'safety',       -- Sécurité
  'hydration',    -- Hydratation
  'nutrition',    -- Nutrition
  'carrying',     -- Portage
  'electronics',  -- Électronique
  'care',         -- Soins
  'other'         -- Divers
);

alter table public.user_equipment_items
  add column category public.gear_category not null default 'other',
  add column tags text[] not null default '{}';

comment on column public.user_equipment_items.category is
  'Catégorie fixe PLUKA, devinée à l''ajout par mots-clés et corrigeable (0093).';
comment on column public.user_equipment_items.tags is
  'Tags libres du coureur, normalisés en minuscules : 0 à 10, de 1 à 30 caractères, sans doublon (0093).';

create function private.check_user_equipment_tags()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if cardinality(new.tags) > 10
     or exists (
       select 1 from unnest(new.tags) as tag
       where tag is null
          or char_length(tag) not between 1 and 30
          or tag <> lower(btrim(tag))
     )
     or cardinality(new.tags) <> (select count(distinct tag) from unnest(new.tags) as tag) then
    raise exception 'une pièce porte de 0 à 10 tags distincts, en minuscules, de 1 à 30 caractères'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.check_user_equipment_tags() from public;

create trigger trg_user_equipment_items_tags
  before insert or update of tags on public.user_equipment_items
  for each row execute function private.check_user_equipment_tags();

-- La bibliothèque se filtre par catégorie et par tag.
create index ix_user_equipment_items_category
  on public.user_equipment_items (user_id, category);

create index ix_user_equipment_items_tags
  on public.user_equipment_items using gin (tags);
