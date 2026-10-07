import { redirect } from 'next/navigation';

/** Le journal vit sous Paramètres depuis le 2026-10-07 : l'ancienne adresse y mène. */
export default function LegacyJournalPage() {
  redirect('/parametres/journal');
}
