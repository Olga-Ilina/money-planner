// @vitest-environment happy-dom
// «Новая операция» (D1): amount, kind, category chips, accounts, date, «Что»; validation, duplicates,
// edit and delete — asserted on the committed data.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import type { Data, JournalRow, Operation } from '../../../src/engine';
import * as db from '../../../src/store/db';
import { actions } from '../../../src/ui/actions';
import { Toast } from '../../../src/ui/kit';
import {
  categoryChoices, defaultAccounts, duplicateText, validateOperation,
} from '../../../src/ui/sheets/OperationForm';
import { SheetHost, openSheet } from '../../../src/ui/sheets/host';
import { data, feedMonth, resetSession, tab } from '../../../src/ui/state';
import { ACC, row, scenario } from '../../engine/scenario';

function open(d: Data = scenario(), props: Parameters<typeof openSheet<'operation'>>[1] = {}): HTMLElement {
  data.value = d;
  render(
    <>
      <SheetHost />
      <Toast />
    </>,
  );
  act(() => openSheet('operation', props));
  return screen.getByRole('dialog');
}

const input = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string): void => {
  fireEvent.input(input(label), { target: { value } });
};
const choose = (label: string, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};
const save = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
};
const newOps = (): Operation[] => data.value!.operations.filter((o) => !scenario().operations.some((s) => s.id === o.id));

beforeEach(() => {
  db.useFactory(new IDBFactory());
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 6, 12, 0)); // 6 October 2026
  resetSession();
});

afterEach(async () => {
  cleanup();
  await actions.flush();
  vi.useRealTimers();
  resetSession();
  db.useFactory(undefined);
});

describe('OperationForm — new operation', () => {
  it('saves an expense: amount, category, last used account, today; toast «Сохранено»', async () => {
    open();
    expect(screen.getByRole('dialog', { name: 'Новая операция' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Расход' }).getAttribute('aria-checked')).toBe('true');
    expect(input('Дата').value).toBe('2026-10-06');
    expect((screen.getByLabelText('Счёт') as HTMLSelectElement).value).toBe(ACC.card); // «Кафе», the last expense
    type('Сумма', '12,5');
    fireEvent.click(screen.getByRole('button', { name: 'Транспорт' }));
    expect(input('Что').placeholder).toBe('Транспорт');
    type('Что', ' Автобус ');
    save();
    await actions.flush();
    const [op] = newOps();
    expect(op).toEqual({
      id: expect.any(String), date: '2026-10-06', kind: 'expense', category: 'Транспорт', what: 'Автобус', amount: 12.5,
      account: ACC.card,
    });
    expect(data.value!.operations.at(-1)).toEqual(op);
    expect(await db.loadData()).toEqual(data.value);
    expect(screen.getByText('Сохранено')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Отменить' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('an empty «Что» stores the category shown as its placeholder', async () => {
    open();
    type('Сумма', '3');
    fireEvent.click(screen.getByRole('button', { name: 'Продукты' }));
    choose('Счёт', ACC.cash);
    type('Дата', '2026-10-04');
    save();
    await actions.flush();
    expect(newOps()).toEqual([
      { id: expect.any(String), date: '2026-10-04', kind: 'expense', category: 'Продукты', what: 'Продукты', amount: 3, account: ACC.cash },
    ]);
  });

  it('saves income with its own categories', async () => {
    open();
    fireEvent.click(screen.getByRole('radio', { name: 'Доход' }));
    const chips = within(screen.getByRole('group', { name: 'Категория' })).getAllByRole('button').map((b) => b.textContent);
    expect(chips).toEqual(['Зарплата', 'Премия']); // «ЗП» (1.10) counts; «Кэшбэк» (21.10) is later than today
    type('Сумма', '1 500');
    fireEvent.click(screen.getByRole('button', { name: 'Зарплата' }));
    save();
    await actions.flush();
    expect(newOps()).toEqual([
      { id: expect.any(String), date: '2026-10-06', kind: 'income', category: 'Зарплата', what: 'Зарплата', amount: 1500, account: ACC.card },
    ]);
  });

  it('switching kind drops a category of the other kind', async () => {
    open();
    type('Сумма', '10');
    fireEvent.click(screen.getByRole('button', { name: 'Продукты' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Доход' }));
    expect(screen.queryByRole('button', { name: 'Продукты' })).toBeNull();
    save();
    await actions.flush();
    expect(newOps()[0]).toMatchObject({ kind: 'income', what: '' });
    expect(newOps()[0]?.category).toBeUndefined();
  });

  it('a transfer hides the categories and needs two different accounts', async () => {
    open();
    fireEvent.click(screen.getByRole('radio', { name: 'Перевод' }));
    expect(screen.queryByRole('group', { name: 'Категория' })).toBeNull();
    // the last transfer went from the card to the credit card
    expect((screen.getByLabelText('Со счёта') as HTMLSelectElement).value).toBe(ACC.card);
    expect((screen.getByLabelText('На счёт') as HTMLSelectElement).value).toBe(ACC.credit);
    expect(input('Что').placeholder).toBe('Перевод');
    type('Сумма', '50');
    choose('На счёт', ACC.card);
    save();
    await actions.flush();
    expect(screen.getByText('Счета должны различаться')).toBeTruthy();
    expect(newOps()).toEqual([]);
    choose('На счёт', ACC.cash);
    save();
    await actions.flush();
    expect(newOps()).toEqual([
      { id: expect.any(String), date: '2026-10-06', kind: 'transfer', what: 'Перевод', amount: 50, account: ACC.card, toAccount: ACC.cash },
    ]);
  });

  it('a required account that is not chosen yet reads «Не выбран» (as in every form)', () => {
    const d = scenario();
    d.operations = d.operations.filter((o) => o.kind !== 'transfer'); // no last transfer to take «На счёт» from
    open(d, { preset: { kind: 'transfer' } });
    const to = screen.getByLabelText('На счёт') as HTMLSelectElement;
    expect(to.value).toBe('');
    expect(to.selectedOptions[0]?.textContent).toBe('Не выбран');
  });

  it('a preset opens a transfer', () => {
    open(scenario(), { preset: { kind: 'transfer' } });
    expect(screen.getByRole('radio', { name: 'Перевод' }).getAttribute('aria-checked')).toBe('true');
  });

  it('asks for an amount above zero and a date, and saves nothing', async () => {
    open();
    save();
    expect(screen.getByText('Введите сумму')).toBeTruthy();
    type('Сумма', '0');
    type('Дата', '');
    save();
    await actions.flush();
    expect(screen.getByText('Сумма должна быть больше нуля')).toBeTruthy();
    expect(screen.getByText('Укажите дату')).toBeTruthy();
    expect(data.value!.operations).toEqual(scenario().operations);
    expect(screen.getByRole('dialog', { name: 'Новая операция' })).toBeTruthy();
  });

  it('a mistyped amount keeps saving disabled', () => {
    open();
    type('Сумма', '0,125'); // more than 2 decimals
    expect((screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(true);
    type('Сумма', '0,12');
    expect((screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('warns about a possible duplicate before saving; «Всё равно сохранить» saves', async () => {
    open();
    type('Сумма', '100'); // the journal row «Кафе» on 6 October is paid 100
    fireEvent.click(screen.getByRole('button', { name: 'Продукты' }));
    save();
    await actions.flush();
    expect(newOps()).toEqual([]);
    expect(screen.getByText(/Похоже на плановую запись «Кафе» за 6 октября/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Всё равно сохранить' }));
    await actions.flush();
    expect(newOps()).toEqual([expect.objectContaining({ amount: 100, date: '2026-10-06', category: 'Продукты' })]);
  });

  it('«Сохранить» again after the warning also saves', async () => {
    open();
    type('Сумма', '101');
    type('Что', 'Аренда'); // named like the recurring payment
    save();
    await actions.flush();
    expect(newOps()).toEqual([]);
    expect(screen.getByText('Похоже на постоянный платёж «Аренда». Возможно, это дубль.')).toBeTruthy();
    save();
    await actions.flush();
    expect(newOps()).toEqual([expect.objectContaining({ what: 'Аренда', amount: 101 })]);
  });

  it('a change after the warning checks again', async () => {
    open();
    type('Сумма', '100');
    fireEvent.click(screen.getByRole('button', { name: 'Продукты' }));
    save();
    expect(screen.getByText(/Похоже на/)).toBeTruthy();
    type('Сумма', '99');
    expect(screen.queryByText(/Похоже на/)).toBeNull();
    save();
    await actions.flush();
    expect(newOps()).toEqual([expect.objectContaining({ amount: 99 })]);
  });
});

describe('OperationForm — saved into another month than «Лента» shows', () => {
  it('from «Лента»: the toast offers «Показать», which switches «Лента» to that month (and «Отменить» stays)', async () => {
    tab.value = 'feed';
    feedMonth.value = '2026-10';
    open();
    type('Сумма', '7');
    type('Дата', '2026-12-03');
    save();
    const show = screen.getByRole('button', { name: 'Показать' });
    expect(screen.getByRole('button', { name: 'Отменить' })).toBeTruthy();
    fireEvent.click(show);
    expect(feedMonth.value).toBe('2026-12');
    expect(tab.value).toBe('feed');
  });

  it('no «Показать» for the month «Лента» shows, outside «Лента», or for a month it cannot show', () => {
    tab.value = 'feed';
    feedMonth.value = '2026-10';
    open();
    type('Сумма', '7');
    save();
    expect(screen.queryByRole('button', { name: 'Показать' })).toBeNull();
    cleanup();
    tab.value = 'today';
    open();
    type('Сумма', '7');
    type('Дата', '2026-12-03');
    save();
    expect(screen.queryByRole('button', { name: 'Показать' })).toBeNull();
    cleanup();
    tab.value = 'feed';
    open();
    type('Сумма', '7');
    type('Дата', '2027-12-03'); // after the accounting year
    save();
    expect(screen.queryByRole('button', { name: 'Показать' })).toBeNull();
  });
});

describe('OperationForm — a date outside the accounting year', () => {
  const NOTE =
    'Дата вне учётного года (Октябрь 2026 — сентябрь 2027): запись учтётся в остатках, но не попадёт в ленту и отчёты. Учётный год меняется в «Ещё → Учёт и прогноз».';
  // «Дата остатков» is 1 October 2026 in the scenario: an operation dated before it counts nowhere
  const NOTE_BEFORE =
    'Дата вне учётного года (Октябрь 2026 — сентябрь 2027): запись не попадёт ни в остатки (раньше даты остатков), ни в ленту и отчёты. Учётный год меняется в «Ещё → Учёт и прогноз».';

  it('warns under the date (describing it) and still saves', async () => {
    open();
    expect(screen.queryByText(NOTE)).toBeNull(); // today (6 October) is inside
    type('Сумма', '7');
    type('Дата', '2027-10-02');
    const note = screen.getByText(NOTE);
    expect(note.closest('.field')).toBe(input('Дата').closest('.field'));
    expect(input('Дата').getAttribute('aria-describedby')).toContain(note.id);
    save();
    await actions.flush();
    expect(newOps()).toEqual([expect.objectContaining({ date: '2027-10-02', amount: 7 })]);
  });

  it('before the year too — and before «Дата остатков» it says the balances will not count it; a date back inside removes it', () => {
    open();
    type('Дата', '2026-09-30');
    expect(screen.getByText(NOTE_BEFORE)).toBeTruthy();
    expect(screen.queryByText(NOTE)).toBeNull();
    type('Дата', '2026-10-01');
    expect(screen.queryByText(NOTE_BEFORE)).toBeNull();
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it('before the year but from «Дата остатков» on: it counts in the balances (by its date)', () => {
    const d = scenario();
    d.settings = { ...d.settings, balancesDate: '2026-09-15' };
    open(d);
    type('Дата', '2026-09-15');
    expect(screen.getByText(NOTE)).toBeTruthy();
    type('Дата', '2026-09-14');
    expect(screen.getByText(NOTE_BEFORE)).toBeTruthy();
  });
});

describe('OperationForm — editing', () => {
  const bilet = (): Operation => row(scenario().operations, 'o-bilet');

  it('opens with the operation and saves it in place', async () => {
    open(scenario(), { initial: bilet() });
    expect(screen.getByRole('dialog', { name: 'Операция' })).toBeTruthy();
    expect(input('Сумма').value).toBe('20');
    expect(screen.getByRole('button', { name: 'Транспорт' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Счёт') as HTMLSelectElement).value).toBe(ACC.cash);
    expect(input('Что').value).toBe('Билет');
    type('Сумма', '22,4');
    save();
    await actions.flush();
    const ops = data.value!.operations;
    expect(ops.map((o) => o.id)).toEqual(scenario().operations.map((o) => o.id));
    expect(row(ops, 'o-bilet')).toEqual({ ...bilet(), amount: 22.4 });
  });

  it('shows a negative stored amount as positive and saves it positive', async () => {
    open(scenario(), { initial: row(scenario().operations, 'o-magazin') });
    expect(input('Сумма').value).toBe('30');
    save();
    await actions.flush();
    expect(row(data.value!.operations, 'o-magazin').amount).toBe(30);
  });

  it('does not warn again about a duplicate the operation already was', async () => {
    open(scenario(), { initial: row(scenario().operations, 'o-kafe') });
    type('Что', 'Кафе у дома');
    save();
    await actions.flush();
    expect(screen.queryByText(/Похоже на/)).toBeNull();
    expect(row(data.value!.operations, 'o-kafe').what).toBe('Кафе у дома');
  });

  it('keeps a category that is no longer in the list', () => {
    open(scenario(), { initial: { ...bilet(), category: 'Старая' } });
    expect(screen.getByRole('button', { name: 'Старая' }).getAttribute('aria-pressed')).toBe('true');
  });

  // an operation whose name is just its category (what an empty «Что» is saved as) is «auto-named»
  const withOp = (op: Operation): Data => {
    const d = scenario();
    d.operations.push(op);
    return d;
  };
  const chips = (): string[] =>
    within(screen.getByRole('group', { name: 'Категория' })).getAllByRole('button').map((b) => b.textContent ?? '');

  it('an auto-named operation starts with an empty «Что» and follows a new category', async () => {
    const auto: Operation = { id: 'o-auto', date: '2026-10-03', kind: 'expense', category: 'Продукты', what: 'Продукты', amount: 77, account: ACC.card };
    open(withOp(auto), { initial: auto });
    expect(input('Что').value).toBe('');
    expect(input('Что').placeholder).toBe('Продукты');
    fireEvent.click(screen.getByRole('button', { name: 'Транспорт' }));
    expect(input('Что').placeholder).toBe('Транспорт');
    save();
    await actions.flush();
    expect(row(data.value!.operations, 'o-auto')).toEqual({ ...auto, category: 'Транспорт', what: 'Транспорт' });
  });

  it('an auto-named operation saved without changes keeps its name', async () => {
    const auto: Operation = { id: 'o-auto', date: '2026-10-03', kind: 'expense', category: 'Продукты', what: 'Продукты', amount: 77, account: ACC.card };
    open(withOp(auto), { initial: auto });
    save();
    await actions.flush();
    expect(row(data.value!.operations, 'o-auto')).toEqual(auto);
  });

  it('an auto-named transfer switched to «Расход» is saved under the category, not «Перевод»', async () => {
    const auto: Operation = { id: 'o-auto', date: '2026-10-03', kind: 'transfer', what: 'Перевод', amount: 77, account: ACC.card, toAccount: ACC.cash };
    open(withOp(auto), { initial: auto });
    expect(input('Что').value).toBe('');
    expect(input('Что').placeholder).toBe('Перевод');
    fireEvent.click(screen.getByRole('radio', { name: 'Расход' }));
    expect(input('Что').placeholder).toBe('Необязательно');
    fireEvent.click(screen.getByRole('button', { name: 'Транспорт' }));
    expect(input('Что').placeholder).toBe('Транспорт');
    save();
    await actions.flush();
    expect(row(data.value!.operations, 'o-auto')).toEqual({
      id: 'o-auto', date: '2026-10-03', kind: 'expense', category: 'Транспорт', what: 'Транспорт', amount: 77, account: ACC.card,
    });
  });

  it('an auto-named expense switched to «Перевод» is saved as «Перевод»', async () => {
    const auto: Operation = { id: 'o-auto', date: '2026-10-03', kind: 'expense', category: 'Продукты', what: 'Продукты', amount: 77, account: ACC.card };
    open(withOp(auto), { initial: auto });
    fireEvent.click(screen.getByRole('radio', { name: 'Перевод' }));
    choose('На счёт', ACC.cash);
    save();
    await actions.flush();
    expect(row(data.value!.operations, 'o-auto')).toMatchObject({ kind: 'transfer', what: 'Перевод', account: ACC.card, toAccount: ACC.cash });
  });

  it('a name the user typed is kept when the category or the kind changes', async () => {
    const named: Operation = { id: 'o-named', date: '2026-10-03', kind: 'expense', category: 'Транспорт', what: 'Автобус', amount: 77, account: ACC.card };
    open(withOp(named), { initial: named });
    expect(input('Что').value).toBe('Автобус');
    fireEvent.click(screen.getByRole('button', { name: 'Продукты' }));
    expect(input('Что').value).toBe('Автобус');
    save();
    await actions.flush();
    expect(row(data.value!.operations, 'o-named')).toEqual({ ...named, category: 'Продукты', what: 'Автобус' });
  });

  it('an expense switched to «Доход» offers only income categories and saves no expense category', async () => {
    open(scenario(), { initial: bilet() }); // «Билет», Транспорт
    fireEvent.click(screen.getByRole('radio', { name: 'Доход' }));
    expect(chips()).toEqual(['Зарплата', 'Премия']);
    expect(screen.queryByRole('button', { name: 'Транспорт' })).toBeNull();
    expect(within(screen.getByRole('group', { name: 'Категория' })).queryAllByRole('button', { pressed: true })).toEqual([]);
    save();
    await actions.flush();
    const saved = row(data.value!.operations, 'o-bilet');
    expect(saved).toEqual({ id: 'o-bilet', date: '2026-10-14', kind: 'income', what: 'Билет', amount: 20, account: ACC.cash });
    expect(saved.category).toBeUndefined();
  });

  it('an income switched to «Расход» offers the expense categories with none selected', async () => {
    open(scenario(), { initial: row(scenario().operations, 'o-keshbek') }); // Премия
    fireEvent.click(screen.getByRole('radio', { name: 'Расход' }));
    expect(chips()).toEqual(expect.arrayContaining(['Жильё', 'Продукты', 'Транспорт', 'Подписки', 'Техника']));
    expect(chips()).not.toContain('Премия');
    expect(within(screen.getByRole('group', { name: 'Категория' })).queryAllByRole('button', { pressed: true })).toEqual([]);
    save();
    await actions.flush();
    expect(row(data.value!.operations, 'o-keshbek').category).toBeUndefined();
  });

  it('a category that is no longer in the list is not offered for the other kind', () => {
    open(scenario(), { initial: { ...bilet(), category: 'Старая' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Доход' }));
    expect(chips()).toEqual(['Зарплата', 'Премия']);
  });

  it('«Удалить» asks, deletes with «Отменить», and undo brings it back', async () => {
    open(scenario(), { initial: bilet() });
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    const ask = screen.getByRole('alertdialog', { name: 'Удалить операцию?' });
    fireEvent.click(within(ask).getByRole('button', { name: 'Удалить' }));
    await actions.flush();
    expect(data.value!.operations.some((o) => o.id === 'o-bilet')).toBe(false);
    expect(screen.getByText('Операция удалена')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    await actions.flush();
    expect(data.value!.operations).toEqual(scenario().operations);
  });

  it('cancelling the delete keeps the operation', async () => {
    open(scenario(), { initial: bilet() });
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Отмена' }));
    await actions.flush();
    expect(data.value!.operations).toEqual(scenario().operations);
  });
});

describe('OperationForm — helpers', () => {
  it('categoryChoices: used in the last 60 days first (most used first), then the rest in list order', () => {
    const d = scenario();
    d.journal = [];
    d.operations = [
      { id: '1', date: '2026-10-01', kind: 'expense', category: 'Транспорт', what: 'a', amount: 1 },
      { id: '2', date: '2026-09-20', kind: 'expense', category: 'Транспорт', what: 'b', amount: 1 },
      { id: '3', date: '2026-08-07', kind: 'expense', category: 'Подписки', what: 'c', amount: 1 }, // day 60
      { id: '4', date: '2026-08-06', kind: 'expense', category: 'Техника', what: 'd', amount: 1 }, // day 61: too old
      { id: '5', date: '2026-08-06', kind: 'expense', category: 'Техника', what: 'e', amount: 1 },
      { id: '6', date: '2026-10-07', kind: 'expense', category: 'Жильё', what: 'f', amount: 1 }, // tomorrow
      { id: '7', date: '2026-10-02', kind: 'income', category: 'Продукты', what: 'g', amount: 1 }, // other kind
      { id: '8', date: '2026-10-06', kind: 'expense', category: 'Подписки', what: 'i', amount: 1 }, // today
    ];
    d.journal = [{ id: 'j', date: '2026-10-03', kind: 'expense', category: 'Подписки', what: 'h', plan: 1, status: 'paid' }];
    // Подписки 3 (two operations and a paid journal row), Транспорт 2; the rest keep the list order
    expect(categoryChoices(d, 'expense', '2026-10-06')).toEqual(['Подписки', 'Транспорт', 'Жильё', 'Продукты', 'Техника']);
    expect(categoryChoices(d, 'expense', '2026-10-06', 'Старая')).toEqual(['Подписки', 'Транспорт', 'Жильё', 'Продукты', 'Техника', 'Старая']);
    expect(categoryChoices(d, 'expense', '2026-10-06', 'Жильё')).toEqual(['Подписки', 'Транспорт', 'Жильё', 'Продукты', 'Техника']);
    expect(categoryChoices(d, 'income', '2026-10-06')).toEqual(['Зарплата', 'Премия']);
    expect(categoryChoices(d, 'transfer', '2026-10-06')).toEqual([]);
  });

  it('categoryChoices: only journal rows with a fact count (not planned, not cancelled), operations always do', () => {
    const d = scenario();
    const j = (id: string, category: string, more: Partial<JournalRow>): JournalRow => ({
      id, date: '2026-10-03', kind: 'expense', category, what: id, plan: 5, ...more,
    });
    d.operations = [{ id: 'o', date: '2026-10-02', kind: 'expense', category: 'Техника', what: 'o', amount: 1 }];
    d.journal = [
      j('a1', 'Транспорт', {}), j('a2', 'Транспорт', {}), j('a3', 'Транспорт', {}), // planned, not done
      j('b1', 'Продукты', { status: 'cancelled' }), j('b2', 'Продукты', { status: 'cancelled' }), // cancelled
      j('c', 'Подписки', { status: 'paid' }), // paid: the plan is the fact
      j('d', 'Жильё', { plan: undefined, fact: 4 }), // a fact was entered
      j('e', 'Жильё', { status: 'postponed' }), // postponed, not done
    ];
    // Техника, Подписки, Жильё used once (list order among equals: Жильё, Подписки, Техника); the rest after
    expect(categoryChoices(d, 'expense', '2026-10-06')).toEqual(['Жильё', 'Подписки', 'Техника', 'Продукты', 'Транспорт']);
  });

  it('defaultAccounts: the account of the last operation of that kind, else the first debit account', () => {
    const d = scenario();
    expect(defaultAccounts(d, 'expense')).toEqual({ account: ACC.card });
    expect(defaultAccounts(d, 'income')).toEqual({ account: ACC.card });
    expect(defaultAccounts(d, 'transfer')).toEqual({ account: ACC.card, toAccount: ACC.credit });
    d.operations.push({ id: 'x', date: '2026-10-01', kind: 'expense', what: 'x', amount: 1, account: 'acc-gone' });
    expect(defaultAccounts(d, 'expense')).toEqual({ account: ACC.card }); // a deleted account is skipped
    d.operations.push({ id: 'y', date: '2026-09-01', kind: 'expense', what: 'y', amount: 1, account: ACC.cash });
    expect(defaultAccounts(d, 'expense')).toEqual({ account: ACC.cash }); // the last entered, whatever its date
    d.operations = [];
    d.accounts = [d.accounts[1]!, d.accounts[2]!, d.accounts[0]!]; // cash, credit, card
    expect(defaultAccounts(d, 'expense')).toEqual({ account: ACC.card });
    expect(defaultAccounts(d, 'transfer')).toEqual({ account: ACC.card });
    d.accounts = [];
    expect(defaultAccounts(d, 'expense')).toEqual({});
  });

  it('validateOperation: amount above zero, a date, two different accounts for a transfer', () => {
    const ok = { kind: 'expense' as const, amount: 5, date: '2026-10-06', account: ACC.card };
    expect(validateOperation(ok)).toEqual({});
    expect(validateOperation({ ...ok, amount: undefined, date: undefined })).toEqual({
      amount: 'Введите сумму', date: 'Укажите дату',
    });
    expect(validateOperation({ ...ok, amount: 0 })).toEqual({ amount: 'Сумма должна быть больше нуля' });
    expect(validateOperation({ ...ok, account: undefined })).toEqual({}); // an expense may have no account
    const t = { ...ok, kind: 'transfer' as const };
    expect(validateOperation({ ...t, account: undefined })).toEqual({ account: 'Выберите счёт', toAccount: 'Выберите счёт' });
    expect(validateOperation({ ...t, toAccount: ACC.card })).toEqual({ toAccount: 'Счета должны различаться' });
    expect(validateOperation({ ...t, toAccount: ACC.cash })).toEqual({});
  });

  it('duplicateText: names what the operation looks like', () => {
    const d = scenario();
    const op = (o: Partial<Operation>): Operation => ({ id: 'n', date: '2026-10-06', kind: 'expense', what: 'Что-то', amount: 1, ...o });
    expect(duplicateText(d, op({}))).toBeNull();
    expect(duplicateText(d, op({ amount: 100 }))).toBe('Похоже на плановую запись «Кафе» за 6 октября. Возможно, это дубль.');
    expect(duplicateText(d, op({ what: 'аренда' }))).toBe('Похоже на постоянный платёж «Аренда». Возможно, это дубль.');
    expect(duplicateText(d, op({ what: 'Ноутбук', date: '2026-12-10' }))).toBe('Похоже на покупку «Ноутбук». Возможно, это дубль.');
    expect(duplicateText(d, op({ kind: 'transfer', amount: 100 }))).toBeNull();
  });
});
