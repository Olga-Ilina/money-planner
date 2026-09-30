// Shared helpers of the «Счета» screen tests (owner D3).
import { vi } from 'vitest';
import { screen } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { useFactory } from '../../../src/store/db';
import { actions } from '../../../src/ui/actions';
import { formatMoney } from '../../../src/ui/format';
import { resetSession } from '../../../src/ui/state';

/** Money and dates are printed with no-break spaces; compare them as plain spaces. */
export const plain = (s: string | null | undefined): string => (s ?? '').replace(/[  ]/g, ' ').trim();

/** '1 410,00 €' as plain text. */
export const money = (n: number, signed = false): string => plain(formatMoney(n, { signed }));

/** Starts a test on a fixed local day (only Date is faked: sheet and toast timers stay real). */
export function startOn(year: number, month: number, day: number): void {
  useFactory(new IDBFactory());
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(year, month - 1, day, 12, 0));
  resetSession(); // today() re-reads the (fake) clock here
}

export async function finish(): Promise<void> {
  await actions.flush();
  resetSession();
  useFactory(undefined);
  vi.useRealTimers();
}

/** The amount shown on the StatCard labelled `label`. */
export function statValue(label: string): string {
  const card = screen.getByText(label, { selector: '.stat-label' }).closest('.stat-card');
  return plain(card?.querySelector('.stat-value')?.textContent);
}

/** The small line under the amount of the StatCard labelled `label`. */
export function statSub(label: string): string {
  const card = screen.getByText(label, { selector: '.stat-label' }).closest('.stat-card');
  return plain(card?.querySelector('.stat-sub')?.textContent);
}

/** The row (button or div) whose title is exactly `title`. */
export function rowByTitle(title: string): HTMLElement {
  const el = screen.getAllByText(title, { selector: '.row-title, .row-title *' })[0]?.closest<HTMLElement>('.row');
  if (!el) throw new Error(`no row «${title}»`);
  return el;
}

export function rowText(row: HTMLElement, part: 'title' | 'subtitle' | 'value'): string {
  return plain(row.querySelector(`.row-${part}`)?.textContent);
}
