// @vitest-environment happy-dom
// Planned and recurring transfers on the screens (spec 2026-10-01-planned-transfers): the type «Перевод» and «На счёт»
// in the planned record and recurring payment forms, the hint «Похоже на перевод…», «Лента» (transfers, their checks,
// the automatic card repayment), «Сегодня» (one tap), «Отчёты» → «Месяц», «Постоянные платежи», the item card and the
// warnings of «Счета». Data: the tracker's transfers scenario.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { ROW_CHECK_LABEL, warnings } from '../../src/engine';
import type { Data, JournalRow, Recurring } from '../../src/engine';
import * as db from '../../src/store/db';
import { actions } from '../../src/ui/actions';
import { formatMoney } from '../../src/ui/format';
import { OverlayHost, Toast } from '../../src/ui/kit';
import { RecurringPage } from '../../src/ui/pages/RecurringPage';
import { Accounts } from '../../src/ui/screens/Accounts';
import { Feed, feedCheck } from '../../src/ui/screens/Feed';
import { Reports } from '../../src/ui/screens/Reports';
import { Today, checkRows } from '../../src/ui/screens/Today';
import { SheetHost, openSheet, openSheetKind } from '../../src/ui/sheets/host';
import { data, feedMonth, meta as appMeta, resetSession } from '../../src/ui/state';
import { row } from '../engine/scenario';
import { TR, transfersScenario } from '../engine/transfersScenario';
import { button, choose, toastText, type } from './d2/helpers';

vi.mock('chart.js/auto', () => ({
  default: class {
    update() {}
    destroy() {}
  },
}));

/** Text with runs of spaces and no-break spaces as one plain space. */
const plain = (s: string | null | undefined): string => (s ?? '').replace(/[\s  ]+/g, ' ').trim();
const money = (n: number): string => plain(formatMoney(n));
const LOOKS_LIKE = ROW_CHECK_LABEL.looksLikeTransfer;

function setToday(y: number, m: number, d: number): void {
  vi.setSystemTime(new Date(y, m - 1, d, 12, 0));
  resetSession(); // re-reads today()
}

const current = (): Data => {
  if (!data.value) throw new Error('no data');
  return data.value;
};

function host(children?: preact.ComponentChildren) {
  return render(
    <>
      {children}
      <SheetHost />
      <OverlayHost />
      <Toast />
    </>,
  );
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement & HTMLSelectElement;
const optionLabels = (label: string): string[] => Array.from(field(label).options).map((o) => o.textContent ?? '');

beforeEach(() => {
  db.useFactory(new IDBFactory());
  vi.useFakeTimers({ toFake: ['Date'] });
  setToday(2026, 12, 20);
  appMeta.value = { failedAttempts: 0, lastBackupAt: new Date().toISOString() };
  data.value = transfersScenario();
});

afterEach(async () => {
  cleanup();
  await actions.flush();
  vi.useRealTimers();
  resetSession();
  db.useFactory(undefined);
});

// ── the planned record form ─────────────────────────────────────────────────────────────────────────────────────
describe('JournalForm — «Перевод»', () => {
  const openForm = (props: { initial?: JournalRow } = {}) => {
    host();
    act(() => openSheet('journal', props));
  };

  it('the kind switch has «Перевод»: no category, «Со счёта» and «На счёт» instead of «Счёт»', () => {
    openForm();
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['Расход', 'Доход', 'Перевод']);
    fireEvent.click(screen.getByRole('radio', { name: 'Перевод' }));
    expect(screen.queryByLabelText('Категория')).toBeNull();
    expect(screen.queryByLabelText('Счёт')).toBeNull();
    expect(field('Со счёта').value).toBe(TR.card);
    expect(field('На счёт').value).toBe('');
    expect(optionLabels('На счёт')).toEqual(['Не выбран', 'Карта', 'Наличные', 'Кредитка', 'Копилка', 'Вклад']);
  });

  it('a transfer needs «На счёт», another account than «Со счёта»; then it saves', () => {
    openForm();
    const before = current();
    fireEvent.click(screen.getByRole('radio', { name: 'Перевод' }));
    type(field('Что'), 'В копилку');
    type(field('Дата'), '2026-12-22');
    type(field('План'), '250');
    fireEvent.click(button('Сохранить'));
    expect(screen.getByText('Выберите счёт')).toBeTruthy();
    expect(current()).toBe(before);
    choose(field('На счёт'), TR.card);
    expect(screen.getByText('Счета должны различаться')).toBeTruthy();
    fireEvent.click(button('Сохранить'));
    expect(current()).toBe(before);
    choose(field('На счёт'), TR.box);
    fireEvent.click(button('Сохранить'));
    expect(current().journal.at(-1)).toEqual({
      id: expect.any(String), date: '2026-12-22', kind: 'transfer', what: 'В копилку', plan: 250, status: 'planned',
      account: TR.card, toAccount: TR.box,
    });
    expect(toastText()).toBe('Сохранено');
  });

  it('a category chosen before switching to «Перевод» is not saved with the transfer', () => {
    openForm();
    choose(field('Категория'), 'Продукты');
    fireEvent.click(screen.getByRole('radio', { name: 'Перевод' }));
    type(field('Что'), 'На карту');
    type(field('План'), '10');
    choose(field('На счёт'), TR.cash);
    fireEvent.click(button('Сохранить'));
    expect(current().journal.at(-1)).not.toHaveProperty('category');
  });

  it('editing a transfer shows its accounts; switching it to an expense drops «На счёт»', () => {
    const j = row(current().journal, 'j-2');
    openForm({ initial: j });
    expect(screen.getByRole('radio', { name: 'Перевод' }).getAttribute('aria-checked')).toBe('true');
    expect([field('Со счёта').value, field('На счёт').value]).toEqual([TR.box, TR.card]);
    fireEvent.click(screen.getByRole('radio', { name: 'Расход' }));
    fireEvent.click(button('Сохранить'));
    expect(row(current().journal, 'j-2')).not.toHaveProperty('toAccount');
    expect(row(current().journal, 'j-2').kind).toBe('expense');
  });

  it('«Доход» on a savings account: the hint «Похоже на перевод…» under «Счёт»', () => {
    openForm();
    fireEvent.click(screen.getByRole('radio', { name: 'Доход' }));
    expect(screen.queryByText(LOOKS_LIKE)).toBeNull();
    choose(field('Счёт'), TR.box);
    expect(screen.getByText(LOOKS_LIKE)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Расход' }));
    expect(screen.queryByText(LOOKS_LIKE)).toBeNull();
  });
});

// ── the recurring payment form ──────────────────────────────────────────────────────────────────────────────────
describe('RecurringForm — «Перевод»', () => {
  const openForm = (props: { initial?: Recurring } = {}) => {
    host();
    act(() => openSheet('recurring', props));
  };

  it('a regular transfer into savings: «Со счёта», «На счёт», saved with its marks', () => {
    openForm();
    fireEvent.click(screen.getByRole('radio', { name: 'Перевод' }));
    expect(screen.queryByLabelText('Категория')).toBeNull();
    type(field('Что'), 'Подушка');
    type(field('Сумма'), '100');
    type(field('День'), '2');
    fireEvent.click(button('Сохранить'));
    expect(screen.getByText('Выберите счёт')).toBeTruthy();
    choose(field('На счёт'), TR.deposit);
    fireEvent.click(button('Сохранить'));
    expect(current().recurring.at(-1)).toEqual({
      id: expect.any(String), what: 'Подушка', kind: 'transfer', amount: 100, day: 2, account: TR.card, toAccount: TR.deposit, marks: {},
    });
  });

  it('editing a recurring transfer keeps «На счёт»; «Доход» on savings shows the hint', () => {
    openForm({ initial: row(current().recurring, 'r-kopilka') });
    expect([field('Со счёта').value, field('На счёт').value]).toEqual([TR.card, TR.box]);
    fireEvent.click(screen.getByRole('radio', { name: 'Доход' }));
    choose(field('Счёт'), TR.deposit);
    expect(screen.getByText(LOOKS_LIKE)).toBeTruthy();
  });
});

describe('OperationForm — «Доход» on a savings account', () => {
  it('shows the hint «Похоже на перевод…» under «Счёт»', () => {
    host();
    act(() => openSheet('operation', {}));
    fireEvent.click(screen.getByRole('radio', { name: 'Доход' }));
    choose(field('Счёт'), TR.box);
    expect(screen.getByText(LOOKS_LIKE)).toBeTruthy();
  });
});

// ── «Лента» ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe('«Лента» — transfers and the automatic card repayment', () => {
  function sectionOf(day: string): HTMLElement {
    const h = screen.getByRole('heading', { name: day, level: 2 });
    return h.closest('section') as HTMLElement;
  }

  it('a planned transfer shows «Со счёта → На счёт»; a transfer with a check carries its badge', () => {
    feedMonth.value = '2026-11';
    host(<Feed />);
    const otpusk = screen.getByRole('button', { name: /^Из копилки на отпуск/ });
    expect(plain(otpusk.textContent)).toContain('Копилка → Карта');
    expect(plain(screen.getByRole('button', { name: /^Перевод без счёта/ }).textContent)).toContain('нет «На счёт»');
    expect(plain(screen.getByRole('button', { name: /^Сам себе/ }).textContent)).toContain('тот же счёт');
  });

  it('the automatic card repayment on the debit day, for reference: «списано», not a button', () => {
    feedMonth.value = '2026-11';
    host(<Feed />);
    const day = sectionOf('10 ноября');
    const repayment = within(day).getByText('Погашение кредитки: Кредитка ← Карта');
    const rowEl = repayment.closest('.row') as HTMLElement;
    expect(rowEl.closest('button')).toBeNull();
    expect(plain(rowEl.textContent)).toContain(money(105));
    expect(plain(rowEl.textContent)).toContain('списано');
    expect(plain(rowEl.textContent)).toContain('Справочно, уже учтено');
  });

  it('a repayment still to come says «ожидается»; the filters other than «Все» leave it out', () => {
    feedMonth.value = '2027-01';
    host(<Feed />);
    const rowEl = screen.getByText('Погашение кредитки: Кредитка ← Карта').closest('.row') as HTMLElement;
    expect(plain(rowEl.textContent)).toContain(money(20));
    expect(plain(rowEl.textContent)).toContain('ожидается');
    fireEvent.click(screen.getByRole('radio', { name: 'Траты' }));
    expect(screen.queryByText('Погашение кредитки: Кредитка ← Карта')).toBeNull();
  });

  it('the check «transfers» shows only the rows with a transfer check', () => {
    feedMonth.value = '2026-11';
    feedCheck.value = 'transfers';
    host(<Feed />);
    const titles = Array.from(document.querySelectorAll('.feed-title')).map((t) => t.textContent);
    // «Проценты» is an income to «Копилка»: «похоже на перевод»
    expect(titles).toEqual(['Перевод без счёта', 'Перевод куда-то', 'Сам себе', 'Проценты']);
    expect(screen.queryByText('Погашение кредитки: Кредитка ← Карта')).toBeNull();
  });
});

// ── «Сегодня» ───────────────────────────────────────────────────────────────────────────────────────────────────
describe('«Сегодня» — upcoming transfers are marked done in one tap', () => {
  it('a planned transfer: ✓ marks it paid with «Переведено»; one without «На счёт» opens its card', () => {
    setToday(2026, 11, 15);
    data.value = transfersScenario();
    host(<Today />);
    const list = screen.getByRole('heading', { name: 'Ближайшие 7 дней' }).closest('section') as HTMLElement;
    expect(within(list).queryByText(/просрочено/)).toBeNull(); // «Перевод куда-то» 12.11 is not overdue
    fireEvent.click(within(list).getByRole('button', { name: 'Отметить перевод: Из копилки на отпуск' }));
    expect(row(current().journal, 'j-2').status).toBe('paid');
    expect(toastText()).toBe('Переведено');
    fireEvent.click(within(list).getByRole('button', { name: 'Отметить перевод: Перевод куда-то' }));
    expect(openSheetKind()).toBe('item');
    expect(row(current().recurring, 'r-kuda').marks['2026-11']).toBeUndefined();
  });

  it('«Проверьте записи» counts the records with a transfer check once, not every month a recurring one shows', () => {
    const rows = checkRows(transfersScenario());
    // «Перевод куда-то» (recurring, every month) and «Перевод без счёта»: no «На счёт»; «Сам себе»: the same account;
    // «Проценты» (recurring, every month), «Перевод с карты», «Кэшбэк на копилку»: income to savings
    expect(rows.find((r) => r.check === 'transfers')).toEqual({ check: 'transfers', title: 'Проверьте переводы', count: 6 });
    const w = warnings(transfersScenario());
    expect(w.transfersWithoutTarget + w.transfersToSameAccount + w.incomeToSavings).toBe(6);
  });
});

// ── the item card ───────────────────────────────────────────────────────────────────────────────────────────────
describe('item card — a planned transfer', () => {
  it('shows «Со счёта» and «На счёт», and «Переведено» pays it', () => {
    setToday(2026, 11, 15);
    data.value = transfersScenario();
    host();
    act(() => openSheet('item', { item: { source: 'journal', id: 'j-2' } }));
    const card = screen.getByRole('dialog', { name: 'Плановая запись' });
    expect(plain(card.textContent)).toContain('Со счёта');
    expect(plain(card.textContent)).toContain('На счёт');
    fireEvent.click(within(card).getByRole('button', { name: 'Переведено' }));
    expect(row(current().journal, 'j-2').status).toBe('paid');
  });

  it('a transfer with a check says what to fix', () => {
    host();
    act(() => openSheet('item', { item: { source: 'journal', id: 'j-7' } }));
    expect(screen.getByText(ROW_CHECK_LABEL.noTarget)).toBeTruthy();
  });
});

// ── «Отчёты» → «Месяц» ──────────────────────────────────────────────────────────────────────────────────────────
describe('«Отчёты» → «Месяц» — transfers into savings, free after savings, the card repayment', () => {
  function rowNamed(title: string): HTMLElement {
    const el = screen.getByText(title, { selector: '.row-title' }).closest('.row');
    if (!(el instanceof HTMLElement)) throw new Error(`no row «${title}»`);
    return el;
  }

  it('«Переводы в накопления» is the last row of the categories, outside «Расход»; then the two lines below', () => {
    setToday(2026, 11, 20);
    data.value = transfersScenario();
    host(<Reports />);
    const cats = screen.getByRole('heading', { name: 'Расходы по категориям', level: 2 }).closest('.section') as HTMLElement;
    const titles = Array.from(cats.querySelectorAll('.row-title')).map((t) => t.textContent);
    expect(titles.at(-1)).toBe('Переводы в накопления');
    const tr = rowNamed('Переводы в накопления');
    expect(plain(tr.textContent)).toContain(money(200));
    expect(plain(tr.textContent)).toContain(`План ${money(150)}`);
    expect(plain(screen.getByText('Расход', { selector: '.stat-label' }).closest('.stat-card')?.textContent)).toContain(money(1065));
    const free = rowNamed('Свободно после накоплений');
    expect(plain(free.textContent)).toContain(money(1750));
    expect(plain(free.textContent)).toContain(`План ${money(1840)}`);
    const card = rowNamed('Погашение кредитки (10-го)');
    expect(plain(card.textContent)).toContain(money(105));
    expect(plain(card.textContent)).toContain('Справочно, уже учтено · списано');
    expect(plain(card.closest('section')?.textContent)).toContain(
      'Свободно после накоплений — доходы минус расходы и переводы в накопления. Погашение кредитки не входит в расходы: покупки по кредитке уже там.',
    );
  });

  it('a card repayment still to come says «ожидается»', () => {
    setToday(2026, 11, 5);
    data.value = transfersScenario();
    host(<Reports />);
    expect(plain(screen.getByText('Погашение кредитки (10-го)').closest('.row')?.textContent)).toContain('Справочно, уже учтено · ожидается');
  });

  it('a month without transfers has neither line; without an auto-paid card, no repayment line', () => {
    setToday(2026, 11, 20);
    const d = transfersScenario();
    d.journal = d.journal.filter((r) => r.kind !== 'transfer');
    d.recurring = d.recurring.filter((r) => r.kind !== 'transfer');
    d.operations = d.operations.filter((o) => o.kind !== 'transfer');
    d.credit.auto = false;
    data.value = d;
    host(<Reports />);
    expect(screen.queryByText('Переводы в накопления')).toBeNull();
    expect(screen.queryByText('Свободно после накоплений')).toBeNull();
    expect(screen.queryByText('Погашение кредитки (10-го)')).toBeNull();
  });
});

// ── «Постоянные платежи» ─────────────────────────────────────────────────────────────────────────────────────────
describe('«Постоянные платежи» — transfers in a section of their own', () => {
  it('lists the regular transfers under «Переводы» with «Со счёта → На счёт»', () => {
    host(<RecurringPage params={{}} />);
    const section = screen.getByRole('heading', { name: 'Переводы', level: 2 }).closest('section') as HTMLElement;
    const titles = Array.from(section.querySelectorAll('.row-title')).map((t) => t.textContent);
    expect(titles).toEqual(['В копилку', 'Из вклада', 'Копилка → вклад', 'На кредитку', 'Перевод куда-то']);
    expect(plain(within(section).getByText('В копилку').closest('.row')?.textContent)).toContain('Карта → Копилка');
    const expenses = screen.getByRole('heading', { name: 'Расходы', level: 2 }).closest('section') as HTMLElement;
    expect(within(expenses).queryByText('В копилку')).toBeNull();
  });
});

// ── «Счета» warnings ────────────────────────────────────────────────────────────────────────────────────────────
describe('«Счета» — warnings about transfers', () => {
  it('counts transfers without «На счёт» on every sheet, to the same account and incomes to savings', () => {
    host(<Accounts />);
    const text = plain(document.body.textContent);
    expect(text).toContain('Переводов без счёта зачисления: 2.');
    expect(text).toContain('Переводов на тот же счёт: 1.');
    expect(text).toContain(`Доходов на сберегательный счёт: 3. ${LOOKS_LIKE}.`);
  });

  it('the banners open «Лента» filtered to the rows with a transfer check', () => {
    host(<Accounts />);
    const banner = screen.getByText(/Переводов на тот же счёт/).closest('.banner') as HTMLElement;
    fireEvent.click(within(banner).getByRole('button', { name: 'Открыть ленту' }));
    expect(feedCheck.value).toBe('transfers');
  });
});

// ── «Отчёты» → «Прогноз» ────────────────────────────────────────────────────────────────────────────────────────
describe('«Отчёты» → «Прогноз» — planned and recurring transfers in «Переводы»', () => {
  it('the month cards and the weeks count them (October −900, November −50, December −500)', () => {
    host(<Reports />);
    fireEvent.click(screen.getByRole('radio', { name: 'Прогноз' }));
    const transfersOf = (month: string): string => {
      const card = screen.getByRole('heading', { name: month, level: 2 }).closest('section') as HTMLElement;
      const r = within(card).getByText('Переводы в сбережения / из сбережений').closest('.row') as HTMLElement;
      return plain(r.textContent);
    };
    expect(transfersOf('Октябрь 2026')).toContain(money(-900));
    expect(transfersOf('Ноябрь 2026')).toContain(money(-50));
    expect(transfersOf('Декабрь 2026')).toContain(money(-500));
    const weeks = screen.getByRole('region', { name: 'По неделям' });
    expect(within(weeks).getByRole('columnheader', { name: 'Переводы' })).toBeTruthy();
  });
});
