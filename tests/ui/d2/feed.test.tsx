// @vitest-environment happy-dom
// «Лента»: month, filters, summary, rows grouped by date, «+» and the month report.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { emptyData, monthItems, monthSummary } from '../../../src/engine';
import type { Data, FeedItem } from '../../../src/engine';
import { useFactory } from '../../../src/store/db';
import { actions } from '../../../src/ui/actions';
import { formatMoney } from '../../../src/ui/format';
import { ModuleLoadError, loadReports } from '../../../src/ui/io';
import { OverlayHost, Toast } from '../../../src/ui/kit';
import { Feed, feedCheck, feedFilter, feedRow, filterItems, groupByDate, openFeedCheck } from '../../../src/ui/screens/Feed';
import { shareFile } from '../../../src/ui/share';
import { SheetHost, openSheetKind } from '../../../src/ui/sheets/host';
import { data, feedMonth, resetSession, tab } from '../../../src/ui/state';
import { ACC, scenario } from '../../engine/scenario';
import { button, plain, toastText } from './helpers';

vi.mock('../../../src/ui/io', async (orig) => ({ ...(await orig<typeof import('../../../src/ui/io')>()), loadReports: vi.fn() }));
vi.mock('../../../src/ui/share', async (orig) => ({ ...(await orig<typeof import('../../../src/ui/share')>()), shareFile: vi.fn() }));

beforeEach(() => {
  useFactory(new IDBFactory());
  resetSession();
  data.value = scenario();
  feedMonth.value = '2026-10';
  vi.mocked(loadReports).mockReset();
  vi.mocked(shareFile).mockReset();
});

afterEach(async () => {
  cleanup();
  await actions.flush();
  resetSession();
  useFactory(undefined);
});

const october = (d: Data = scenario()): FeedItem[] => monthItems(d, '2026-10');
const byId = (items: FeedItem[], id: string): FeedItem => {
  const found = items.find((i) => i.id === id);
  if (!found) throw new Error(`no feed item ${id}`);
  return found;
};

function renderFeed() {
  return render(
    <>
      <Feed />
      <SheetHost />
      <Toast />
    </>,
  );
}

/** Titles of the date sections in order. */
function dateHeaders(): string[] {
  return Array.from(document.querySelectorAll('.section-header')).map((h) => h.textContent ?? '');
}

/** The feed rows (buttons inside the date sections), in order. */
function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.section .row-button'));
}

/** Titles of the feed rows, in order. */
function rowTitles(): string[] {
  return rows().map((b) => b.querySelector('.feed-title')?.textContent ?? '');
}

/** The rows titled `title`, in order. */
function rowsTitled(title: string): HTMLElement[] {
  return rows().filter((b) => b.querySelector('.feed-title')?.textContent === title);
}

/** The first row titled `title`. */
function rowTitled(title: string): HTMLElement {
  const found = rowsTitled(title)[0];
  if (!found) throw new Error(`no row «${title}»`);
  return found;
}

describe('filterItems', () => {
  it('«Все» keeps every item of the month', () => {
    expect(filterItems(october(), 'all')).toHaveLength(16);
  });

  it('«Траты»: expenses only — no income, no transfers', () => {
    const ids = filterItems(october(), 'expense').map((i) => i.id);
    expect(ids).toHaveLength(11);
    expect(ids).toEqual(expect.arrayContaining(['j-eda', 'r-arenda', 'o-kafe', 'j-otmena', 'j-vozvrat', 'o-bilet']));
    expect(ids).not.toContain('o-snyatie');
    expect(ids).not.toContain('j-zp');
  });

  it('«Доходы»: income only', () => {
    expect(filterItems(october(), 'income').map((i) => i.id).sort()).toEqual(['j-zp', 'o-keshbek', 'r-bonus']);
  });

  it('«Не оплачено»: planned and postponed, never paid or cancelled', () => {
    const d = scenario();
    d.journal.push({ id: 'j-later', date: '2026-10-25', kind: 'expense', what: 'Потом', plan: 40, status: 'postponed' });
    expect(filterItems(october(d), 'unpaid').map((i) => i.id).sort()).toEqual(['j-arenda', 'j-eda', 'j-later']);
  });
});

describe('groupByDate', () => {
  it('groups consecutive items by date, in date order, items without a date last', () => {
    const d = scenario();
    d.recurring.push({ id: 'r-noday', what: 'Без дня', kind: 'expense', amount: 5, marks: {} });
    const groups = groupByDate(october(d));
    expect(groups.map((g) => g.date)).toEqual([
      '2026-10-01', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10',
      '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-20', '2026-10-21', undefined,
    ]);
    expect(groups[1]?.items.map((i) => i.id)).toEqual(['j-eda', 'r-arenda']);
    expect(groups[12]?.items.map((i) => i.id)).toEqual(['r-noday']);
  });

  it('nothing → no groups', () => {
    expect(groupByDate([])).toEqual([]);
  });
});

describe('feedRow', () => {
  const d = scenario();
  const items = october(d);

  it('a planned journal row: plan, «план», category · account, calendar icon', () => {
    expect(feedRow(byId(items, 'j-eda'), d)).toMatchObject({
      title: 'Еда', subtitle: 'Продукты · Карта', icon: 'calendar', kind: 'expense', amount: 100, caption: 'план',
      check: false, cancelled: false, amountStruck: false, duplicate: false,
    });
  });

  it('a paid recurring payment: the fact with a check, repeat icon', () => {
    expect(feedRow(byId(items, 'r-arenda'), d)).toMatchObject({
      title: 'Аренда', subtitle: 'Жильё · Карта', icon: 'repeat', amount: 900, check: true,
    });
    expect(feedRow(byId(items, 'r-arenda'), d).caption).toBeUndefined();
  });

  it('a paid journal row with its own fact shows the fact', () => {
    expect(feedRow(byId(items, 'j-taxi'), d)).toMatchObject({ amount: 90, check: true });
  });

  it('a cancelled row is struck through: its old plan when nothing was paid, the fact when something was', () => {
    expect(feedRow(byId(items, 'j-otmena'), d)).toMatchObject({ amount: 100, cancelled: true, amountStruck: true, caption: 'отменено' });
    expect(feedRow(byId(items, 'j-shtraf'), d)).toMatchObject({ amount: 15, cancelled: true, amountStruck: false, caption: 'отменено' });
  });

  it('a postponed row says so, and that its amount is the plan', () => {
    const d2 = scenario();
    d2.journal.push({ id: 'j-later', date: '2026-10-25', kind: 'expense', what: 'Потом', plan: 40, status: 'postponed' });
    expect(feedRow(byId(october(d2), 'j-later'), d2)).toMatchObject({ amount: 40, caption: 'план · перенесено', check: false });
  });

  it('a fact is never labelled «план»: a planned row with plan 100 and fact 40 shows 40 as «факт», without a check', () => {
    const d2 = scenario();
    d2.journal.push({ id: 'j-part', date: '2026-10-22', kind: 'expense', what: 'Частично', plan: 100, fact: 40, status: 'planned' });
    const view = feedRow(byId(october(d2), 'j-part'), d2);
    expect(view).toMatchObject({ amount: 40, caption: 'факт', check: false, cancelled: false });
  });

  it('a postponed row with a fact: the fact, «факт» and «перенесено»', () => {
    const d2 = scenario();
    d2.journal.push({ id: 'j-part', date: '2026-10-22', kind: 'expense', what: 'Частично', plan: 100, fact: 40, status: 'postponed' });
    expect(feedRow(byId(october(d2), 'j-part'), d2)).toMatchObject({ amount: 40, caption: 'факт · перенесено', check: false });
  });

  it('a planned row whose fact is 0 still shows its plan; only a paid row has the check and no caption', () => {
    const d2 = scenario();
    d2.journal.push({ id: 'j-zero', date: '2026-10-22', kind: 'expense', what: 'Ноль', plan: 100, fact: 0, status: 'planned' });
    expect(feedRow(byId(october(d2), 'j-zero'), d2)).toMatchObject({ amount: 100, caption: 'план', check: false });
    expect(feedRow(byId(october(d2), 'j-taxi'), d2)).toMatchObject({ amount: 90, check: true });
    expect(feedRow(byId(october(d2), 'j-taxi'), d2).caption).toBeUndefined();
  });

  it('operations: cart for an expense, plus-circle for income, arrows for a transfer (from → to); no check', () => {
    expect(feedRow(byId(items, 'o-bilet'), d)).toMatchObject({ icon: 'cart', amount: 20, check: false, subtitle: 'Транспорт · Наличные' });
    expect(feedRow(byId(items, 'o-bilet'), d).caption).toBeUndefined();
    expect(feedRow(byId(items, 'o-keshbek'), d)).toMatchObject({ icon: 'plus-circle', kind: 'income', amount: 5 });
    expect(feedRow(byId(items, 'o-snyatie'), d)).toMatchObject({ icon: 'arrows', kind: 'transfer', subtitle: 'Карта → Наличные', amount: 100 });
  });

  it('a purchase has the cart icon; the sign of an operation does not matter', () => {
    const d2 = scenario();
    d2.purchases.push({ id: 'p-tel', what: 'Телефон', cost: 300, date: '2026-10-15', bought: false });
    expect(feedRow(byId(october(d2), 'p-tel'), d2)).toMatchObject({ icon: 'cart', amount: 300, caption: 'план', subtitle: undefined });
    expect(feedRow(byId(items, 'o-magazin'), d)).toMatchObject({ amount: 30, subtitle: 'Продукты · Кредитка' });
  });

  it('possible duplicates are flagged', () => {
    expect(feedRow(byId(items, 'o-kafe'), d).duplicate).toBe(true);
    expect(feedRow(byId(items, 'j-arenda'), d).duplicate).toBe(true);
    expect(feedRow(byId(items, 'j-kafe'), d).duplicate).toBe(false);
  });

  it('a row without a name is called by its category, or «Перевод» / «Без названия»', () => {
    const d2 = scenario();
    d2.operations.push(
      { id: 'o-1', date: '2026-10-02', kind: 'expense', category: 'Продукты', what: '', amount: 3, account: ACC.cash },
      { id: 'o-2', date: '2026-10-02', kind: 'transfer', what: '', amount: 3, account: ACC.card, toAccount: ACC.cash },
      { id: 'o-3', date: '2026-10-02', kind: 'expense', what: '  ', amount: 3 },
    );
    const it2 = october(d2);
    expect(feedRow(byId(it2, 'o-1'), d2).title).toBe('Продукты');
    expect(feedRow(byId(it2, 'o-2'), d2).title).toBe('Перевод');
    expect(feedRow(byId(it2, 'o-3'), d2).title).toBe('Без названия');
    expect(feedRow(byId(it2, 'o-3'), d2).subtitle).toBeUndefined();
  });

  it('an account that no longer exists is named so', () => {
    const d2 = scenario();
    d2.operations.push({ id: 'o-gone', date: '2026-10-02', kind: 'expense', what: 'Старое', amount: 3, account: 'acc-gone' });
    expect(feedRow(byId(october(d2), 'o-gone'), d2).subtitle).toBe('(удалённый счёт)');
  });
});

describe('«Лента» screen', () => {
  it('shows the month, the summary from the engine and the rows grouped by date', () => {
    renderFeed();
    expect(screen.getByRole('heading', { level: 1, name: 'Лента' })).toBeTruthy();
    expect(screen.getByText('Октябрь 2026')).toBeTruthy();
    const s = monthSummary(scenario(), '2026-10');
    // «Доход», then «Расход», each with its plan: the same block as «Сегодня» and «Отчёты»
    const cards = Array.from(document.querySelectorAll('.stat-grid .stat-card')).map((c) => plain(c.textContent));
    expect(cards).toEqual([
      `Доход${plain(formatMoney(s.incomeFact))}план ${plain(formatMoney(s.incomePlan))}`,
      `Расход${plain(formatMoney(s.expenseFact))}план ${plain(formatMoney(s.expensePlan))}`,
    ]);
    expect(plain(formatMoney(s.expenseFact))).toBe('1 235,00 €');
    expect(dateHeaders()).toEqual([
      '1 октября', '5 октября', '6 октября', '7 октября', '8 октября', '9 октября', '10 октября', '12 октября',
      '13 октября', '14 октября', '20 октября', '21 октября',
    ]);
    expect(rows()).toHaveLength(16);
    const eda = rowTitled('Еда');
    expect(plain(eda.textContent)).toContain('Продукты · Карта');
    expect(plain(eda.textContent)).toContain('100,00 €');
    expect(plain(eda.textContent)).toContain('план');
    const [rentPaid, rentPlanned] = rowsTitled('Аренда');
    expect(within(rentPaid!).getByRole('img', { name: 'Оплачено' })).toBeTruthy();
    expect(within(rentPlanned!).queryByRole('img', { name: 'Оплачено' })).toBeNull();
    expect(plain(rowTitled('ЗП').textContent)).toContain('+3 000,00 €');
  });

  it('a planned row with a fact shows «40,00 €» captioned «факт», not «план»', () => {
    const d2 = scenario();
    d2.journal.push({ id: 'j-part', date: '2026-10-22', kind: 'expense', what: 'Частично', plan: 100, fact: 40, status: 'planned' });
    data.value = d2;
    renderFeed();
    const part = rowTitled('Частично');
    const text = plain(part.textContent);
    expect(text).toContain('40,00 €');
    expect(text).toContain('факт');
    expect(text).not.toContain('план');
    expect(text).not.toContain('100,00 €');
    expect(within(part).queryByRole('img', { name: 'Оплачено' })).toBeNull();
  });

  it('the icon square takes the colour of the kind through the kit (a cancelled row: grey)', () => {
    renderFeed();
    const tone = (row: HTMLElement) => row.querySelector('.row-icon')?.className;
    expect(tone(rowTitled('Еда'))).toBe('row-icon');
    expect(tone(rowTitled('ЗП'))).toBe('row-icon row-icon-green');
    expect(tone(rowTitled('Отмена'))).toBe('row-icon row-icon-muted');
    const transfer = rows().find((r) => r.querySelector('.row-icon-teal'));
    expect(transfer).toBeTruthy();
  });

  it('a row is read with its parts apart: «Еда, Продукты · Карта, 100,00 €, план»', () => {
    renderFeed();
    const spoken = (n: string) => plain(n).replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim();
    expect(screen.getByRole('button', { name: (n) => spoken(n) === 'Еда, Продукты · Карта, 100,00 €, план' })).toBeTruthy();
  });

  it('marks possible duplicates «дубль?» and strikes cancelled rows through', () => {
    renderFeed();
    const [kafeOperation, kafeJournal] = rowsTitled('Кафе');
    expect(kafeOperation?.textContent).toContain('дубль?');
    expect(kafeJournal?.textContent).not.toContain('дубль?');
    expect(rowsTitled('Аренда')[1]?.textContent).toContain('дубль?');
    expect(screen.getByRole('button', { name: /^Аренда дубль\?/ })).toBeTruthy();
    expect(rowTitled('Отмена').querySelector('.feed-struck')).not.toBeNull();
    expect(rowTitled('Еда').querySelector('.feed-struck')).toBeNull();
  });

  it('filters: «Доходы», «Не оплачено»; the filter survives leaving the tab', () => {
    const { unmount } = renderFeed();
    fireEvent.click(screen.getByRole('radio', { name: 'Доходы' }));
    expect(rowTitles()).toEqual(['ЗП', 'ЗП бонус', 'Кэшбэк']);
    fireEvent.click(screen.getByRole('radio', { name: 'Не оплачено' }));
    expect(rowTitles()).toEqual(['Еда', 'Аренда']);
    expect(dateHeaders()).toEqual(['5 октября', '20 октября']);
    unmount();
    renderFeed();
    expect(screen.getByRole('radio', { name: 'Не оплачено' }).getAttribute('aria-checked')).toBe('true');
    expect(rowTitles()).toEqual(['Еда', 'Аренда']);
  });

  it('an empty filter result says why', () => {
    const d = scenario();
    d.journal = d.journal.filter((r) => r.id !== 'j-eda' && r.id !== 'j-arenda');
    data.value = d;
    renderFeed();
    fireEvent.click(screen.getByRole('radio', { name: 'Не оплачено' }));
    expect(screen.getByText('Всё оплачено')).toBeTruthy();
  });

  it('the month picker steps through the accounting months and is shared with the rest of the app', () => {
    renderFeed();
    fireEvent.click(button('Следующий месяц'));
    expect(feedMonth.value).toBe('2026-11');
    expect(screen.getByText('Ноябрь 2026')).toBeTruthy();
    expect(rowsTitled('Ноябрь')).toHaveLength(1);
    expect(plain(rowTitled('Аренда').textContent)).toContain('950,00 €');
    act(() => {
      feedMonth.value = '2026-10';
    });
    expect(button('Предыдущий месяц').disabled).toBe(true);
  });

  it('an empty month shows an empty state', () => {
    data.value = emptyData('2026-09-30');
    feedMonth.value = '2026-09';
    renderFeed();
    expect(screen.getByText('Записей нет')).toBeTruthy();
  });

  it('tapping a row opens its card; «+» opens the add menu', () => {
    renderFeed();
    fireEvent.click(rowTitled('Еда'));
    expect(openSheetKind()).toBe('item');
    expect(screen.getByRole('dialog', { name: 'Плановая запись' }).textContent).toContain('Еда');
    fireEvent.click(button('Добавить'));
    expect(openSheetKind()).toBe('add');
    expect(screen.getByRole('dialog', { name: 'Добавить' })).toBeTruthy();
  });

  it('the download button shares the month report of the shown month', async () => {
    const buffer = new ArrayBuffer(8);
    const monthReport = vi.fn(async () => ({ filename: 'Отчёт — Ноябрь 2026.xlsx', buffer }));
    vi.mocked(loadReports).mockResolvedValue({ monthReport } as unknown as Awaited<ReturnType<typeof loadReports>>);
    vi.mocked(shareFile).mockResolvedValue('shared');
    renderFeed();
    fireEvent.click(button('Следующий месяц'));
    fireEvent.click(button('Выгрузить отчёт за месяц'));
    await waitFor(() => expect(shareFile).toHaveBeenCalledWith('Отчёт — Ноябрь 2026.xlsx', buffer));
    expect(monthReport).toHaveBeenCalledWith(data.value, '2026-11');
  });

  it('a failed export shows why in a toast and changes nothing', async () => {
    vi.mocked(loadReports).mockRejectedValue(new ModuleLoadError());
    const before = data.value;
    renderFeed();
    fireEvent.click(button('Выгрузить отчёт за месяц'));
    await waitFor(() => expect(toastText()).toBe('Не удалось загрузить модуль, проверьте подключение.'));
    expect(shareFile).not.toHaveBeenCalled();
    expect(data.value).toBe(before);
  });
});

describe('«Лента»: focus after deleting from the card (never <body>)', () => {
  function renderInShell() {
    return render(
      <OverlayHost>
        <Feed />
        <SheetHost />
        <Toast />
      </OverlayHost>,
    );
  }

  it('card → «Удалить» → confirm: focus on the «Лента» heading once the card has gone; after «Отменить» too', async () => {
    renderInShell();
    const heading = screen.getByRole('heading', { level: 1, name: 'Лента' });
    const opener = rowTitled('Еда');
    opener.focus();
    fireEvent.click(opener);
    const card = screen.getByRole('dialog', { name: 'Плановая запись' });
    await waitFor(() => expect(card.contains(document.activeElement)).toBe(true));
    const del = within(card).getByRole('button', { name: 'Удалить' });
    del.focus();
    fireEvent.click(del);
    const confirm = screen.getByRole('alertdialog', { name: 'Удалить запись?' });
    await waitFor(() => expect(confirm.contains(document.activeElement)).toBe(true));
    fireEvent.click(within(confirm).getByRole('button', { name: 'Удалить' }));
    expect(data.value?.journal.some((r) => r.id === 'j-eda')).toBe(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement).toBe(heading);

    // a click on «Отменить» focuses it in a desktop browser; the toast then goes away
    const undo = button('Отменить');
    undo.focus();
    fireEvent.click(undo);
    expect(data.value?.journal.some((r) => r.id === 'j-eda')).toBe(true);
    await waitFor(() => expect(toastText()).toBe('Отменено'));
    expect(document.activeElement).toBe(heading);
  });

  it('card → «Изменить» → the form’s «Удалить» → confirm: focus on the heading too', async () => {
    renderInShell();
    const opener = rowTitled('Билет');
    opener.focus();
    fireEvent.click(opener);
    const card = screen.getByRole('dialog', { name: 'Операция' });
    await waitFor(() => expect(card.contains(document.activeElement)).toBe(true));
    fireEvent.click(within(card).getByRole('button', { name: 'Изменить' }));
    const form = screen.getByRole('dialog', { name: 'Операция' });
    await waitFor(() => expect(form.contains(document.activeElement)).toBe(true));
    const del = within(form).getByRole('button', { name: 'Удалить' });
    del.focus();
    fireEvent.click(del);
    const confirm = screen.getByRole('alertdialog', { name: 'Удалить операцию?' });
    await waitFor(() => expect(confirm.contains(document.activeElement)).toBe(true));
    fireEvent.click(within(confirm).getByRole('button', { name: 'Удалить' }));
    expect(data.value?.operations.some((o) => o.id === 'o-bilet')).toBe(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Лента' }));
  });
});

describe('«Лента»: the paid check says what happened, by source', () => {
  it('«Оплачено» for an expense, «Получено» for income, «Куплено» for a purchase', () => {
    feedMonth.value = '2026-12';
    const d = scenario();
    d.journal.push({ id: 'j-dec-inc', date: '2026-12-01', kind: 'income', what: 'Возврат', plan: 10, status: 'paid', account: ACC.card });
    d.journal.push({ id: 'j-dec-exp', date: '2026-12-02', kind: 'expense', what: 'Врач', plan: 10, status: 'paid', account: ACC.card });
    data.value = d;
    renderFeed();
    expect(within(rowTitled('Возврат')).getByRole('img', { name: 'Получено' })).toBeTruthy();
    expect(within(rowTitled('Врач')).getByRole('img', { name: 'Оплачено' })).toBeTruthy();
    expect(within(rowTitled('Ноутбук')).getByRole('img', { name: 'Куплено' })).toBeTruthy();
  });

  it('a received recurring income is «Получено» too', () => {
    renderFeed();
    expect(within(rowTitled('ЗП бонус')).getByRole('img', { name: 'Получено' })).toBeTruthy();
  });
});

describe('«Лента»: the checks of «Сегодня» (без счёта, дубли)', () => {
  /** October with two rows paid without an account, one planned without one (not a problem yet), November with one. */
  function withUnassigned(): Data {
    const d = scenario();
    d.journal.push(
      { id: 'j-noacc', date: '2026-10-16', kind: 'expense', category: 'Продукты', what: 'Рынок', plan: 25, status: 'paid' },
      { id: 'j-plan-noacc', date: '2026-10-17', kind: 'expense', what: 'Потом', plan: 5 },
      { id: 'j-nov-noacc', date: '2026-11-03', kind: 'expense', what: 'Ноябрьский', plan: 7, status: 'paid' },
    );
    d.operations.push({ id: 'o-noacc', date: '2026-10-18', kind: 'expense', category: 'Продукты', what: 'Ларёк', amount: 3 });
    return d;
  }

  it('feedRow: «без счёта» for a row that counts without an account (as the engine’s warning), not for a plan', () => {
    const d = withUnassigned();
    const items = october(d);
    expect(feedRow(byId(items, 'j-noacc'), d).unassigned).toBe(true);
    expect(feedRow(byId(items, 'o-noacc'), d).unassigned).toBe(true);
    expect(feedRow(byId(items, 'j-plan-noacc'), d).unassigned).toBe(false);
    expect(feedRow(byId(items, 'j-eda'), d).unassigned).toBe(false);
  });

  it('rows paid without an account are marked «без счёта»', () => {
    data.value = withUnassigned();
    renderFeed();
    expect(rowTitled('Рынок').textContent).toContain('без счёта');
    expect(rowTitled('Ларёк').textContent).toContain('без счёта');
    expect(rowTitled('Потом').textContent).not.toContain('без счёта');
    expect(rowTitled('Еда').textContent).not.toContain('без счёта');
    expect(screen.getByRole('button', { name: /^Рынок без счёта/ })).toBeTruthy();
  });

  it('the «без счёта» filter shows only those rows, says so, and «Показать все» brings the month back', () => {
    data.value = withUnassigned();
    feedCheck.value = 'unassigned';
    renderFeed();
    expect(rowTitles()).toEqual(['Рынок', 'Ларёк']);
    expect(screen.getByText(/Только записи без счёта/)).toBeTruthy();
    fireEvent.click(button('Показать все'));
    expect(feedCheck.value).toBeNull();
    expect(rowTitles()).toContain('Еда');
    expect(screen.queryByText(/Только записи без счёта/)).toBeNull();
  });

  it('the «дубли» filter shows only the rows flagged «дубль?»', () => {
    feedCheck.value = 'duplicates';
    renderFeed();
    expect(rowTitles()).toEqual(['Кафе', 'Аренда']);
    expect(rows().every((r) => r.textContent?.includes('дубль?'))).toBe(true);
    expect(screen.getByText(/Только возможные дубли/)).toBeTruthy();
  });

  it('a month without such rows says so (another month has them)', () => {
    const d = scenario();
    d.journal.push({ id: 'j-nov-noacc', date: '2026-11-03', kind: 'expense', what: 'Ноябрьский', plan: 7, status: 'paid' });
    data.value = d;
    feedCheck.value = 'unassigned';
    renderFeed();
    expect(screen.getByText('В этом месяце таких записей нет')).toBeTruthy();
    expect(screen.getByText(/^Только записи без счёта/)).toBeTruthy();
  });

  it('a check that finds nothing in any accounting month shows no note: «Лента» as usual (the filter is dropped)', async () => {
    const d = scenario();
    d.purchases.push({ id: 'p-nodate', what: 'Чайник', cost: 30, bought: true }); // without an account, but no date
    data.value = d;
    feedCheck.value = 'unassigned'; // left on, e.g. the last such row was just fixed
    renderFeed();
    expect(screen.queryByText(/^Только записи без счёта/)).toBeNull();
    expect(screen.queryByText('В этом месяце таких записей нет')).toBeNull();
    expect(rowTitles()).toContain('Еда');
    await waitFor(() => expect(feedCheck.value).toBeNull());
  });

  it('openFeedCheck with nothing «Лента» can show: no filter', () => {
    const d = scenario();
    d.operations.push({ id: 'o-out-noacc', date: '2027-11-02', kind: 'expense', what: 'Потом', amount: 4 }); // outside the year
    data.value = d;
    openFeedCheck('unassigned');
    expect(tab.value).toBe('feed');
    expect(feedCheck.value).toBeNull();
  });

  it('openFeedCheck: opens «Лента» with the filter, at the shown month when it has such rows, else the first that has', () => {
    data.value = withUnassigned();
    feedFilter.value = 'income';
    feedMonth.value = '2026-11';
    openFeedCheck('unassigned');
    expect(tab.value).toBe('feed');
    expect(feedCheck.value).toBe('unassigned');
    expect(feedFilter.value).toBe('all'); // the segment would hide some of them
    expect(feedMonth.value).toBe('2026-11'); // November has one
    feedMonth.value = '2027-02';
    openFeedCheck('unassigned');
    expect(feedMonth.value).toBe('2026-10'); // February has none: the first month that has
    openFeedCheck('duplicates');
    expect(feedMonth.value).toBe('2026-10');
  });
});
