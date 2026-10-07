import type { ConsoleNoticeParams } from '@/lib/console-notice';

import { BankTabPage } from '../bank-page';

/** Banque Nutrition — Fiches archivées. Retirées des coureurs ; une stratégie confirmée garde ses valeurs. */
export const metadata = { title: 'Fiches archivées' };

export default function Page({
  searchParams,
}: {
  readonly searchParams: Promise<ConsoleNoticeParams>;
}) {
  return <BankTabPage tab="archives" status="archived" searchParams={searchParams} />;
}
