import type { ConsoleNoticeParams } from '@/lib/console-notice';

import { BankTabPage } from '../bank-page';

/** Banque Nutrition — Banque Nutrition. Toutes les fiches, tous statuts. */
export const metadata = { title: 'Banque Nutrition' };

export default function Page({
  searchParams,
}: {
  readonly searchParams: Promise<ConsoleNoticeParams>;
}) {
  return <BankTabPage tab="tous" status={null} searchParams={searchParams} />;
}
