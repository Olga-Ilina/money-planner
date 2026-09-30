// @vitest-environment happy-dom
// Page of one account: summary, movements of a month with a running balance (owner D3).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { Data } from '../../../src/engine';
import { Toast } from '../../../src/ui/kit';
import { currentPage, pushPage } from '../../../src/ui/nav';
import { AccountPage } from '../../../src/ui/pages/AccountPage';
import { SheetHost, openSheet } from '../../../src/ui/sheets/host';
import { data, resetSession } from '../../../src/ui/state';
import { TabContent } from '../../../src/ui/TabContent';
import { ACC, scenario } from '../../engine/scenario';
import { finish, money, plain, rowByTitle, rowText, startOn, statSub, statValue } from './helpers';

const mocks = vi.hoisted(() => ({ loadReports: vi.fn(), accountsReport: vi.fn(), shareFile: vi.fn() }));

vi.mock('../../../src/ui/io', async (orig) => ({
  ...(await orig<typeof import('../../../src/ui/io')>()),
  loadReports: mocks.loadReports,
}));

vi.mock('../../../src/ui/share', async (orig) => ({
  ...(await orig<typeof import('../../../src/ui/share')>()),
  shareFile: mocks.shareFile,
}));

vi.mock('../../../src/ui/sheets/host', async (orig) => {
  const mod = await orig<typeof import('../../../src/ui/sheets/host')>();
  return { ...mod, openSheet: vi.fn(mod.openSheet) };
});

const FILE = { filename: 'Счета — Октябрь 2026.xlsx', buffer: new Uint8Array([7]) };

beforeEach(() => {
  startOn(2026, 11, 15);
  data.value = scenario();
  mocks.loadReports.mockReset().mockResolvedValue({ accountsReport: mocks.accountsReport });
  mocks.accountsReport.mockReset().mockResolvedValue(FILE);
  mocks.shareFile.mockReset().mockResolvedValue('shared');
  vi.mocked(openSheet).mockClear();
});

afterEach(async () => {
  cleanup();
  await finish();
});

function renderPage(id: string) {
  return render(
    <>
      <AccountPage params={{ id }} />
      <SheetHost />
      <Toast />
    </>,
  );
}

function withData(change: (d: Data) => void): void {
  const d = scenario();
  change(d);
  data.value = d;
}

const monthLabel = (): string => plain(document.querySelector('.month-picker-label')?.textContent);

/** Movement rows of the list: [title, subtitle, amount, running balance]. */
function movements(): string[][] {
  const rows = Array.from(document.querySelectorAll('.account-page-amount')).map((el) => el.closest('.row') as HTMLElement);
  return rows.map((row) => [
    rowText(row, 'title'),
    rowText(row, 'subtitle'),
    plain(row.querySelector('.account-page-amount')?.textContent),
    plain(row.querySelector('.account-page-running')?.textContent).replace(/^, остаток /, ''),
  ]);
}

describe('account page: summary', () => {
  it('shows the name, the type and how the balance now is made up', () => {
    renderPage(ACC.card);
    expect(screen.getByRole('heading', { level: 1, name: 'Карта' })).toBeTruthy();
    expect(plain(document.querySelector('.page-subtitle')?.textContent)).toBe('Дебетовая');
    expect(statValue('Сейчас')).toBe(money(1410));
    expect(statValue('На начало')).toBe(money(1000));
    expect(statSub('На начало')).toBe('на 01.10.2026');
    expect(statValue('Поступления')).toBe(money(3205));
    expect(statValue('Траты')).toBe(money(2665));
    expect(statValue('Переводы')).toBe(money(-130));
  });

  it('an account that no longer exists', () => {
    renderPage('acc-gone');
    expect(screen.getByRole('heading', { level: 1, name: 'Счёт' })).toBeTruthy();
    expect(screen.getByText('Счёт не найден')).toBeTruthy();
  });
});

describe('account page: movements of a month', () => {
  it('starts on the current month: opening balance, movements with a running balance, closing balance', () => {
    renderPage(ACC.card);
    expect(monthLabel()).toBe('Ноябрь 2026');
    expect(rowText(rowByTitle('Остаток на 1 ноября'), 'value')).toBe(money(2890));
    expect(movements()).toEqual([
      ['Аренда', '5 ноября · Постоянный', money(-950, true), money(1940)],
      ['Ноябрь', '15 ноября · Плановая запись', money(-50, true), money(1890)],
    ]);
    expect(rowText(rowByTitle('Остаток на 30 ноября'), 'value')).toBe(money(1890));
  });

  it('steps to another month; incoming money is signed with +, transfers and operations are labelled', () => {
    renderPage(ACC.card);
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    expect(monthLabel()).toBe('Октябрь 2026');
    expect(rowText(rowByTitle('Остаток на 1 октября'), 'value')).toBe(money(1000));
    const rows = movements();
    expect(rows).toHaveLength(11);
    expect(rows[0]).toEqual(['ЗП', '1 октября · Плановая запись', money(3000, true), money(4000)]);
    expect(rows).toContainEqual(['Кафе', '6 октября · Операция', money(-100, true), money(3000)]);
    expect(rows).toContainEqual(['Снятие', '13 октября · Перевод', money(-100, true), money(2715)]);
    expect(rows[10]).toEqual(['Кэшбэк', '21 октября · Операция', money(5, true), money(2890)]);
    expect(rowText(rowByTitle('Остаток на 31 октября'), 'value')).toBe(money(2890));
  });

  it('incoming money is green through the kit’s tone class, outgoing money is not', () => {
    renderPage(ACC.card);
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    const amountOf = (title: string): HTMLElement => rowByTitle(title).querySelector('.account-page-amount') as HTMLElement;
    expect(amountOf('ЗП').classList.contains('tone-green')).toBe(true);
    expect(amountOf('Кэшбэк').classList.contains('tone-green')).toBe(true);
    expect(amountOf('Кафе').classList.contains('tone-green')).toBe(false);
    expect(document.querySelector('.account-page-in')).toBeNull();
  });

  it('keeps the chosen month when the page is opened again (and for another account)', () => {
    const first = renderPage(ACC.card);
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    first.unmount();
    renderPage(ACC.cash);
    expect(monthLabel()).toBe('Октябрь 2026');
    expect(movements().map((m) => m[0])).toEqual(['Снятие', 'Билет']);
  });

  it('forgets the chosen month when the session is reset', () => {
    const first = renderPage(ACC.card);
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    first.unmount();
    act(() => {
      resetSession();
      data.value = scenario();
    });
    renderPage(ACC.card);
    expect(monthLabel()).toBe('Ноябрь 2026');
  });

  it('before the accounting year starts, shows its first month', () => {
    startOn(2026, 9, 30);
    data.value = scenario();
    renderPage(ACC.cash);
    expect(monthLabel()).toBe('Октябрь 2026');
  });

  it('a month without movements says so; the balance stays the same', () => {
    renderPage(ACC.cash);
    expect(screen.getByText('Движений нет')).toBeTruthy();
    expect(rowText(rowByTitle('Остаток на 1 ноября'), 'value')).toBe(money(80));
    expect(rowText(rowByTitle('Остаток на 30 ноября'), 'value')).toBe(money(80));
  });

  it('shows auto-payments of the credit card once they are made; tapping one opens the statements', () => {
    startOn(2026, 12, 31);
    data.value = scenario();
    renderPage(ACC.card);
    expect(monthLabel()).toBe('Декабрь 2026');
    expect(movements()).toEqual([
      ['Ноутбук', '10 декабря · Покупка', money(-480, true), money(1410)],
      ['Погашение кредитки', '10 декабря · Автопогашение', money(-10, true), money(1400)],
    ]);
    fireEvent.click(rowByTitle('Погашение кредитки'));
    expect(openSheet).not.toHaveBeenCalled();
    expect(currentPage('accounts')?.page).toBe('credit');
  });

  it('tapping a movement opens its card', () => {
    render(
      <>
        <TabContent tab="accounts" />
        <SheetHost />
      </>,
    );
    act(() => pushPage('accounts', 'account', { id: ACC.card }));
    fireEvent.click(rowByTitle('Аренда'));
    expect(openSheet).toHaveBeenCalledWith('item', { item: { source: 'recurring', id: 'r-arenda', ym: '2026-11' } });
    fireEvent.click(rowByTitle('Ноябрь'));
    expect(openSheet).toHaveBeenLastCalledWith('item', { item: { source: 'journal', id: 'j-noyabr' } });
  });

  it('a bought purchase without a date is in the balance but not among the movements: says so', () => {
    withData((d) => d.purchases.push({ id: 'p-nodate', what: 'Велосипед', bought: true, price: 200, account: ACC.card }));
    renderPage(ACC.card);
    expect(plain(document.body.textContent)).toContain(
      'Покупки без даты есть в остатке, но не в движениях: Велосипед. Укажите дату покупки.',
    );
  });
});

describe('account page: records dated after today', () => {
  const NOTE = 'включая записи на будущие даты';

  it('«Сейчас» counts them: says so and shows the balance on today next to it', () => {
    renderPage(ACC.card); // the laptop dated 10 December is already in «Сейчас»
    expect(statValue('Сейчас')).toBe(money(1410));
    expect(statSub('Сейчас')).toBe(NOTE);
    expect(statValue('На сегодня')).toBe(money(1890));
    expect(rowText(rowByTitle('Остаток на 30 ноября'), 'value')).toBe(money(1890)); // what the month shows
  });

  it('without such records there is neither the note nor «На сегодня»', () => {
    renderPage(ACC.cash);
    expect(statValue('Сейчас')).toBe(money(80));
    expect(statSub('Сейчас')).toBe('');
    expect(screen.queryByText('На сегодня')).toBeNull();
    expect(plain(document.body.textContent)).not.toContain(NOTE);
  });

  it('once the date has come the note goes away', () => {
    startOn(2026, 12, 31);
    data.value = scenario();
    renderPage(ACC.card);
    expect(statSub('Сейчас')).toBe('');
    expect(screen.queryByText('На сегодня')).toBeNull();
  });

  it('a record dated today is not a future one; one dated tomorrow is', () => {
    withData((d) => d.operations.push({ id: 'o-today', date: '2026-11-15', kind: 'expense', what: 'Сегодня', amount: 5, account: ACC.cash }));
    const first = renderPage(ACC.cash);
    expect(statValue('Сейчас')).toBe(money(75));
    expect(screen.queryByText('На сегодня')).toBeNull();
    first.unmount();
    withData((d) => d.operations.push({ id: 'o-tomorrow', date: '2026-11-16', kind: 'expense', what: 'Завтра', amount: 5, account: ACC.cash }));
    renderPage(ACC.cash);
    expect(statValue('Сейчас')).toBe(money(75));
    expect(statSub('Сейчас')).toBe(NOTE);
    expect(statValue('На сегодня')).toBe(money(80));
  });

  it('a record after the last accounting month counts as a future one too', () => {
    withData((d) => d.operations.push({ id: 'o-2028', date: '2028-01-05', kind: 'expense', what: 'Далеко', amount: 5, account: ACC.cash }));
    renderPage(ACC.cash);
    expect(statValue('Сейчас')).toBe(money(75));
    expect(statSub('Сейчас')).toBe(NOTE);
    expect(statValue('На сегодня')).toBe(money(80));
  });

  it('a future transfer is a future record of both accounts', () => {
    withData((d) =>
      d.operations.push({ id: 'o-later', date: '2026-11-20', kind: 'transfer', what: 'Потом', amount: 50, account: ACC.card, toAccount: ACC.cash }),
    );
    renderPage(ACC.cash);
    expect(statValue('Сейчас')).toBe(money(130));
    expect(statSub('Сейчас')).toBe(NOTE);
    expect(statValue('На сегодня')).toBe(money(80));
  });

  it('the credit card page has the same figures', () => {
    withData((d) => d.operations.push({ id: 'o-later', date: '2026-11-20', kind: 'expense', what: 'Потом', amount: 25, account: ACC.credit }));
    renderPage(ACC.credit);
    expect(statValue('Сейчас')).toBe(money(-35));
    expect(statSub('Сейчас')).toBe(NOTE);
    expect(statValue('На сегодня')).toBe(money(-10));
  });
});

describe('account page: the credit card', () => {
  it('leads to the statements', () => {
    render(<TabContent tab="accounts" />);
    act(() => pushPage('accounts', 'account', { id: ACC.credit }));
    const row = rowByTitle('Выписки и списания');
    expect(rowText(row, 'subtitle')).toBe(`Спишется 10 декабря: ${money(10)}`);
    fireEvent.click(row);
    expect(currentPage('accounts')?.page).toBe('credit');
  });

  it('on the debit day itself the row says «Списано»', () => {
    startOn(2026, 12, 10);
    data.value = scenario();
    renderPage(ACC.credit);
    expect(rowText(rowByTitle('Выписки и списания'), 'subtitle')).toBe(`Списано 10 декабря: ${money(10)}`);
  });

  it('other accounts have no statements row', () => {
    renderPage(ACC.cash);
    expect(screen.queryByText('Выписки и списания')).toBeNull();
  });
});

describe('account page: export', () => {
  it('exports the month on screen', async () => {
    renderPage(ACC.card);
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    fireEvent.click(screen.getByRole('button', { name: 'Выгрузить счета и движения' }));
    await waitFor(() => expect(mocks.shareFile).toHaveBeenCalledWith(FILE.filename, FILE.buffer));
    expect(mocks.accountsReport).toHaveBeenCalledWith(data.value, '2026-11-15', '2026-10');
  });
});
