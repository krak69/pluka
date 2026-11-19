-- PLUKA — Recherche du catalogue Nutrition sans accents
-- Référence : NUTRITION_ENGINE §26 (« Mes produits » depuis le catalogue)
--
-- Le coureur tape « naak » et cherche « Näak ». La clé de recherche replie
-- casse et accents sur la marque, le nom et la variante. `unaccent` n'est
-- pas immuable et ne peut pas servir une colonne générée : le repli se fait
-- avec `translate`, immuable, sur les lettres latines courantes.

create or replace function public.nutrition_search_fold(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select replace(replace(replace(
    translate(
      lower(coalesce(p_text, '')),
      'àâäáãåāçćčéèêëēęěíìîïīñńóòôöõøōúùûüūýÿžźżšśł',
      'aaaaaaaccceeeeeeeiiiiinnooooooouuuuuyyzzzssl'
    ),
    'œ', 'oe'), 'æ', 'ae'), 'ß', 'ss');
$$;

comment on function public.nutrition_search_fold(text) is
  'Repli casse et accents pour la recherche du catalogue Nutrition (0105).';

alter table public.nutrition_products
  add column search_key text generated always as (
    public.nutrition_search_fold(
      coalesce(brand, '') || ' ' || name || ' ' || coalesce(variant, '')
    )
  ) stored;
