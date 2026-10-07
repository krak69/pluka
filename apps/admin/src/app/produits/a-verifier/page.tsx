import type { ConsoleNoticeParams } from '@/lib/console-notice';

import { BankTabPage } from '../bank-page';

/** Banque Nutrition — Fiches à vérifier. Propositions de coureurs et fiches importées à relire. */
export const metadata = { title: 'Fiches à vérifier' };

export default function Page({
  searchParams,
}: {
  readonly searchParams: Promise<ConsoleNoticeParams>;
}) {
  return <BankTabPage tab="a-verifier" status="draft" searchParams={searchParams} />;
}
