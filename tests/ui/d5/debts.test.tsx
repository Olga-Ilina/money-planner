// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { row, scenario } from '../../engine/scenario';
import { addDays } from '../../../src/engine';
import type { Data, Debt } from '../../../src/engine';
import { loadData } from '../../../src/store/db';
import { actions } from '../../../src/ui/actions';
import { formatDate, formatMoney, todayISO } from '../../../src/ui/format';
import { DebtsPage } from '../../../src/ui/pages/DebtsPage';
import { data } from '../../../src/ui/state';
import { accessibleName } from '../accessibleName';
import { dialog, inputIn, renderScreen, type, useScreenTestEnv } from './setup';

useScreenTestEnv();

const m = (n: number) => formatMoney(n);
const plain = (s: string) => s.replace(/\u00a0/g, ' ');

function debts(): Debt[] {
  return [
    { id: 'd-car', name: 'Кредит на машину', whom: 'Банк', total: 12000, paid: 3500.5, rate: 0.049, payment: 350, nextDate: '2027-01-31' },
    { id: 'd-masha', name: 'Долг Маше', whom: 'Маша', total: 200, paid: 200, payment: 50 },
    { id: 'd-phone', name: 'Рассрочка', total: 600, payment: 100, nextDate: addDays(todayISO(), 1) },
  ];
}

function withDebts(): Data {
  const d = scenario();
  d.debts = debts();
  return d;
}

function rowButton(name: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`^${name}`) });
}

function save(d: HTMLElement): void {
  fireEvent.click(within(d).getByRole('button', { name: 'Сохранить' }));
}

// debtLeft / debtStatus / isDebtOpen are engine rules now: tests/engine/plans.test.ts

describe('DebtsPage', () => {
  it('lists each debt: what is left, paid of the total, the rate and the next payment', () => {
    data.value = withDebts();
    renderScreen(<DebtsPage params={{}} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Долги' })).toBeTruthy();

    const car = rowButton('Кредит на машину');
    expect(car.textContent).toContain('Банк ·\u00a0ставка 4,9\u00a0%');
    expect(car.textContent).toContain(m(8499.5));
    expect(car.textContent).toContain(`Выплачено ${m(3500.5)} из ${m(12000)} ·\u00a0В работе`);
    expect(car.textContent).toContain(`Платёж ${m(350)} ·\u00a0следующий\u00a031.01.2027`);
    // the bar is decorative (aria-hidden): the row's text already carries the numbers
    const bar = within(car).getByRole('progressbar', { name: 'Выплачено из суммы долга', hidden: true });
    expect(bar.getAttribute('aria-valuenow')).toBe('3500.5');
    expect(bar.getAttribute('aria-valuemax')).toBe('12000');

    expect(rowButton('Долг Маше').textContent).toContain('Закрыт');
    expect(rowButton('Рассрочка').textContent).toContain('Не начат');
  });

  it('a debt reads as text: no raw bar value, the two lines apart, no empty «, ,» part', () => {
    data.value = withDebts();
    renderScreen(<DebtsPage params={{}} />);
    const car = rowButton('Кредит на машину');
    expect(car.querySelector('[aria-hidden="true"] [role="progressbar"]')).not.toBeNull();
    expect(accessibleName(car)).toBe(
      `Кредит на машину, Банк · ставка 4,9 %, Выплачено ${plain(m(3500.5))} из ${plain(m(12000))} · В работе, ` +
        `Платёж ${plain(m(350))} · следующий 31.01.2027, ${plain(m(8499.5))}`,
    );
    // a debt with one line only has no stray separator after it; a closed one has no payment line at all
    expect(accessibleName(rowButton('Рассрочка'))).toBe(
      `Рассрочка, Выплачено ${plain(m(0))} из ${plain(m(600))} · Не начат, Платёж ${plain(m(100))} · следующий ${plain(
        formatDate(addDays(todayISO(), 1)),
      )}, ${plain(m(600))}`,
    );
    expect(accessibleName(rowButton('Долг Маше'))).toBe(
      `Долг Маше, Маша, Выплачено ${plain(m(200))} из ${plain(m(200))} · Закрыт, ${plain(m(0))}`,
    );
    for (const b of screen.getAllByRole('button', { name: /Выплачено/ })) expect(accessibleName(b)).not.toMatch(/,\s*,|,$/);
  });

  it('a debt without an amount shows no amount left, no 0,00 € and no bar', () => {
    const d = scenario();
    d.debts = [{ id: 'd-x', name: 'Долг без суммы', paid: 40 }];
    data.value = d;
    renderScreen(<DebtsPage params={{}} />);
    const x = rowButton('Долг без суммы');
    expect(x.querySelector('.row-value')).toBeNull();
    expect(within(x).queryByRole('progressbar', { hidden: true })).toBeNull();
    expect(x.textContent).toContain(`Выплачено ${m(40)}`);
    expect(x.textContent).not.toContain('из');
  });

  it('a payment due within 3 days of an open debt is highlighted', () => {
    data.value = withDebts();
    renderScreen(<DebtsPage params={{}} />);
    const soon = within(rowButton('Рассрочка')).getByText(/следующий/);
    expect(soon.className).toContain('tone-orange');
    const later = within(rowButton('Кредит на машину')).getByText(/следующий/);
    expect(later.className).not.toContain('tone-orange');
  });

  it('sums what is left, what is paid, and the monthly payments of open debts', () => {
    data.value = withDebts();
    renderScreen(<DebtsPage params={{}} />);
    const card = (label: string) => screen.getByText(label).closest('.stat-card')!.textContent;
    expect(card('Осталось')).toContain(m(9099.5));
    expect(card('Выплачено')).toContain(m(3700.5));
    expect(card('Платежи в месяц')).toContain(m(450));
  });

  it('with nothing yet: an empty state that opens the form', () => {
    data.value = scenario();
    renderScreen(<DebtsPage params={{}} />);
    expect(screen.getByText('Долгов пока нет')).toBeTruthy(); // as «Покупок пока нет»
    fireEvent.click(screen.getByRole('button', { name: 'Добавить долг' }));
    expect(dialog('Новый долг')).toBeTruthy();
  });
});

describe('DebtForm', () => {
  it('creates a debt; the rate is typed in percent and stored as a fraction', async () => {
    data.value = scenario();
    renderScreen(<DebtsPage params={{}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Новый долг' }));
    const d = dialog('Новый долг');
    type(inputIn(d, 'Название'), 'Рассрочка телефона');
    type(inputIn(d, 'Кому'), 'Магазин');
    type(inputIn(d, 'Сумма долга'), '600');
    type(inputIn(d, 'Выплачено'), '100');
    type(inputIn(d, 'Ставка, %'), '12,5');
    type(inputIn(d, 'Платёж в месяц'), '50');
    type(inputIn(d, 'Следующий платёж'), '2026-11-05');
    save(d);
    await actions.flush();
    expect(data.value!.debts).toEqual([
      { id: expect.any(String), name: 'Рассрочка телефона', whom: 'Магазин', total: 600, paid: 100, rate: 0.125, payment: 50, nextDate: '2026-11-05' },
    ]);
    expect(screen.getByText('Сохранено')).toBeTruthy();
    expect(await loadData()).toEqual(data.value);
  });

  it('needs only a name: the amount of the debt may stay blank, as in the tracker', async () => {
    data.value = scenario();
    const before = data.value;
    renderScreen(<DebtsPage params={{}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Новый долг' }));
    const d = dialog('Новый долг');
    save(d);
    expect(within(d).getByText('Введите название')).toBeTruthy();
    expect(within(d).queryByText('Введите сумму долга')).toBeNull();
    expect(data.value).toBe(before);

    type(inputIn(d, 'Название'), 'Долг Пете');
    save(d);
    await actions.flush();
    expect(data.value!.debts).toEqual([{ id: expect.any(String), name: 'Долг Пете' }]);
    expect(screen.getByText('Сохранено')).toBeTruthy();
  });

  it('an imported debt without an amount can be edited and saved', async () => {
    const d0 = scenario();
    d0.debts = [{ id: 'd-x', name: 'Долг без суммы', paid: 40 }];
    data.value = d0;
    renderScreen(<DebtsPage params={{}} />);
    fireEvent.click(rowButton('Долг без суммы'));
    const d = dialog('Долг');
    type(inputIn(d, 'Кому'), 'Петя');
    save(d);
    await actions.flush();
    expect(row(data.value!.debts, 'd-x')).toEqual({ id: 'd-x', name: 'Долг без суммы', whom: 'Петя', paid: 40 });
  });

  // A 3-decimal rate (the kit's decimal NumberField reads «3,875» as 3.875, not 3875). The form rounds to
  // 12 significant digits on store (`clean`), so 3.875 / 100 is exactly 0.03875 — compared with toBe, no tolerance.
  it('a new debt: rate «3,875» is typed and stored as exactly 0.03875, with no error shown', async () => {
    data.value = scenario();
    renderScreen(<DebtsPage params={{}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Новый долг' }));
    const d = dialog('Новый долг');
    type(inputIn(d, 'Название'), 'Ипотека');
    type(inputIn(d, 'Ставка, %'), '3,875');
    expect(inputIn(d, 'Ставка, %').value).toBe('3,875');
    expect(within(d).queryByRole('alert')).toBeNull();
    expect((within(d).getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(false);
    save(d);
    await actions.flush();
    expect(data.value!.debts).toHaveLength(1);
    expect(data.value!.debts[0]!.rate).toBe(0.03875);
    expect(await loadData()).toEqual(data.value);
  });

  it('an edited debt: retyping the rate as «3,875» stores exactly 0.03875 and keeps the other fields', async () => {
    data.value = withDebts();
    renderScreen(<DebtsPage params={{}} />);
    fireEvent.click(rowButton('Кредит на машину'));
    const d = dialog('Долг');
    expect(inputIn(d, 'Ставка, %').value).toBe('4,9');
    type(inputIn(d, 'Ставка, %'), '3,875');
    expect(within(d).queryByRole('alert')).toBeNull();
    save(d);
    await actions.flush();
    expect(row(data.value!.debts, 'd-car')).toEqual({
      id: 'd-car', name: 'Кредит на машину', whom: 'Банк', total: 12000, paid: 3500.5, rate: 0.03875, payment: 350, nextDate: '2027-01-31',
    });
    expect(row(data.value!.debts, 'd-car').rate).toBe(0.03875);
  });

  it('an imported debt with rate 0.03875 opens as «3,875» with no error and saves unchanged when untouched', async () => {
    const d0 = scenario();
    d0.debts = [{ id: 'd-mort', name: 'Ипотека', whom: 'Банк', total: 90000, paid: 1000, rate: 0.03875, payment: 500, nextDate: '2027-02-01' }];
    data.value = d0;
    const before = structuredClone(d0.debts[0]!);
    renderScreen(<DebtsPage params={{}} />);
    expect(rowButton('Ипотека').textContent).toContain('ставка 3,875\u00a0%');
    fireEvent.click(rowButton('Ипотека'));
    const d = dialog('Долг');
    const rate = inputIn(d, 'Ставка, %');
    expect(rate.value).toBe('3,875');
    fireEvent.blur(rate);
    expect(within(d).queryByRole('alert')).toBeNull();
    expect((within(d).getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(false);
    save(d);
    await actions.flush();
    expect(row(data.value!.debts, 'd-mort')).toEqual(before);
    expect(row(data.value!.debts, 'd-mort').rate).toBe(0.03875);
  });

  it('keystroke by keystroke: «7,5», backspace to «7,», then «8» gives «7,8» and stores 0.078', async () => {
    data.value = scenario();
    renderScreen(<DebtsPage params={{}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Новый долг' }));
    const d = dialog('Новый долг');
    type(inputIn(d, 'Название'), 'Займ');
    const rate = inputIn(d, 'Ставка, %');
    fireEvent.focus(rate);
    for (const typed of ['7', '7,', '7,5']) type(rate, typed);
    expect(rate.value).toBe('7,5');
    type(rate, '7,'); // backspace
    expect(rate.value).toBe('7,');
    type(rate, '7,8'); // the next digit is a decimal one, not «78»
    expect(rate.value).toBe('7,8');
    expect(within(d).queryByRole('alert')).toBeNull();
    fireEvent.blur(rate);
    expect(rate.value).toBe('7,8');
    expect(within(d).queryByRole('alert')).toBeNull();
    save(d);
    await actions.flush();
    expect(data.value!.debts[0]!.rate).toBe(0.078);
  });

  it('edits a debt without rounding noise in the rate; clearing a field removes it', async () => {
    data.value = withDebts();
    renderScreen(<DebtsPage params={{}} />);
    fireEvent.click(rowButton('Кредит на машину'));
    const d = dialog('Долг');
    expect(inputIn(d, 'Название').value).toBe('Кредит на машину');
    expect(inputIn(d, 'Ставка, %').value).toBe('4,9');
    expect(inputIn(d, 'Выплачено').value).toBe('3500,5');
    type(inputIn(d, 'Выплачено'), '3850,5');
    type(inputIn(d, 'Кому'), '');
    save(d);
    await actions.flush();
    expect(row(data.value!.debts, 'd-car')).toEqual({
      id: 'd-car', name: 'Кредит на машину', total: 12000, paid: 3850.5, rate: 0.049, payment: 350, nextDate: '2027-01-31',
    });
  });

  it('a rate over 100 % or a mistyped amount disables saving', () => {
    data.value = withDebts();
    renderScreen(<DebtsPage params={{}} />);
    fireEvent.click(rowButton('Кредит на машину'));
    const d = dialog('Долг');
    const saveButton = within(d).getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement;
    type(inputIn(d, 'Ставка, %'), '150');
    expect(within(d).getByText('От 0 до 100')).toBeTruthy();
    expect(saveButton.disabled).toBe(true);
    type(inputIn(d, 'Ставка, %'), '5');
    type(inputIn(d, 'Платёж в месяц'), '35о');
    expect(saveButton.disabled).toBe(true);
  });

  it('deletes after a confirmation, with «Отменить»', async () => {
    data.value = withDebts();
    renderScreen(<DebtsPage params={{}} />);
    fireEvent.click(rowButton('Долг Маше'));
    fireEvent.click(within(dialog('Долг')).getByRole('button', { name: 'Удалить долг' }));
    const ask = screen.getByRole('alertdialog', { name: 'Удалить долг?' });
    fireEvent.click(within(ask).getByRole('button', { name: 'Удалить' }));
    await actions.flush();
    expect(data.value!.debts.map((x) => x.id)).toEqual(['d-car', 'd-phone']);
    expect(screen.getByText('Долг удалён')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(data.value!.debts.map((x) => x.id)).toEqual(['d-car', 'd-masha', 'd-phone']);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('«Отмена» closes the form without saving', async () => {
    data.value = withDebts();
    const before = data.value;
    renderScreen(<DebtsPage params={{}} />);
    fireEvent.click(rowButton('Рассрочка'));
    const d = dialog('Долг');
    type(inputIn(d, 'Название'), 'Другое');
    expect(within(d).queryByRole('button', { name: 'Закрыть' })).toBeNull(); // the kit's «Отмена», as in the other forms
    fireEvent.click(within(d).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(data.value).toBe(before);
  });
});
