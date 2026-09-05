import { redirect } from 'next/navigation';

import { createAuthClient } from '@/lib/supabase/auth';

export interface Session {
  readonly userId: string;
  readonly email: string | null;
  readonly accessToken: string;
}

/**
 * Session courante, ou `null`.
 *
 * `getUser()` fait valider le jeton par le serveur d'authentification : le
 * cookie seul n'est pas une preuve d'identité, il peut avoir été forgé. Le
 * jeton n'est relu qu'ensuite, une fois l'identité confirmée, pour être
 * transmis au client de données.
 */
export async function getSession(): Promise<Session | null> {
  const auth = await createAuthClient();

  const { data: userData, error } = await auth.auth.getUser();
  if (error !== null || userData.user === null) return null;

  const { data: sessionData } = await auth.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (accessToken === undefined) return null;

  return {
    userId: userData.user.id,
    email: userData.user.email ?? null,
    accessToken,
  };
}

/**
 * Garde de route : sans session, retour à la connexion en conservant la
 * destination.
 *
 * Le `returnTo` est réassaini à la sortie du tunnel, jamais ici : c'est au
 * moment de rediriger l'utilisateur qu'une valeur hostile serait exploitée.
 */
export async function requireSession(returnTo: string): Promise<Session> {
  const session = await getSession();

  if (session === null) {
    redirect(`/connexion?returnTo=${encodeURIComponent(returnTo)}`);
  }

  return session;
}
