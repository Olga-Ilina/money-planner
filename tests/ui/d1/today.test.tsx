// @vitest-environment happy-dom
// «Сегодня» (D1): cards, the next 7 days with one-tap payment, this month, warnings, backup banner.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import type { Data, UpcomingItem, Warnings } from '../../../src/engine';
import * as db from '../../../src/store/db';
import { actions } from '../../../src/ui/actions';
import { backupNow } from '../../../src/ui/backupNow';
import { formatMoney } from '../../../src/ui/format';
import { Toast, hideToast } from '../../../src/ui/kit';
import { currentPage } from '../../../src/ui/nav';
import { Today, checkRows, debitLine, needsCard, orderUpcoming, summaryMonth } from '../../../src/ui/screens/Today';
import { feedCheck } from '../../../src/ui/screens/Feed';
import { SheetHost, openSheet, openSheetKind } from '../../../src/ui/sheets/host';
import { data, feedMonth, meta as appMeta, resetSession, tab } from '../../../src/ui/state';
import { ACC, row, scenario } from '../../engine/scenario';
import { accessibleName } from '../accessibleName';

vi.mock('../../../src/ui/backupNow', () => ({ backupNow: vi.fn(async () => 'shared' as const) }));

vi.mock('../../../src/ui/sheets/host', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/ui/sheets/host')>();
  return { ...mod, openSheet: vi.fn(mod.openSheet) };
});

/** Text with no-break spaces turned into plain ones. */
const plain = (s: string | null | undefined): string => (s ?? '').replace(/[  ]/g, ' ');
const money = (n: number): string => plain(formatMoney(n));

/** The <section> under the heading `name`. */
function section(name: string): HTMLElement {
  const el = screen.getByRole('heading', { name }).closest('section');
  if (!el) throw new Error(`no section «${name}»`);
  return el as HTMLElement;
}

function setToday(y: number, m: number, d: number): void {
  vi.setSystemTime(new Date(y, m - 1, d, 12, 0));
  resetSession(); // re-reads today()
}

function show(d: Data = scenario()): void {
  data.value = d;
  render(
    <>
      <Today />
      <SheetHost />
      <Toast />
    </>,
  );
}

beforeEach(() => {
  db.useFactory(new IDBFactory());
  vi.useFakeTimers({ toFake: ['Date'] });
  setToday(2026, 10, 6); // Tuesday, inside the scenario's accounting year (October 2026 – September 2027)
  appMeta.value = { failedAttempts: 0, lastBackupAt: new Date().toISOString() };
  vi.mocked(backupNow).mockClear();
  vi.mocked(openSheet).mockClear();
});

afterEach(async () => {
  cleanup();
  await actions.flush();
  vi.useRealTimers();
  resetSession();
  db.useFactory(undefined);
});

describe('Today — header and cards', () => {
  it('shows the weekday and the date under the title', () => {
    show();
    expect(screen.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeTruthy();
    expect(screen.getByText('Вторник, 6 октября')).toBeTruthy();
  });

  it('shows the money on cards, in cash and the credit card debt in red', () => {
    show();
    const cards = screen.getByRole('button', { name: /^На картах/ });
    const cash = screen.getByRole('button', { name: /^Наличные/ });
    const credit = screen.getByRole('button', { name: /^Кредитка/ });
    expect(plain(cards.textContent)).toContain(money(1410));
    expect(plain(cash.textContent)).toContain(money(80));
    expect(plain(credit.textContent)).toContain(money(-10));
    expect(credit.querySelector('.tone-red')).not.toBeNull();
    // the next debit (10.10) is 0: no «Спишется» line
    expect(plain(credit.textContent)).not.toContain('пишется');
  });

  it('«На картах» counts the debit cards only: a savings account is not there (and the cards stay three)', () => {
    const d = scenario();
    d.accounts.push({ id: 'acc-kopilka', name: 'Копилка', type: 'savings', start: 500 });
    show(d);
    expect(plain(screen.getByRole('button', { name: /^На картах/ }).textContent)).toContain(money(1410));
    expect(screen.queryByText('Сбережения')).toBeNull();
  });

  it('shows the next credit card debit when there is one, in the words of «Счета»', () => {
    setToday(2026, 11, 15);
    show();
    const credit = screen.getByRole('button', { name: /^Кредитка/ });
    expect(plain(credit.textContent)).toContain(`Спишется 10 декабря: ${money(10)}`);
    cleanup();
    setToday(2026, 12, 10); // the debit day itself: already made
    show();
    expect(plain(screen.getByRole('button', { name: /^Кредитка/ }).textContent)).toContain(`Списано 10 декабря: ${money(10)}`);
  });

  it('a card opens the «Счета» tab', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: /^Наличные/ }));
    expect(tab.value).toBe('accounts');
    expect(currentPage('accounts')).toBeNull();
  });

  it('«Новая операция» opens the operation form', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Новая операция' }));
    expect(screen.getByRole('dialog', { name: 'Новая операция' })).toBeTruthy();
  });
});

describe('Today — the next 7 days', () => {
  function withMoreRows(): Data {
    const d = scenario();
    d.journal.push(
      { id: 'j-vrach', date: '2026-10-09', kind: 'expense', category: 'Продукты', what: 'Врач', plan: 40, account: ACC.card },
      { id: 'j-dolg', date: '2026-10-02', kind: 'income', category: 'Премия', what: 'Долг вернули', plan: 25, account: ACC.card },
      { id: 'j-later', date: '2026-10-14', kind: 'expense', what: 'Через неделю', plan: 5, account: ACC.card },
    );
    d.recurring.push({ id: 'r-svet', what: 'Свет', kind: 'expense', category: 'Жильё', day: 7, amount: 60, account: ACC.card, marks: {} });
    return d;
  }

  it('lists overdue items first, then by date, up to today + 7 days', () => {
    show(withMoreRows());
    const list = section('Ближайшие 7 дней');
    const titles = within(list).getAllByRole('button', { name: /^Отметить/ }).map((b) => b.getAttribute('aria-label'));
    // Еда 5.10 is overdue; Долг вернули 2.10 is income (not overdue); then 7.10 and 9.10; 14.10 is too late
    expect(titles).toEqual([
      'Отметить оплату: Еда',
      'Отметить поступление: Долг вернули',
      'Отметить оплату: Свет',
      'Отметить оплату: Врач',
    ]);
    const overdue = within(list).getByRole('button', { name: /^Еда/ });
    expect(plain(overdue.textContent)).toContain('5 октября · просрочено');
    expect(overdue.querySelector('.tone-red')).not.toBeNull();
    expect(plain(overdue.textContent)).toContain(money(100));
    expect(plain(within(list).getByRole('button', { name: /^Свет/ }).textContent)).toContain('Завтра');
  });

  it('the check button marks the item paid (with «Отменить»)', async () => {
    show(withMoreRows());
    fireEvent.click(screen.getByRole('button', { name: 'Отметить оплату: Свет' }));
    await actions.flush();
    expect(row(data.value!.recurring, 'r-svet').marks).toEqual({ '2026-10': '✓' });
    expect(screen.getByText('Отмечено')).toBeTruthy(); // a recurring tick is «Отмечено» everywhere (as on its card)
    expect(screen.queryByRole('button', { name: 'Отметить оплату: Свет' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Отметить оплату: Еда' }));
    await actions.flush();
    expect(row(data.value!.journal, 'j-eda').status).toBe('paid');
    expect(screen.getByText('Оплачено')).toBeTruthy();
    expect(await db.loadData()).toEqual(data.value);

    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    await actions.flush();
    expect(row(data.value!.journal, 'j-eda').status).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Отметить оплату: Еда' })).toBeTruthy();
  });

  it('income is marked as received', async () => {
    show(withMoreRows());
    fireEvent.click(screen.getByRole('button', { name: 'Отметить поступление: Долг вернули' }));
    await actions.flush();
    expect(row(data.value!.journal, 'j-dolg').status).toBe('paid');
    expect(screen.getByText('Получено')).toBeTruthy();
  });

  describe('a record that lacks what paying needs: ✓ opens its card instead of paying', () => {
    function lacking(): Data {
      const d = scenario();
      d.journal.push({ id: 'j-bez', date: '2026-10-07', kind: 'expense', what: 'Без счёта', plan: 40 });
      d.recurring.push({ id: 'r-bez', what: 'Свет', kind: 'expense', category: 'Жильё', day: 7, amount: 60, marks: {} });
      d.purchases.push(
        { id: 'p-bez-scheta', what: 'Чайник', cost: 30, saved: 0, date: '2026-10-08', bought: false },
        { id: 'p-bez-ceny', what: 'Лампа', saved: 0, date: '2026-10-08', bought: false, account: ACC.card },
        { id: 'p-nol', what: 'Коврик', cost: 0, saved: 0, date: '2026-10-09', bought: false, account: ACC.card },
      );
      return d;
    }

    it.each([
      ['a journal row without an account', 'Отметить оплату: Без счёта', 'Плановая запись', { source: 'journal', id: 'j-bez' }],
      ['a recurring payment without an account', 'Отметить оплату: Свет', 'Постоянный платёж', { source: 'recurring', id: 'r-bez', ym: '2026-10' }],
      ['a purchase without an account', 'Отметить покупку: Чайник', 'Покупка', { source: 'purchase', id: 'p-bez-scheta' }],
      ['a purchase without a cost or a price', 'Отметить покупку: Лампа', 'Покупка', { source: 'purchase', id: 'p-bez-ceny' }],
      ['a purchase that costs 0', 'Отметить покупку: Коврик', 'Покупка', { source: 'purchase', id: 'p-nol' }],
    ] as const)('%s', async (_what, check, title, item) => {
      const before = lacking();
      show(before);
      fireEvent.click(screen.getByRole('button', { name: check }));
      await actions.flush();
      expect(data.value).toBe(before); // nothing paid, nothing committed
      expect(openSheet).toHaveBeenLastCalledWith('item', { item });
      expect(screen.getByRole('dialog', { name: title })).toBeTruthy();
      expect(document.querySelector('.toast-text')).toBeNull(); // no «Оплачено» / «Куплено» toast
    });

    it('a purchase with an account and a price (no cost) is bought in one tap', async () => {
      const d = lacking();
      d.purchases.push({ id: 'p-ok', what: 'Фен', saved: 0, date: '2026-10-08', bought: false, price: 25, account: ACC.card });
      show(d);
      fireEvent.click(screen.getByRole('button', { name: 'Отметить покупку: Фен' }));
      await actions.flush();
      expect(row(data.value!.purchases, 'p-ok').bought).toBe(true);
      expect(openSheetKind()).toBeNull();
    });

    it('needsCard: the rule, by source', () => {
      const d = lacking();
      const at = (source: UpcomingItem['source'], id: string): UpcomingItem => ({
        source, id, date: '2026-10-07', what: id, amount: 1, kind: 'expense', overdue: false, ...(source === 'recurring' ? { ym: '2026-10' } : {}),
      });
      expect(needsCard(d, at('journal', 'j-bez'))).toBe(true);
      expect(needsCard(d, at('journal', 'j-eda'))).toBe(false);
      expect(needsCard(d, at('recurring', 'r-bez'))).toBe(true);
      expect(needsCard(d, at('recurring', 'r-strahovka'))).toBe(false);
      expect(needsCard(d, at('purchase', 'p-bez-scheta'))).toBe(true);
      expect(needsCard(d, at('purchase', 'p-bez-ceny'))).toBe(true);
      expect(needsCard(d, at('purchase', 'p-nol'))).toBe(true);
      expect(needsCard(d, at('purchase', 'p-noutbuk'))).toBe(false);
      // a record that is gone: the card says so
      expect(needsCard(d, at('journal', 'nope'))).toBe(true);
    });

    it('needsCard: an account that no longer exists is as good as none', () => {
      const d = lacking();
      d.journal.push({ id: 'j-gone', date: '2026-10-07', kind: 'expense', what: 'Удалённый', plan: 40, account: 'acc-gone' });
      d.recurring.push({ id: 'r-gone', what: 'Вода', kind: 'expense', day: 7, amount: 20, account: 'acc-gone', marks: {} });
      d.purchases.push({ id: 'p-gone', what: 'Утюг', cost: 30, saved: 0, date: '2026-10-08', bought: false, account: 'acc-gone' });
      const at = (source: UpcomingItem['source'], id: string): UpcomingItem => ({
        source, id, date: '2026-10-07', what: id, amount: 1, kind: 'expense', overdue: false, ...(source === 'recurring' ? { ym: '2026-10' } : {}),
      });
      expect(needsCard(d, at('journal', 'j-gone'))).toBe(true);
      expect(needsCard(d, at('recurring', 'r-gone'))).toBe(true);
      expect(needsCard(d, at('purchase', 'p-gone'))).toBe(true);
    });

    it('✓ on a row whose account was deleted opens its card', async () => {
      const before = lacking();
      before.journal.push({ id: 'j-gone', date: '2026-10-07', kind: 'expense', what: 'Удалённый', plan: 40, account: 'acc-gone' });
      show(before);
      fireEvent.click(screen.getByRole('button', { name: 'Отметить оплату: Удалённый' }));
      await actions.flush();
      expect(data.value).toBe(before);
      expect(openSheet).toHaveBeenLastCalledWith('item', { item: { source: 'journal', id: 'j-gone' } });
    });
  });

  it('tapping a row opens its card', () => {
    show(withMoreRows());
    fireEvent.click(screen.getByRole('button', { name: /^Свет/ }));
    expect(openSheet).toHaveBeenLastCalledWith('item', { item: { source: 'recurring', id: 'r-svet', ym: '2026-10' } });
    expect(openSheetKind()).toBe('item');
    fireEvent.click(screen.getByRole('button', { name: /^Еда/ }));
    expect(openSheet).toHaveBeenLastCalledWith('item', { item: { source: 'journal', id: 'j-eda' } });
  });

  it('says so when nothing is due', () => {
    const d = scenario();
    d.journal = d.journal.filter((r) => r.id !== 'j-eda');
    show(d);
    expect(within(section('Ближайшие 7 дней')).getByText('На неделю платежей нет')).toBeTruthy();
  });
});

describe('Today — this month', () => {
  it('shows expense fact and plan with a bar, income fact and plan', () => {
    show();
    const month = section('Этот месяц');
    const expense = within(month).getByRole('button', { name: /^Расход/ });
    expect(plain(expense.querySelector('.row-value')?.textContent)).toBe(money(1235));
    expect(plain(expense.textContent)).toContain(`план ${money(1180)}`);
    // the bar is decorative (aria-hidden): the row's text already carries the numbers
    const bar = within(expense).getByRole('progressbar', { name: 'Расход из плана', hidden: true });
    expect(bar.getAttribute('aria-valuemax')).toBe('1180');
    const income = within(month).getByRole('button', { name: /^Доход/ });
    expect(plain(income.querySelector('.row-value')?.textContent)).toBe(money(3205));
    expect(plain(income.textContent)).toContain(`план ${money(3200)}`);
  });

  it('«Доход» first, then «Расход» — the order of «Лента» and «Отчёты»', () => {
    show();
    const titles = within(section('Этот месяц')).getAllByRole('button').map((b) => b.querySelector('.row-title')?.textContent);
    expect(titles).toEqual(['Доход', 'Расход']);
  });

  it('the expense row reads as text: plan and fact, never the bar\u2019s raw value', () => {
    show();
    const expense = within(section('Этот месяц')).getByRole('button', { name: /^Расход/ });
    expect(accessibleName(expense)).toBe(`Расход, план ${money(1180)}, ${money(1235)}`);
    expect(accessibleName(within(section('Этот месяц')).getByRole('button', { name: /^Доход/ }))).toBe(
      `Доход, план ${money(3200)}, ${money(3205)}`,
    );
  });

  it('a month row opens «Лента» at that month, with every record (no check filter left on)', () => {
    setToday(2026, 11, 3);
    feedCheck.value = 'duplicates';
    show();
    fireEvent.click(within(section('Этот месяц')).getByRole('button', { name: /^Расход/ }));
    expect(tab.value).toBe('feed');
    expect(feedMonth.value).toBe('2026-11');
    expect(feedCheck.value).toBeNull();
  });

  it('outside the accounting year shows the nearest accounting month by name', () => {
    setToday(2026, 9, 30);
    show();
    expect(screen.queryByRole('heading', { name: 'Этот месяц' })).toBeNull();
    expect(section('Октябрь 2026')).toBeTruthy();
  });
});

describe('Today — outside the accounting year', () => {
  it('after the last accounting month: «Учётный год закончился», and a way to «Учёт и прогноз»', () => {
    setToday(2027, 10, 5);
    show();
    const banner = screen.getByText(/^Учётный год закончился/).closest('.banner') as HTMLElement;
    expect(plain(banner.textContent)).toContain('Октябрь 2026 — сентябрь 2027');
    expect(screen.queryByText(/Учётный год ещё не начался/)).toBeNull();
    fireEvent.click(within(banner).getByRole('button', { name: 'Учёт и прогноз' }));
    expect(tab.value).toBe('more');
    expect(currentPage('more')?.page).toBe('settings');
  });

  it('before the first accounting month: «Учётный год ещё не начался», and the same way', () => {
    setToday(2026, 9, 20);
    show();
    const banner = screen.getByText(/^Учётный год ещё не начался/).closest('.banner') as HTMLElement;
    fireEvent.click(within(banner).getByRole('button', { name: 'Учёт и прогноз' }));
    expect(currentPage('more')?.page).toBe('settings');
  });

  it('inside the year: no such banner', () => {
    show();
    expect(screen.queryByText(/Учётный год закончился|Учётный год ещё не начался/)).toBeNull();
  });
});

describe('Today — warnings and backup', () => {
  /** The scenario (2 possible duplicates, 1 row outside the year) plus two rows paid without an account. */
  function withChecks(): Data {
    const d = scenario();
    d.journal.push({ id: 'j-noacc', date: '2026-11-03', kind: 'expense', what: 'Рынок', plan: 25, status: 'paid' });
    d.operations.push({ id: 'o-noacc', date: '2026-11-04', kind: 'expense', what: 'Ларёк', amount: 3 });
    return d;
  }

  it('«Проверьте записи»: one row per check, with its count', () => {
    show(withChecks());
    const checks = section('Проверьте записи');
    const names = within(checks).getAllByRole('button').map((b) => accessibleName(b));
    expect(names).toEqual(['Оплачено без счёта, 2', 'Возможные дубли, 2', 'Вне учётного года, 1']);
    // the warning icon is orange through the kit's iconTone
    for (const b of within(checks).getAllByRole('button')) {
      expect(b.querySelector('.row-icon')?.className).toBe('row-icon row-icon-orange');
    }
  });

  it('«Оплачено без счёта» opens «Лента» filtered to those rows, at a month that has them', () => {
    show(withChecks());
    fireEvent.click(within(section('Проверьте записи')).getByRole('button', { name: /^Оплачено без счёта/ }));
    expect(tab.value).toBe('feed');
    expect(feedCheck.value).toBe('unassigned');
    expect(feedMonth.value).toBe('2026-11');
  });

  it('«Возможные дубли» opens «Лента» filtered to the rows flagged «дубль?»', () => {
    show(withChecks());
    fireEvent.click(within(section('Проверьте записи')).getByRole('button', { name: /^Возможные дубли/ }));
    expect(tab.value).toBe('feed');
    expect(feedCheck.value).toBe('duplicates');
    expect(feedMonth.value).toBe('2026-10');
  });

  it('«Вне учётного года» opens «Учёт и прогноз» (Лента cannot show those rows)', () => {
    show(withChecks());
    fireEvent.click(within(section('Проверьте записи')).getByRole('button', { name: /^Вне учётного года/ }));
    expect(tab.value).toBe('more');
    expect(currentPage('more')?.page).toBe('settings');
  });

  it('counts only what «Лента» can show: rows outside the year stay under «Вне учётного года»; bought purchases without a date get their own row', () => {
    const d = withChecks();
    // outside the year: paid without an account, and a possible duplicate (named like the recurring «Аренда»)
    d.operations.push({ id: 'o-out-noacc', date: '2027-11-02', kind: 'expense', what: 'Потом', amount: 4 });
    d.operations.push({ id: 'o-out-dup', date: '2025-05-05', kind: 'expense', what: 'Аренда', amount: 9, account: ACC.card });
    // bought without a date: «Лента» shows no such purchase (the engine counted this one «без счёта»)
    d.purchases.push({ id: 'p-nodate', what: 'Чайник', cost: 30, bought: true });
    show(d);
    const names = within(section('Проверьте записи')).getAllByRole('button').map((b) => accessibleName(b));
    expect(names).toEqual([
      'Оплачено без счёта, 2',
      'Возможные дубли, 2',
      'Куплено без даты, 1',
      'Вне учётного года, 3',
    ]);
  });

  it('«Куплено без даты» opens «Покупки»', () => {
    const d = scenario();
    d.purchases.push({ id: 'p-nodate', what: 'Чайник', cost: 30, bought: true, account: ACC.card });
    show(d);
    fireEvent.click(within(section('Проверьте записи')).getByRole('button', { name: /^Куплено без даты/ }));
    expect(tab.value).toBe('more');
    expect(currentPage('more')?.page).toBe('purchases');
  });

  it('a check «Лента» would find nothing for (only rows it cannot show) has no row', () => {
    const d = scenario();
    d.journal = d.journal.filter((r) => r.id !== 'j-arenda');
    d.operations = d.operations.filter((o) => o.id !== 'o-kafe');
    d.operations.push({ id: 'o-out-noacc', date: '2027-11-02', kind: 'expense', what: 'Потом', amount: 4 });
    show(d);
    const names = within(section('Проверьте записи')).getAllByRole('button').map((b) => accessibleName(b));
    expect(names).toEqual(['Вне учётного года, 2']);
  });

  it('has no warnings row when everything is fine', () => {
    const d = scenario();
    d.journal = d.journal.filter((r) => r.id !== 'j-sentyabr' && r.id !== 'j-arenda');
    d.operations = d.operations.filter((o) => o.id !== 'o-kafe');
    show(d);
    expect(screen.queryByRole('heading', { name: 'Проверьте записи' })).toBeNull();
  });

  it('asks for a backup when there has been none and makes one', () => {
    appMeta.value = { failedAttempts: 0 };
    show();
    expect(screen.getByText(/Резервной копии ещё не было/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Сделать копию' }));
    expect(backupNow).toHaveBeenCalledTimes(1);
  });

  it('«Сделать копию» is busy while the copy is made, then says «Копия готова» (as «Резервная копия» does)', async () => {
    appMeta.value = { failedAttempts: 0 };
    let finish: (outcome: 'shared') => void = () => {};
    vi.mocked(backupNow).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = (outcome) => {
            appMeta.value = { ...appMeta.value, lastBackupAt: new Date().toISOString() }; // markBackupDone
            resolve(outcome);
          };
        }),
    );
    show();
    const make = screen.getByRole('button', { name: 'Сделать копию' }) as HTMLButtonElement;
    fireEvent.click(make);
    expect(make.disabled).toBe(true);
    fireEvent.click(make);
    expect(backupNow).toHaveBeenCalledTimes(1);
    finish('shared');
    expect(await screen.findByText('Копия готова')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Сделать копию' })).toBeNull(); // done: the banner is gone
  });

  it('a copy whose date could not be saved says so; a closed share sheet says nothing', async () => {
    appMeta.value = { failedAttempts: 0 };
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Сделать копию' }));
    expect(await screen.findByText('Копия сделана, но дата не сохранилась')).toBeTruthy();
    const make = screen.getByRole('button', { name: 'Сделать копию' }) as HTMLButtonElement;
    await waitFor(() => expect(make.disabled).toBe(false));
    act(() => hideToast());
    vi.mocked(backupNow).mockImplementationOnce(async () => 'cancelled');
    fireEvent.click(make);
    await waitFor(() => expect(make.disabled).toBe(false));
    expect(document.querySelector('.toast-text')).toBeNull();
  });

  it('names the date of an old backup', () => {
    appMeta.value = { failedAttempts: 0, lastBackupAt: new Date(2026, 8, 1, 12, 0).toISOString() };
    show();
    expect(screen.getByText(/Последняя копия — 01\.09\.2026/)).toBeTruthy();
  });

  it('no banner after a recent backup', () => {
    show();
    expect(screen.queryByRole('button', { name: 'Сделать копию' })).toBeNull();
  });
});

describe('Today — helpers', () => {
  const item = (id: string, date: string, overdue: boolean, kind: 'expense' | 'income' = 'expense'): UpcomingItem => ({
    source: 'journal', id, date, what: id, amount: 1, kind, overdue,
  });

  it('orderUpcoming: overdue first (by date), then the rest by date; input untouched', () => {
    const input = [item('a', '2026-10-07', false), item('b', '2026-10-01', false, 'income'), item('c', '2026-10-03', true), item('d', '2026-10-02', true)];
    expect(orderUpcoming(input).map((i) => i.id)).toEqual(['d', 'c', 'b', 'a']);
    expect(input.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('summaryMonth: the current month inside the year, else the nearest accounting month', () => {
    const s = scenario().settings; // October 2026 – September 2027
    expect(summaryMonth(s, '2026-12-31')).toEqual({ ym: '2026-12', current: true });
    expect(summaryMonth(s, '2026-09-30')).toEqual({ ym: '2026-10', current: false });
    expect(summaryMonth(s, '2027-10-01')).toEqual({ ym: '2027-09', current: false });
  });

  it('checkRows: only the checks that found something, in a fixed order', () => {
    const shown = (d: Data) => checkRows(d).map((c) => [c.check, c.title, c.count]);
    const clean = scenario();
    clean.journal = clean.journal.filter((r) => r.id !== 'j-sentyabr' && r.id !== 'j-arenda');
    clean.operations = clean.operations.filter((o) => o.id !== 'o-kafe');
    expect(shown(clean)).toEqual([]);
    const some = scenario();
    some.journal = some.journal.filter((r) => r.id !== 'j-arenda');
    some.operations = some.operations.filter((o) => o.id !== 'o-kafe');
    some.recurring = some.recurring.map((r) => (r.id === 'r-bonus' ? { ...r, account: undefined } : r)); // one mark
    some.recurring = some.recurring.map((r) => (r.id === 'r-podpiska' ? { ...r, account: undefined } : r)); // one mark
    // a transfer without «На счёт» is the tracker's check «Перевод: укажите «На счёт»» (spec 2026-10-01-planned-transfers)
    some.operations.push({ id: 'o-t', date: '2026-10-30', kind: 'transfer', what: 'Перевод', amount: 5, account: ACC.card });
    expect(shown(some)).toEqual([
      ['unassigned', 'Оплачено без счёта', 2],
      ['transfers', 'Проверьте переводы', 1],
      ['outOfYear', 'Вне учётного года', 1],
    ]);
  });

  it('debitLine: «Спишется 10 декабря: N €» (as on «Счета») only for an amount above zero', () => {
    expect(debitLine(null, '2026-12-01')).toBeUndefined();
    expect(debitLine({ date: '2026-10-10', amount: 0 }, '2026-10-01')).toBeUndefined();
    expect(plain(debitLine({ date: '2026-12-10', amount: 1234.5 }, '2026-12-01'))).toBe(`Спишется 10 декабря: ${money(1234.5)}`);
    expect(plain(debitLine({ date: '2026-12-10', amount: 1234.5 }, '2026-12-10'))).toBe(`Списано 10 декабря: ${money(1234.5)}`);
  });
});
