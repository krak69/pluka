'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { publicEnv } from '@/lib/env';
import { safeReturnTo } from '@/lib/return-to';
import { createAuthClient } from '@/lib/supabase/auth';

/**
 * Entrée d'un formulaire : non fiable, donc validée à la frontière
 * (01_ARCHITECTURE §32).
 */
const signInSchema = z.object({
  email: z.email({ error: 'Adresse email invalide' }),
  returnTo: z.string().optional(),
});

/**
 * Demande de lien de connexion (magic link / OTP email).
 *
 * V1 ne rend pas le mot de passe obligatoire (01_ARCHITECTURE §10.1).
 *
 * Le message rendu à l'utilisateur est le même que l'adresse existe ou non :
 * répondre « ce compte n'existe pas » transformerait le formulaire en oracle
 * d'inscription, et dirait qui court chez PLUKA.
 */
export async function requestSignInLink(formData: FormData): Promise<void> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    returnTo: formData.get('returnTo') ?? undefined,
  });

  if (!parsed.success) {
    redirect('/connexion?etat=email-invalide');
  }

  const returnTo = safeReturnTo(parsed.data.returnTo);
  const auth = await createAuthClient();

  const { error } = await auth.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: `${publicEnv().NEXT_PUBLIC_APP_URL}/auth/callback?returnTo=${encodeURIComponent(returnTo)}`,
    },
  });

  if (error !== null) {
    // Le détail provider reste dans les logs serveur, pas dans l'URL : une
    // URL finit dans un historique et un log d'accès (03_PRIVACY_RLS §130).
    console.error('auth.signInWithOtp a échoué', { code: error.code, status: error.status });
    redirect('/connexion?etat=envoi-impossible');
  }

  redirect(`/connexion?etat=lien-envoye&returnTo=${encodeURIComponent(returnTo)}`);
}

export async function signOut(): Promise<void> {
  const auth = await createAuthClient();
  await auth.auth.signOut();

  redirect('/connexion?etat=deconnecte');
}
