// @vitest-environment happy-dom
// Page «Кредитка»: settings, next auto-payment, the 12 statements (owner D3).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import type { Data } from '../../../src/engine';
import { currentPage, pushPage } from '../../../src/ui/nav';
import { CreditPage } from '../../../src/ui/pages/CreditPage';
import { data } from '../../../src/ui/state';
import { TabContent } from '../../../src/ui/TabContent';
import { ACC, scenario } from '../../engine/scenario';
import { finish, money, plain, rowByTitle, rowText, startOn, statSub, statValue } from './helpers';

beforeEach(() => {
  startOn(2026, 11, 15);
  data.value = scenario();
});

afterEach(async () => {
  cleanup();
  await finish();
});

function withData(change: (d: Data) => void): void {
  const d = scenario();
  change(d);
  data.value = d;
}

function renderPage() {
  return render(<CreditPage params={{}} />);
}

function statementRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll('.credit-page-close')).map((el) => el.closest('.row') as HTMLElement);
}

/** The statement rows: [close date, subtitle, debt, current?]. */
function statements(): [string, string, string, boolean][] {
  return statementRows().map((row) => [
    plain(row.querySelector('.credit-page-close')?.textContent),
    rowText(row, 'subtitle'),
    rowText(row, 'value'),
    row.querySelector('.credit-page-badge') !== null,
  ]);
}

describe('«Кредитка»: summary and settings', () => {
  it('shows the debt now and the next auto-payment with the account it is taken from', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Кредитка' })).toBeTruthy();
    expect(statValue('Долг сейчас')).toBe(money(-10));
    expect(statValue('Ближайшее списание')).toBe(money(10));
    expect(statSub('Ближайшее списание')).toBe('10 декабря со счёта Карта');
  });

  it('a next debit of nothing says «списывать нечего» instead of a zero to be taken from an account', () => {
    startOn(2026, 10, 15);
    data.value = scenario();
    renderPage();
    expect(statValue('Ближайшее списание')).toBe(money(0));
    expect(statSub('Ближайшее списание')).toBe('10 ноября списывать нечего');
  });

  it('shows the settings: card, statement and payment days, auto-payment and its account', () => {
    renderPage();
    expect(rowText(rowByTitle('Карта'), 'value')).toBe('Кредитка');
    expect(rowText(rowByTitle('Выписка'), 'value')).toBe('4-го числа');
    expect(rowText(rowByTitle('Списание'), 'value')).toBe('10-го числа');
    expect(rowText(rowByTitle('Автопогашение'), 'value')).toBe('Включено');
    expect(rowText(rowByTitle('Со счёта'), 'value')).toBe('Карта');
  });

  it('a payment day not after the statement day is in the next month', () => {
    withData((d) => {
      d.credit = { ...d.credit, closeDay: 20, payDay: 5 };
    });
    renderPage();
    expect(rowText(rowByTitle('Выписка'), 'value')).toBe('20-го числа');
    expect(rowText(rowByTitle('Списание'), 'value')).toBe('5-го числа следующего месяца');
  });

  it('the same day as the statement is in the next month', () => {
    withData((d) => {
      d.credit = { ...d.credit, closeDay: 4, payDay: 4 };
    });
    renderPage();
    expect(rowText(rowByTitle('Списание'), 'value')).toBe('4-го числа следующего месяца');
  });

  it('days outside 1..28 are shown as the engine uses them', () => {
    withData((d) => {
      d.credit = { ...d.credit, closeDay: 31, payDay: 0 };
    });
    renderPage();
    expect(rowText(rowByTitle('Выписка'), 'value')).toBe('28-го числа');
    expect(rowText(rowByTitle('Списание'), 'value')).toBe('1-го числа следующего месяца');
  });

  it('«Изменить настройки» opens the account settings', () => {
    render(<TabContent tab="accounts" />);
    act(() => pushPage('accounts', 'credit'));
    fireEvent.click(rowByTitle('Изменить настройки'));
    expect(currentPage('accounts')?.page).toBe('accounts-settings');
  });

  it('auto-payment off: no pay-from account and no next debit, statements say when to pay', () => {
    withData((d) => {
      d.credit.auto = false;
    });
    renderPage();
    expect(rowText(rowByTitle('Автопогашение'), 'value')).toBe('Выключено');
    expect(screen.queryByText('Со счёта')).toBeNull();
    expect(screen.queryByText('Ближайшее списание')).toBeNull();
    expect(statements()[2]).toEqual(['4 декабря 2026', 'Оплатить до 10 декабря', money(-10), true]);
    expect(statements()[3]?.[1]).toBe('Оплатить до 10 января');
  });

  it('auto-payment on but no account to take it from: says so', () => {
    withData((d) => {
      d.accounts = d.accounts.filter((a) => a.type === 'credit');
      d.credit = { ...d.credit, fromAccountId: undefined };
    });
    renderPage();
    expect(rowText(rowByTitle('Со счёта'), 'value')).toBe('Нет счёта');
    expect(plain(document.body.textContent)).toContain('Автопогашение не работает: нет счёта, с которого списывать.');
  });

  it('without a credit card: an empty state that leads to the account settings', () => {
    withData((d) => {
      d.accounts = d.accounts.filter((a) => a.type !== 'credit');
    });
    render(<TabContent tab="accounts" />);
    act(() => pushPage('accounts', 'credit'));
    expect(screen.getByText('Кредитной карты нет')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Счета и кредитка' }));
    expect(currentPage('accounts')?.page).toBe('accounts-settings');
  });

  it('a card setting that points to a deleted account says so and leads to the settings to choose another', () => {
    withData((d) => {
      d.credit.accountId = 'acc-gone';
    });
    render(<TabContent tab="accounts" />);
    act(() => pushPage('accounts', 'credit'));
    expect(screen.getByText('Карта в настройках удалена — выберите карту')).toBeTruthy();
    expect(screen.queryByText('Кредитной карты нет')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать карту' }));
    expect(currentPage('accounts')?.page).toBe('accounts-settings');
  });

  it('without a credit account the empty state does not talk about a deleted card', () => {
    withData((d) => {
      d.accounts = d.accounts.filter((a) => a.type !== 'credit');
    });
    renderPage();
    expect(screen.queryByText('Карта в настройках удалена — выберите карту')).toBeNull();
  });
});

describe('«Кредитка»: records dated after today', () => {
  const NOTE = 'включая записи на будущие даты';
  const later = (d: Data, amount: number): void => {
    d.operations.push({ id: 'o-later', date: '2026-11-20', kind: 'expense', what: 'Потом', amount, account: ACC.credit });
  };

  it('«Долг сейчас» counts them: says so and shows the debt on today next to it', () => {
    withData((d) => later(d, 25));
    renderPage();
    expect(statValue('Долг сейчас')).toBe(money(-35));
    expect(statSub('Долг сейчас')).toBe(NOTE);
    expect(statValue('Долг на сегодня')).toBe(money(-10));
  });

  it('without such records there is neither the note nor the second figure', () => {
    renderPage();
    expect(statValue('Долг сейчас')).toBe(money(-10));
    expect(statSub('Долг сейчас')).toBe('');
    expect(screen.queryByText('Долг на сегодня')).toBeNull();
  });

  it('a card that is in credit on today has no debt on today', () => {
    withData((d) => {
      later(d, 25);
      d.accounts = d.accounts.map((a) => (a.id === ACC.credit ? { ...a, start: 100 } : a));
    });
    renderPage();
    expect(statValue('Долг сейчас')).toBe(money(0));
    expect(statSub('Долг сейчас')).toBe(NOTE);
    expect(statValue('Долг на сегодня')).toBe(money(0));
  });
});

describe('«Кредитка»: statements', () => {
  it('lists the 12 statements of the accounting year and marks the current one', () => {
    renderPage();
    const rows = statements();
    expect(rows).toHaveLength(12);
    expect(rows.slice(0, 4)).toEqual([
      ['4 октября 2026', 'Без списания', money(0), false],
      ['4 ноября 2026', 'Без списания', money(0), false],
      ['4 декабря 2026', `Спишется 10 декабря: ${money(10)}`, money(-10), true],
      ['4 января 2027', 'Без списания', money(0), false],
    ]);
    expect(rows[11]?.[0]).toBe('4 сентября 2027');
    expect(rows.filter((r) => r[3])).toHaveLength(1);
  });

  it('a payment whose date has come is «Списано»; the current statement moves on', () => {
    startOn(2026, 12, 31);
    data.value = scenario();
    renderPage();
    const rows = statements();
    expect(rows[2]).toEqual(['4 декабря 2026', `Списано 10 декабря: ${money(10)}`, money(-10), false]);
    expect(rows[3]?.[3]).toBe(true);
    expect(statValue('Долг сейчас')).toBe(money(0));
  });

  it('before the balances date no statement is current', () => {
    startOn(2026, 9, 30);
    data.value = scenario();
    renderPage();
    expect(statements().filter((r) => r[3])).toHaveLength(0);
  });

  it('tapping a statement shows how its debt is made up', async () => {
    renderPage();
    fireEvent.click(statementRows()[2]!);
    const sheet = screen.getByRole('dialog', { name: 'Выписка 04.12.2026' });
    const value = (title: string) => rowText(within(sheet).getByText(title, { selector: '.row-title' }).closest('.row') as HTMLElement, 'value');
    expect(value('Период')).toBe('05.11.2026 – 04.12.2026');
    expect(value('Долг с прошлой')).toBe(money(0));
    expect(value('Погашено')).toBe(money(0));
    expect(value('Покупки')).toBe(money(-10));
    expect(value('Возвраты и переводы')).toBe(money(0));
    expect(value('Долг по выписке')).toBe(money(-10));
    expect(value('Спишется 10 декабря')).toBe(money(10));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Готово' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('the statement card of a carried debt shows the repayment', () => {
    renderPage();
    fireEvent.click(statementRows()[3]!);
    const sheet = screen.getByRole('dialog', { name: 'Выписка 04.01.2027' });
    const value = (title: string) => rowText(within(sheet).getByText(title, { selector: '.row-title' }).closest('.row') as HTMLElement, 'value');
    expect(value('Долг с прошлой')).toBe(money(-10));
    expect(value('Погашено')).toBe(money(10));
    expect(value('Долг по выписке')).toBe(money(0));
  });

  it('uses the card chosen in the settings', () => {
    withData((d) => {
      d.accounts.push({ id: 'acc-visa', name: 'Visa', type: 'credit', start: -50 });
      d.credit.accountId = 'acc-visa';
    });
    renderPage();
    expect(rowText(rowByTitle('Карта'), 'value')).toBe('Visa');
    expect(statValue('Долг сейчас')).toBe(money(0)); // the starting debt was paid on 10.10
    expect(statements()[0]).toEqual(['4 октября 2026', `Списано 10 октября: ${money(50)}`, money(-50), false]);
  });
});
