// @vitest-environment happy-dom
// «Счета» — the root screen of the tab (owner D3).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import type { Data } from '../../../src/engine';
import { ModuleLoadError } from '../../../src/ui/io';
import { Toast } from '../../../src/ui/kit';
import { currentPage } from '../../../src/ui/nav';
import { feedCheck } from '../../../src/ui/screens/Feed';
import { SheetHost, openSheet, openSheetKind } from '../../../src/ui/sheets/host';
import { data, tab } from '../../../src/ui/state';
import { TabContent } from '../../../src/ui/TabContent';
import { ACC, scenario } from '../../engine/scenario';
import { finish, money, plain, rowByTitle, rowText, startOn, statSub, statValue } from './helpers';

const mocks = vi.hoisted(() => ({
  loadReports: vi.fn(),
  accountsReport: vi.fn(),
  shareFile: vi.fn(),
}));

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

const FILE = { filename: 'Счета — Ноябрь 2026.xlsx', buffer: new Uint8Array([1, 2, 3]) };

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

function renderTab() {
  return render(
    <>
      <TabContent tab="accounts" />
      <SheetHost />
      <Toast />
    </>,
  );
}

/** The card of the section headed `name`. */
function sectionOf(name: string): HTMLElement {
  const el = screen.getByRole('heading', { level: 2, name }).closest('section');
  if (!el) throw new Error(`no section «${name}»`);
  return el as HTMLElement;
}

function withData(change: (d: Data) => void): void {
  const d = scenario();
  change(d);
  data.value = d;
}

describe('«Счета»: totals and accounts', () => {
  it('shows the totals from the engine: cards, cash, credit debt and the grand total', () => {
    renderTab();
    expect(screen.getByRole('heading', { level: 1, name: 'Счета' })).toBeTruthy();
    expect(statValue('На картах')).toBe(money(1410));
    expect(statValue('Наличные')).toBe(money(80));
    expect(statValue('Долг по кредитке')).toBe(money(-10));
    expect(statValue('Всего')).toBe(money(1480));
  });

  it('lists every account with its type and balance now; a negative balance is red', () => {
    renderTab();
    const card = rowByTitle('Карта');
    expect([rowText(card, 'subtitle'), rowText(card, 'value')]).toEqual(['Дебетовая', money(1410)]);
    const cash = rowByTitle('Наличные');
    expect([rowText(cash, 'subtitle'), rowText(cash, 'value')]).toEqual(['Наличные', money(80)]);
    const credit = rowByTitle('Кредитка');
    expect([rowText(credit, 'subtitle'), rowText(credit, 'value')]).toEqual(['Кредитная', money(-10)]);
    expect(credit.querySelector('.row-value .tone-red')).not.toBeNull();
    expect(card.querySelector('.row-value .tone-red')).toBeNull();
  });

  it('says what the balances start from', () => {
    renderTab();
    expect(plain(document.body.textContent)).toContain('Остатки на начало — на 01.10.2026');
  });

  it('a savings account is neither in «На картах» nor in «Всего»: it is in «Сбережения», outside «Всего» and the forecast', () => {
    withData((d) => d.accounts.push({ id: 'acc-save', name: 'Копилка', type: 'savings', start: 500 }));
    renderTab();
    expect(statValue('На картах')).toBe(money(1410));
    expect(statValue('Всего')).toBe(money(1480));
    expect(statValue('Сбережения')).toBe(money(500));
    expect(statSub('Сбережения')).toBe('вне «Всего» и прогноза');
    expect(rowText(rowByTitle('Копилка'), 'subtitle')).toBe('Сберегательная');
  });

  it('«Сбережения» is there without savings accounts too: 0', () => {
    renderTab();
    expect(statValue('Сбережения')).toBe(money(0));
    expect(document.querySelectorAll('.stat-card')).toHaveLength(5);
  });

  it('groups the accounts: those in the balance under «Остатки», then the savings ones under «Сбережения»', () => {
    withData((d) => {
      d.accounts.splice(1, 0, { id: 'acc-save', name: 'Копилка', type: 'savings', start: 500 });
      d.accounts.push({ id: 'acc-vklad', name: 'Вклад', type: 'savings', start: 250 });
    });
    renderTab();
    const titles = (name: string) =>
      [...sectionOf(name).querySelectorAll('.row-title')].map((el) => plain(el.textContent));
    expect(titles('Остатки')).toEqual(['Карта', 'Наличные', 'Кредитка']);
    expect(titles('Сбережения')).toEqual(['Копилка', 'Вклад']);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => plain(h.textContent));
    expect(headings.indexOf('Сбережения')).toBe(headings.indexOf('Остатки') + 1);
    // the date the balances start from is said once, under the last group
    expect(plain(sectionOf('Сбережения').textContent)).toContain('Остатки на начало — на 01.10.2026');
    expect(plain(sectionOf('Остатки').textContent)).not.toContain('Остатки на начало');
    fireEvent.click(rowByTitle('Вклад'));
    expect(currentPage('accounts')).toMatchObject({ page: 'account', params: { id: 'acc-vklad' } });
  });

  it('only savings accounts: just the «Сбережения» group', () => {
    withData((d) => {
      d.accounts = [{ id: 'acc-save', name: 'Копилка', type: 'savings', start: 500 }];
    });
    renderTab();
    expect(screen.queryByRole('heading', { level: 2, name: 'Остатки' })).toBeNull();
    expect(plain(sectionOf('Сбережения').textContent)).toContain('Копилка');
    expect([statValue('Всего'), statValue('Сбережения')]).toEqual([money(0), money(500)]);
  });

  it('without savings accounts there is no «Сбережения» group', () => {
    renderTab();
    expect(screen.queryByRole('heading', { level: 2, name: 'Сбережения' })).toBeNull();
  });

  it('tapping an account opens its page', () => {
    renderTab();
    fireEvent.click(rowByTitle('Наличные'));
    expect(currentPage('accounts')).toMatchObject({ page: 'account', params: { id: ACC.cash } });
    expect(screen.getByRole('heading', { level: 1, name: 'Наличные' })).toBeTruthy();
  });

  it('without accounts: an empty state that leads to the account settings', () => {
    withData((d) => {
      d.accounts = [];
    });
    renderTab();
    expect(screen.getByText('Счетов пока нет')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить счёт' }));
    expect(currentPage('accounts')?.page).toBe('accounts-settings');
  });
});

describe('«Счета»: the credit card', () => {
  it('shows the next auto-payment and leads to the statements', () => {
    renderTab();
    const row = rowByTitle('Выписки и списания');
    expect(rowText(row, 'subtitle')).toBe(`Спишется 10 декабря: ${money(10)}`);
    fireEvent.click(row);
    expect(currentPage('accounts')?.page).toBe('credit');
    expect(screen.getByRole('heading', { level: 1, name: 'Кредитка' })).toBeTruthy();
  });

  it('on the debit day itself the money is already taken: «Списано»', () => {
    startOn(2026, 12, 10);
    data.value = scenario();
    renderTab();
    expect(rowText(rowByTitle('Выписки и списания'), 'subtitle')).toBe(`Списано 10 декабря: ${money(10)}`);
  });

  it('the day before it is still «Спишется»', () => {
    startOn(2026, 12, 9);
    data.value = scenario();
    renderTab();
    expect(rowText(rowByTitle('Выписки и списания'), 'subtitle')).toBe(`Спишется 10 декабря: ${money(10)}`);
  });

  it('a statement with nothing to pay: «списывать нечего»', () => {
    startOn(2026, 10, 15);
    data.value = scenario();
    renderTab();
    expect(rowText(rowByTitle('Выписки и списания'), 'subtitle')).toBe('10 ноября списывать нечего');
  });

  it('auto-payment off: says so instead of a date', () => {
    withData((d) => {
      d.credit.auto = false;
    });
    renderTab();
    expect(rowText(rowByTitle('Выписки и списания'), 'subtitle')).toBe('Автопогашение выключено');
  });

  it('after the last statement of the accounting year: no more debits', () => {
    startOn(2027, 9, 20);
    data.value = scenario();
    renderTab();
    expect(rowText(rowByTitle('Выписки и списания'), 'subtitle')).toBe('До конца учётного года списаний нет');
  });

  it('without a credit card there is no statements row', () => {
    withData((d) => {
      d.accounts = d.accounts.filter((a) => a.type !== 'credit');
    });
    renderTab();
    expect(screen.queryByText('Выписки и списания')).toBeNull();
    expect(statValue('Долг по кредитке')).toBe(money(0));
  });
});

describe('«Счета»: transfer', () => {
  it('«Перевод между счетами» opens the operation form preset to a transfer', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Перевод между счетами' }));
    expect(openSheet).toHaveBeenCalledWith('operation', { preset: { kind: 'transfer' } });
    expect(openSheetKind()).toBe('operation');
  });

  it('is not offered with fewer than two accounts', () => {
    withData((d) => {
      d.accounts = d.accounts.slice(0, 1);
    });
    renderTab();
    expect(screen.queryByRole('button', { name: 'Перевод между счетами' })).toBeNull();
  });
});

describe('«Счета»: export', () => {
  it('exports balances and this month’s movements, then shares the file', async () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Выгрузить счета и движения' }));
    await waitFor(() => expect(mocks.shareFile).toHaveBeenCalledWith(FILE.filename, FILE.buffer));
    expect(mocks.accountsReport).toHaveBeenCalledWith(data.value, '2026-11-15', '2026-11');
  });

  it('before the accounting year starts, exports its first month', async () => {
    startOn(2026, 9, 30);
    data.value = scenario();
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Выгрузить счета и движения' }));
    await waitFor(() => expect(mocks.shareFile).toHaveBeenCalled());
    expect(mocks.accountsReport).toHaveBeenCalledWith(data.value, '2026-09-30', '2026-10');
  });

  it('a failed export shows why in a toast', async () => {
    mocks.loadReports.mockRejectedValue(new ModuleLoadError());
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Выгрузить счета и движения' }));
    expect(await screen.findByText('Не удалось загрузить модуль, проверьте подключение.')).toBeTruthy();
    expect(mocks.shareFile).not.toHaveBeenCalled();
  });

  it('the button is disabled while the file is being made (no double export)', async () => {
    let release: (v: typeof FILE) => void = () => {};
    mocks.accountsReport.mockReturnValue(new Promise((r) => (release = r)));
    renderTab();
    const button = screen.getByRole('button', { name: 'Выгрузить счета и движения' }) as HTMLButtonElement;
    fireEvent.click(button);
    await waitFor(() => expect(button.disabled).toBe(true));
    fireEvent.click(button);
    await act(async () => release(FILE));
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(mocks.accountsReport).toHaveBeenCalledTimes(1);
  });
});

describe('«Счета»: warnings', () => {
  const bannerTexts = (): string[] =>
    Array.from(document.querySelectorAll('.banner .banner-text')).map((el) => plain(el.textContent));

  it('none for the scenario (its duplicates and out-of-year rows belong to «Лента»)', () => {
    renderTab();
    expect(bannerTexts()).toEqual([]);
  });

  it('explains rows that reach no balance', () => {
    withData((d) => {
      d.operations.push({ id: 'o-none', date: '2026-10-16', kind: 'expense', what: 'Без счёта', amount: 12.5 });
      d.operations.push({ id: 'o-nowhere', date: '2026-10-16', kind: 'transfer', what: 'Куда-то', amount: 40, account: ACC.card });
      d.journal.push({ id: 'j-gone', date: '2026-10-17', kind: 'expense', what: 'Старый', plan: 5, status: 'paid', account: 'acc-gone' });
      d.recurring.push({ id: 'r-noday', what: 'Без дня', kind: 'expense', amount: 7, account: ACC.card, marks: { '2026-10': '✓' } });
    });
    renderTab();
    expect(bannerTexts()).toEqual([
      `Оплачено без счёта: ${money(12.5)} (записей: 1). Этих денег нет ни в одном остатке — укажите счёт.`,
      'Переводов без счёта зачисления: 1. Деньги ушли со счёта, но никуда не пришли — укажите, на какой счёт.',
      'Ссылок на удалённый счёт: 1. Такие записи не попадают в остатки — выберите другой счёт.',
      'Постоянных платежей с отметками, но без дня: 1. Без даты они не попадают в остатки — укажите день.',
    ]);
    const [unassigned, transfers] = Array.from(document.querySelectorAll<HTMLElement>('.banner'));
    // «без счёта» opens «Лента» filtered to those rows (as «Сегодня» does), a transfer without «На счёт» to the rows
    // with a check of a transfer; the others open it as it is
    fireEvent.click(within(unassigned!).getByRole('button', { name: 'Открыть ленту' }));
    expect(tab.value).toBe('feed');
    expect(feedCheck.value).toBe('unassigned');
    tab.value = 'accounts';
    fireEvent.click(within(transfers!).getByRole('button', { name: 'Открыть ленту' }));
    expect(tab.value).toBe('feed');
    expect(feedCheck.value).toBe('transfers');
    tab.value = 'accounts';
    const deleted = Array.from(document.querySelectorAll<HTMLElement>('.banner'))[2];
    fireEvent.click(within(deleted!).getByRole('button', { name: 'Открыть ленту' }));
    expect(feedCheck.value).toBeNull();
  });

  it('a deleted account in the credit settings has its own notice that leads to the settings, not to «Лента»', () => {
    withData((d) => {
      d.credit.accountId = 'acc-gone';
    });
    renderTab();
    expect(bannerTexts()).toEqual([
      'В настройках кредитки указан удалённый счёт. Выписки и автопогашение считаются неверно — выберите другой счёт.',
    ]);
    const banner = document.querySelector('.banner') as HTMLElement;
    expect(within(banner).queryByRole('button', { name: 'Открыть ленту' })).toBeNull();
    fireEvent.click(within(banner).getByRole('button', { name: 'Открыть настройки' }));
    expect(currentPage('accounts')?.page).toBe('accounts-settings');
  });

  it('the same for a deleted account to take the auto-payments from', () => {
    withData((d) => {
      d.credit.fromAccountId = 'acc-gone';
    });
    renderTab();
    expect(bannerTexts()).toEqual([
      'В настройках кредитки указан удалённый счёт. Выписки и автопогашение считаются неверно — выберите другой счёт.',
    ]);
  });

  it('records and settings that point to deleted accounts get one notice each; the records one counts records only', () => {
    withData((d) => {
      d.credit.accountId = 'acc-gone';
      d.credit.fromAccountId = 'acc-gone-too';
      d.journal.push({ id: 'j-gone', date: '2026-10-17', kind: 'expense', what: 'Старый', plan: 5, status: 'paid', account: 'acc-gone' });
    });
    renderTab();
    expect(bannerTexts()).toEqual([
      'Ссылок на удалённый счёт: 1. Такие записи не попадают в остатки — выберите другой счёт.',
      'В настройках кредитки указан удалённый счёт. Выписки и автопогашение считаются неверно — выберите другой счёт.',
    ]);
    const [records, settings] = Array.from(document.querySelectorAll<HTMLElement>('.banner'));
    fireEvent.click(within(records!).getByRole('button', { name: 'Открыть ленту' }));
    expect(tab.value).toBe('feed');
    fireEvent.click(within(settings!).getByRole('button', { name: 'Открыть настройки' }));
    expect(currentPage('accounts')?.page).toBe('accounts-settings');
  });
});
