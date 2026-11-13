-- PLUKA — Préparation : la checklist de matériel du coureur
-- Référence : docs/00_PRODUCT_SPEC.md §14.1, §14.2 · docs/02_DATA_MODEL.md §8.4, §13.2 ·
--             docs/04_ENTITLEMENTS.md §45, §57 · migrations 0001, 0005, 0045
--
-- `participant_equipment` (0001) pointait vers `equipment_items` et
-- `race_equipment_requirements`, deux tables laissées vides depuis 0045 : le
-- matériel d'une épreuve vit dans les `race_facts` de catégorie `equipment`.
-- Une ligne officielle référence donc désormais ce fact, stable d'une version
-- à l'autre : corriger l'intitulé d'une pièce (version N+1) ne décoche rien.
--
-- Une ligne est, au choix :
--   - officielle   : `race_fact_id`, origine `official_requirement` ;
--   - personnelle  : `custom_label`, origine `personal` ;
--   - (héritée)    : `equipment_item_id`, jamais écrite par l'application.
--
-- La RLS d'origine (0005, propriétaire de la participation) reste celle-ci. Un
-- trigger ajoute ce qu'une policy ne voit pas : un fact référencé appartient
-- à la course de la participation et porte bien du matériel. Le droit d'écrire
-- du matériel personnel (Race Pass) se vérifie dans le domaine, comme pour le
-- Plan (04_ENTITLEMENTS §45).

alter table public.participant_equipment
  add column race_fact_id uuid references public.race_facts(id) on delete cascade;

alter table public.participant_equipment
  drop constraint participant_equipment_check;

alter table public.participant_equipment
  add constraint participant_equipment_one_subject check (
    (equipment_item_id is not null)::int
    + (custom_label is not null)::int
    + (race_fact_id is not null)::int = 1
  ),
  -- Une suggestion ne devient jamais matériel obligatoire (§14.3) : seule une
  -- ligne adossée à un fact de la course se dit officielle.
  add constraint participant_equipment_official_has_fact check (
    (origin = 'official_requirement') = (race_fact_id is not null)
  ),
  add constraint participant_equipment_label_length check (
    custom_label is null or char_length(btrim(custom_label)) between 1 and 120
  );

-- Une pièce officielle n'a qu'un état par participation ; l'écriture est un upsert.
create unique index ux_participant_equipment_fact
  on public.participant_equipment(participant_race_id, race_fact_id);

create index ix_participant_equipment_participant
  on public.participant_equipment(participant_race_id);

comment on column public.participant_equipment.race_fact_id is
  'Pièce de matériel officielle cochée par le coureur : un race_fact de catégorie equipment de sa course (0091). Stable entre les versions du fact.';

create function private.check_participant_equipment_fact()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.race_fact_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.race_facts f
    join public.participant_races pr on pr.race_id = f.race_id
    where f.id = new.race_fact_id
      and pr.id = new.participant_race_id
      and f.category = 'equipment'
  ) then
    raise exception 'ce matériel n''appartient pas à la course de cette participation'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.check_participant_equipment_fact() from public;

create trigger trg_participant_equipment_fact
  before insert or update of race_fact_id, participant_race_id on public.participant_equipment
  for each row execute function private.check_participant_equipment_fact();
