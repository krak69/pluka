-- Seeds de démonstration locaux uniquement. N'entrent jamais en production.
-- Voir docs/01_ARCHITECTURE.md §40 : les valeurs du prototype sont des fixtures,
-- jamais des constantes moteur ni des seuils métier.


-- ============================================================
-- Compte administrateur local
-- ============================================================
--
-- `supabase db reset` vide `auth.users` : sans cette ligne, chaque reset
-- oblige à se reconnecter *puis* à se redonner `pluka_admin` à la main. Le
-- compte existe donc d'avance, confirmé ; la connexion se fait toujours par
-- lien magique, à cette adresse.
--
-- Les colonnes texte de GoTrue sont posées à '' et non laissées à `null` :
-- GoTrue les lit en `string`, et un `null` y fait échouer la connexion.
--
-- `public.users` est créé par le trigger `on_auth_user_created` (0001) ; seul
-- le rôle plateforme est posé ici.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'a0000000-0000-4000-8000-00000000ad01',
  'authenticated', 'authenticated',
  'clement.lacour@live.com', '', now(),
  '', '', '', '', '', '', '', '',
  '{"provider": "email", "providers": ["email"]}', '{}', now(), now()
);

insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
values (
  'a0000000-0000-4000-8000-00000000ad01',
  'a0000000-0000-4000-8000-00000000ad01',
  '{"sub": "a0000000-0000-4000-8000-00000000ad01", "email": "clement.lacour@live.com", "email_verified": true}',
  'email', now(), now()
);

-- Super-admin (0035) : sans rôle précis, entrer dans l'équipe donnerait
-- `admin`, et le compte perdrait Paramètres et la gestion de l'équipe.
update public.users set platform_role = 'pluka_admin', staff_role = 'super_admin'
where id = 'a0000000-0000-4000-8000-00000000ad01';
