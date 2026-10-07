import type { ConsoleNoticeParams } from '@/lib/console-notice';

import { BankTabPage } from '../bank-page';

/** Banque Nutrition — Fiches validées. Les fiches trouvables par tous les coureurs. */
export const metadata = { title: 'Fiches validées' };

export default function Page({
  searchParams,
}: {
  readonly searchParams: Promise<ConsoleNoticeParams>;
}) {
  return <BankTabPage tab="catalogue" status="validated" searchParams={searchParams} />;
}
