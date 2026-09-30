// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { ACC, row, scenario } from '../../engine/scenario';
import type { Recurring } from '../../../src/engine';
import { loadData } from '../../../src/store/db';
import { actions } from '../../../src/ui/actions';
import { formatMoney } from '../../../src/ui/format';
import { RecurringPage, everyLabel } from '../../../src/ui/pages/RecurringPage';
import { toggleMark } from '../../../src/ui/sheets/RecurringForm';
import { data } from '../../../src/ui/state';
import { choose, dialog, inputIn, renderScreen, section, type, useScreenTestEnv } from './setup';

useScreenTestEnv();

const m = (n: number) => formatMoney(n);

function openRecurring(what: string): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${what}`) }));
  return dialog('Постоянный платёж');
}

function save(d: HTMLElement): void {
  fireEvent.click(within(d).getByRole('button', { name: 'Сохранить' }));
}

// monthlyAverage is an engine rule now: tests/engine/plans.test.ts
describe('everyLabel', () => {
  it('names the rhythm', () => {
    expect(everyLabel(undefined)).toBe('каждый месяц');
    expect(everyLabel(1)).toBe('каждый месяц');
    expect(everyLabel(3)).toBe('раз в 3 мес.');
    expect(everyLabel(12)).toBe('раз в 12 мес.');
  });
});

describe('toggleMark', () => {
  it('cycles an empty month to ✓ and any mark back to empty, without touching the given marks', () => {
    const marks = { '2026-10': '✓' as const, '2026-11': 950 };
    expect(toggleMark(marks, '2026-12')).toEqual({ '2026-10': '✓', '2026-11': 950, '2026-12': '✓' });
    expect(toggleMark(marks, '2026-10')).toEqual({ '2026-11': 950 });
    expect(toggleMark(marks, '2026-11')).toEqual({ '2026-10': '✓' });
    expect(marks).toEqual({ '2026-10': '✓', '2026-11': 950 });
  });
});

describe('RecurringPage', () => {
  it('lists expenses and incomes apart: rhythm, day, period, account and amount', () => {
    data.value = scenario();
    renderScreen(<RecurringPage params={{}} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Постоянные платежи' })).toBeTruthy();

    const expenses = section('Расходы');
    const rows = within(expenses).getAllByRole('button');
    expect(rows.map((r) => r.querySelector('.row-title')?.textContent)).toEqual(['Аренда', 'Подписка', 'Страховка']);
    expect(within(expenses).getByText('каждый месяц, 5-го · с 01.10.2026 · Карта')).toBeTruthy();
    expect(within(expenses).getByText('каждый месяц, 10-го · с 01.11.2026 · Кредитка')).toBeTruthy();
    expect(within(expenses).getByText('раз в 3 мес., 15-го · с 01.11.2026 · Карта')).toBeTruthy();
    expect(rows[0]!.textContent).toContain(m(900));
    expect(rows[0]!.textContent).toContain('с\u00a001.10.2026'); // «с» never ends a line
    // the «·» stays with the word after it, so a line never ends with a dangling dot
    expect(rows[0]!.textContent).toContain('каждый месяц, 5-го ·\u00a0с\u00a001.10.2026 ·\u00a0Карта');

    const incomes = section('Доходы');
    expect(within(incomes).getByText('ЗП бонус')).toBeTruthy();
    expect(within(incomes).getByText('каждый месяц, 20-го · Карта')).toBeTruthy();
  });

  it('shows the monthly average of expenses and of incomes', () => {
    data.value = scenario();
    renderScreen(<RecurringPage params={{}} />);
    const exp = screen.getByText('Расходы в месяц').closest('.stat-card')!;
    const inc = screen.getByText('Доходы в месяц').closest('.stat-card')!;
    expect(exp.textContent).toContain(m(920));
    expect(inc.textContent).toContain(m(200));
    expect(exp.textContent).toContain('в среднем');
  });

  it('says when a payment has no day or ended, and names a deleted account', () => {
    const d = scenario();
    d.recurring = [
      { id: 'r-x', what: 'Старая', kind: 'expense', amount: 5, to: '2026-01-31', account: 'gone', marks: {} },
    ];
    data.value = d;
    renderScreen(<RecurringPage params={{}} />);
    expect(screen.getByText('каждый месяц, день не указан · по 31.01.2026 · (удалённый счёт)')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: 'Доходы' })).toBeNull();
  });

  it('with nothing yet: an empty state that opens the form', () => {
    const d = scenario();
    d.recurring = [];
    data.value = d;
    renderScreen(<RecurringPage params={{}} />);
    expect(screen.getByText('Постоянных платежей пока нет')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить платёж' }));
    expect(dialog('Новый постоянный платёж')).toBeTruthy();
  });
});

describe('RecurringForm — new payment', () => {
  it('creates an expense with every field and the first debit account by default', async () => {
    data.value = scenario();
    renderScreen(<RecurringPage params={{}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Новый постоянный платёж' }));
    const d = dialog('Новый постоянный платёж');
    expect((inputIn(d, 'Счёт') as unknown as HTMLSelectElement).value).toBe(ACC.card);
    type(inputIn(d, 'Что'), 'Интернет');
    choose(inputIn(d, 'Категория'), 'Подписки');
    type(inputIn(d, 'Сумма'), '25,5');
    type(inputIn(d, 'День'), '12');
    choose(inputIn(d, 'Как часто'), '3');
    type(inputIn(d, 'Действует с'), '2026-12-01');
    save(d);
    await actions.flush();

    const added = data.value!.recurring.find((r) => r.what === 'Интернет');
    expect(added).toEqual({
      id: expect.any(String), what: 'Интернет', kind: 'expense', category: 'Подписки', amount: 25.5, day: 12, every: 3,
      from: '2026-12-01', account: ACC.card, marks: {},
    });
    expect(data.value!.recurring).toHaveLength(5);
    expect(screen.getByText('Сохранено')).toBeTruthy();
    expect(await loadData()).toEqual(data.value);
  });

  it('an income takes income categories; switching the kind drops a category of the other kind', async () => {
    data.value = scenario();
    renderScreen(<RecurringPage params={{}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Новый постоянный платёж' }));
    const d = dialog('Новый постоянный платёж');
    choose(inputIn(d, 'Категория'), 'Жильё');
    fireEvent.click(within(d).getByRole('radio', { name: 'Доход' }));
    const category = inputIn(d, 'Категория') as unknown as HTMLSelectElement;
    expect(Array.from(category.options).map((o) => o.value)).toEqual(['', 'Зарплата', 'Премия']);
    expect(category.value).toBe('');
    choose(category, 'Зарплата');
    type(inputIn(d, 'Что'), 'Аванс');
    type(inputIn(d, 'Сумма'), '500');
    type(inputIn(d, 'День'), '25');
    save(d);
    await actions.flush();
    expect(data.value!.recurring.at(-1)).toMatchObject({ what: 'Аванс', kind: 'income', category: 'Зарплата', day: 25, amount: 500 });
    expect(data.value!.recurring.at(-1)).not.toHaveProperty('every');
  });

  it('switching the kind drops a category only when it belongs to the old kind’s list', async () => {
    const d0 = scenario();
    d0.recurring[3] = { ...d0.recurring[3]!, category: 'Старая категория' }; // in neither list (from an import)
    d0.categories.income = [...d0.categories.income, { name: 'Подписки' }]; // in both lists
    data.value = d0;
    renderScreen(<RecurringPage params={{}} />);
    const d = openRecurring('Страховка');
    const category = inputIn(d, 'Категория') as unknown as HTMLSelectElement;
    const kind = (name: string) => fireEvent.click(within(d).getByRole('radio', { name }));

    // a category in neither list is kept, both ways
    kind('Доход');
    expect(category.value).toBe('Старая категория');
    kind('Расход');
    expect(category.value).toBe('Старая категория');
    // a category of the old kind's list, missing from the new one, is dropped
    choose(category, 'Жильё');
    kind('Доход');
    expect(category.value).toBe('');
    choose(category, 'Зарплата');
    kind('Расход');
    expect(category.value).toBe('');
    // a category that both lists have stays
    choose(category, 'Подписки');
    kind('Доход');
    expect(category.value).toBe('Подписки');

    save(d);
    await actions.flush();
    expect(row(data.value!.recurring, 'r-strahovka')).toMatchObject({ kind: 'income', category: 'Подписки' });
  });

  it('refuses to save without a name, a day and an amount, and says so next to each field', () => {
    data.value = scenario();
    const before = data.value;
    renderScreen(<RecurringPage params={{}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Новый постоянный платёж' }));
    const d = dialog('Новый постоянный платёж');
    save(d);
    expect(within(d).getByText('Введите название')).toBeTruthy();
    expect(within(d).getByText('Укажите день')).toBeTruthy();
    expect(within(d).getByText('Введите сумму')).toBeTruthy();
    expect(data.value).toBe(before);
    expect(dialog('Новый постоянный платёж')).toBeTruthy();
  });

  it('an end before the start is an error', () => {
    data.value = scenario();
    const before = data.value;
    renderScreen(<RecurringPage params={{}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Новый постоянный платёж' }));
    const d = dialog('Новый постоянный платёж');
    type(inputIn(d, 'Что'), 'Спорт');
    type(inputIn(d, 'Сумма'), '40');
    type(inputIn(d, 'День'), '3');
    type(inputIn(d, 'Действует с'), '2026-12-01');
    type(inputIn(d, 'Действует по'), '2026-11-30');
    save(d);
    expect(within(d).getByText('Не раньше даты начала')).toBeTruthy();
    expect(data.value).toBe(before);
  });

  it('a day outside 1..31 or a mistyped amount disables saving and keeps the stored value', async () => {
    data.value = scenario();
    renderScreen(<RecurringPage params={{}} />);
    const d = openRecurring('Аренда');
    const saveButton = within(d).getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement;
    type(inputIn(d, 'День'), '32');
    expect(within(d).getByText('От 1 до 31')).toBeTruthy();
    expect(saveButton.disabled).toBe(true);
    type(inputIn(d, 'День'), '5');
    type(inputIn(d, 'Сумма'), '9о0');
    expect(saveButton.disabled).toBe(true);
    type(inputIn(d, 'Сумма'), '905');
    expect(saveButton.disabled).toBe(false);
    save(d);
    await actions.flush();
    expect(row(data.value!.recurring, 'r-arenda')).toMatchObject({ amount: 905, day: 5 });
  });
});

describe('RecurringForm — editing', () => {
  it('opens with the row’s values and saves a change without losing the other fields or old marks', async () => {
    const d0 = scenario();
    d0.recurring[0] = { ...d0.recurring[0]!, marks: { ...d0.recurring[0]!.marks, '2025-05': '✓' } };
    data.value = d0;
    renderScreen(<RecurringPage params={{}} />);
    const d = openRecurring('Аренда');
    expect(inputIn(d, 'Что').value).toBe('Аренда');
    expect(inputIn(d, 'Сумма').value).toBe('900');
    expect(inputIn(d, 'День').value).toBe('5');
    expect(inputIn(d, 'Действует с').value).toBe('2026-10-01');
    type(inputIn(d, 'Сумма'), '950');
    save(d);
    await actions.flush();
    expect(row(data.value!.recurring, 'r-arenda')).toEqual({
      id: 'r-arenda', what: 'Аренда', kind: 'expense', category: 'Жильё', day: 5, amount: 950, from: '2026-10-01',
      account: ACC.card, marks: { '2025-05': '✓', '2026-10': '✓', '2026-11': 950 },
    });
    expect(d0.recurring[0]!.amount).toBe(900); // the old data is untouched (undo relies on it)
  });

  it('clearing an optional field removes it; «каждый месяц» stores no rhythm', async () => {
    data.value = scenario();
    renderScreen(<RecurringPage params={{}} />);
    const d = openRecurring('Страховка');
    expect((inputIn(d, 'Как часто') as unknown as HTMLSelectElement).value).toBe('3');
    choose(inputIn(d, 'Как часто'), '1');
    type(inputIn(d, 'Действует с'), '');
    choose(inputIn(d, 'Категория'), '');
    save(d);
    await actions.flush();
    const rec = row(data.value!.recurring, 'r-strahovka');
    expect(rec).not.toHaveProperty('every');
    expect(rec).not.toHaveProperty('from');
    expect(rec).not.toHaveProperty('category');
  });

  it('keeps a rhythm or a category that is not in the lists', () => {
    const d0 = scenario();
    d0.recurring[3] = { ...d0.recurring[3]!, every: 5, category: 'Старая категория' };
    data.value = d0;
    renderScreen(<RecurringPage params={{}} />);
    const d = openRecurring('Страховка');
    expect((inputIn(d, 'Как часто') as unknown as HTMLSelectElement).value).toBe('5');
    expect((inputIn(d, 'Категория') as unknown as HTMLSelectElement).value).toBe('Старая категория');
  });

  it('deletes after a confirmation, with «Отменить»', async () => {
    data.value = scenario();
    renderScreen(<RecurringPage params={{}} />);
    const d = openRecurring('Аренда');
    fireEvent.click(within(d).getByRole('button', { name: 'Удалить платёж' }));
    const ask = screen.getByRole('alertdialog', { name: 'Удалить постоянный платёж?' });
    fireEvent.click(within(ask).getByRole('button', { name: 'Удалить' }));
    await actions.flush();
    expect(data.value!.recurring.map((r) => r.id)).toEqual(['r-podpiska', 'r-bonus', 'r-strahovka']);
    expect(screen.getByText('Платёж удалён')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    await actions.flush();
    expect(data.value!.recurring.map((r) => r.id)).toEqual(['r-arenda', 'r-podpiska', 'r-bonus', 'r-strahovka']);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a new payment has no «Удалить»', () => {
    data.value = scenario();
    renderScreen(<RecurringPage params={{}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Новый постоянный платёж' }));
    expect(within(dialog('Новый постоянный платёж')).queryByRole('button', { name: 'Удалить платёж' })).toBeNull();
  });
});

describe('RecurringForm — month marks', () => {
  const marks = (): Recurring['marks'] => row(data.value!.recurring, 'r-arenda').marks;

  it('shows the 12 accounting months with their marks; months without a payment say so', () => {
    data.value = scenario();
    renderScreen(<RecurringPage params={{}} />);
    const d = openRecurring('Страховка');
    const grid = within(d).getByRole('group', { name: 'Отметки по месяцам' });
    const toggles = within(grid).getAllByRole('button', { name: /^[А-Я][а-я]+ \d{4}:/ });
    expect(toggles.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Октябрь 2026: без списания, не отмечено',
      'Ноябрь 2026: не отмечено',
      'Декабрь 2026: без списания, не отмечено',
      'Январь 2027: без списания, не отмечено',
      'Февраль 2027: не отмечено',
      'Март 2027: без списания, не отмечено',
      'Апрель 2027: без списания, не отмечено',
      'Май 2027: не отмечено',
      'Июнь 2027: без списания, не отмечено',
      'Июль 2027: без списания, не отмечено',
      'Август 2027: не отмечено',
      'Сентябрь 2027: без списания, не отмечено',
    ]);
    // the rhythm is read from the form as it is being edited
    choose(inputIn(d, 'Как часто'), '1');
    expect(within(grid).getByRole('button', { name: 'Декабрь 2026: не отмечено' })).toBeTruthy();
    expect(within(grid).getByRole('button', { name: 'Октябрь 2026: без списания, не отмечено' })).toBeTruthy();
  });

  it('a tap marks a month ✓, a tap on a mark clears it', async () => {
    data.value = scenario();
    renderScreen(<RecurringPage params={{}} />);
    const d = openRecurring('Аренда');
    fireEvent.click(within(d).getByRole('button', { name: `Ноябрь 2026: ${m(950)}` }));
    fireEvent.click(within(d).getByRole('button', { name: 'Октябрь 2026: оплачено' }));
    fireEvent.click(within(d).getByRole('button', { name: 'Декабрь 2026: не отмечено' }));
    expect(within(d).getByRole('button', { name: 'Декабрь 2026: оплачено' })).toBeTruthy();
    save(d);
    await actions.flush();
    expect(marks()).toEqual({ '2026-12': '✓' });
  });

  it('«Сумма за …» writes another amount for the month; clearing it removes the mark', async () => {
    data.value = scenario();
    renderScreen(<RecurringPage params={{}} />);
    const d = openRecurring('Аренда');
    fireEvent.click(within(d).getByRole('button', { name: 'Сумма за декабрь 2026' }));
    const paid = inputIn(d, 'Оплачено за декабрь 2026');
    expect(paid.value).toBe('');
    type(paid, '875,4');
    expect(within(d).getByRole('button', { name: `Декабрь 2026: ${m(875.4)}` })).toBeTruthy();
    // a ✓ month starts from the amount
    fireEvent.click(within(d).getByRole('button', { name: 'Сумма за октябрь 2026' }));
    expect(inputIn(d, 'Оплачено за октябрь 2026').value).toBe('900');
    fireEvent.click(within(d).getByRole('button', { name: 'Сумма за ноябрь 2026' }));
    type(inputIn(d, 'Оплачено за ноябрь 2026'), '');
    fireEvent.click(within(d).getByRole('button', { name: 'Готово' }));
    expect(within(d).queryByLabelText(/^Оплачено за/)).toBeNull();
    save(d);
    await actions.flush();
    expect(marks()).toEqual({ '2026-10': '✓', '2026-12': 875.4 });
  });

  it('a mistyped month amount disables saving until it is fixed or the editor is closed', () => {
    data.value = scenario();
    renderScreen(<RecurringPage params={{}} />);
    const d = openRecurring('Аренда');
    const saveButton = within(d).getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement;
    fireEvent.click(within(d).getByRole('button', { name: 'Сумма за ноябрь 2026' }));
    type(inputIn(d, 'Оплачено за ноябрь 2026'), '0,125');
    expect(saveButton.disabled).toBe(true);
    // the stored mark is kept
    expect(within(d).getByRole('button', { name: `Ноябрь 2026: ${m(950)}` })).toBeTruthy();
    fireEvent.click(within(d).getByRole('button', { name: 'Готово' }));
    expect(saveButton.disabled).toBe(false);
  });
});
