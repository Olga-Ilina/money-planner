// @vitest-environment happy-dom
// The item card: pay (with the fact), postpone, cancel, edit and delete — by source.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { addDays, purchaseFact } from '../../../src/engine';
import type { Data } from '../../../src/engine';
import { loadData, useFactory } from '../../../src/store/db';
import { actions } from '../../../src/ui/actions';
import { Toast } from '../../../src/ui/kit';
import { SheetHost, openSheet, openSheetKind } from '../../../src/ui/sheets/host';
import type { ItemRef } from '../../../src/ui/sheets/ItemSheet';
import { data, feedMonth, resetSession, today } from '../../../src/ui/state';
import { ACC, row, scenario } from '../../engine/scenario';
import { button, choose, plain, toastText, type } from './helpers';

beforeEach(() => {
  useFactory(new IDBFactory());
  resetSession();
  data.value = scenario();
  feedMonth.value = '2026-10';
});

afterEach(async () => {
  cleanup();
  await actions.flush();
  resetSession();
  useFactory(undefined);
});

function openItem(item: ItemRef, d?: Data): void {
  if (d) data.value = d;
  render(
    <>
      <SheetHost />
      <Toast />
    </>,
  );
  act(() => openSheet('item', { item }));
}

const current = (): Data => {
  if (!data.value) throw new Error('no data');
  return data.value;
};

function dialog(name: string): HTMLElement {
  return screen.getByRole('dialog', { name });
}

async function stored(): Promise<void> {
  await actions.flush();
  expect(await loadData()).toEqual(data.value);
}

describe('item card: journal row', () => {
  it('shows what it is: kind of record, name, date, plan, status, account, category', () => {
    openItem({ source: 'journal', id: 'j-eda', ym: '2026-10' });
    const card = plain(dialog('Плановая запись').textContent);
    expect(card).toContain('Еда');
    expect(card).toContain('Расход · 5 октября');
    expect(card).toContain('Запланировано');
    expect(card).toContain('100,00 €');
    expect(card).toContain('Продукты');
    expect(card).toContain('Карта');
  });

  it('«Оплачено» with the plan as the fact → status paid, no separate fact; undo brings it back', async () => {
    openItem({ source: 'journal', id: 'j-eda', ym: '2026-10' });
    expect((screen.getByLabelText('Сумма факт') as HTMLInputElement).value).toBe('100');
    const before = current();
    fireEvent.click(button('Оплачено'));
    expect(row(current().journal, 'j-eda')).toEqual({ ...row(before.journal, 'j-eda'), status: 'paid' });
    expect(toastText()).toBe('Оплачено');
    await stored();
    expect(openSheetKind()).toBeNull();
    fireEvent.click(button('Отменить'));
    expect(current()).toBe(before);
  });

  it('«Оплачено» with another amount stores it as the fact', async () => {
    openItem({ source: 'journal', id: 'j-eda', ym: '2026-10' });
    type(screen.getByLabelText('Сумма факт'), '95,5');
    fireEvent.click(button('Оплачено'));
    expect(row(current().journal, 'j-eda')).toMatchObject({ status: 'paid', fact: 95.5, plan: 100 });
    await stored();
  });

  it('a mistyped fact keeps «Оплачено» disabled and changes nothing', () => {
    openItem({ source: 'journal', id: 'j-eda', ym: '2026-10' });
    const before = current();
    type(screen.getByLabelText('Сумма факт'), '12abc');
    expect(button('Оплачено').disabled).toBe(true);
    fireEvent.click(button('Оплачено'));
    expect(current()).toBe(before);
  });

  it('a row without a plan needs the amount before it can be paid', async () => {
    openItem({ source: 'journal', id: 'j-arenda', ym: '2026-10' });
    const before = current();
    fireEvent.click(button('Оплачено'));
    expect(screen.getByText('Введите сумму')).toBeTruthy();
    expect(current()).toBe(before);
    type(screen.getByLabelText('Сумма факт'), '900');
    fireEvent.click(button('Оплачено'));
    expect(row(current().journal, 'j-arenda')).toMatchObject({ status: 'paid', fact: 900 });
    await stored();
  });

  it('a zero fact is refused', () => {
    openItem({ source: 'journal', id: 'j-eda', ym: '2026-10' });
    const before = current();
    type(screen.getByLabelText('Сумма факт'), '0');
    fireEvent.click(button('Оплачено'));
    expect(screen.getByText('Сумма не может быть нулевой')).toBeTruthy();
    expect(current()).toBe(before);
  });

  it('paying a row without an account asks for one (the first debit account by default)', async () => {
    const d = scenario();
    d.journal.push({ id: 'j-noacc', date: '2026-10-16', kind: 'expense', what: 'Рынок', plan: 25 });
    openItem({ source: 'journal', id: 'j-noacc', ym: '2026-10' }, d);
    const account = screen.getByLabelText('Счёт') as HTMLSelectElement;
    expect(account.value).toBe(ACC.card);
    choose(account, ACC.cash);
    fireEvent.click(button('Оплачено'));
    expect(row(current().journal, 'j-noacc')).toEqual({
      id: 'j-noacc', date: '2026-10-16', kind: 'expense', what: 'Рынок', plan: 25, status: 'paid', account: ACC.cash,
    });
    await stored();
  });

  it('a row whose account was deleted asks for one too; the chosen account replaces the deleted one', async () => {
    const d = scenario();
    d.journal.push({ id: 'j-gone', date: '2026-10-16', kind: 'expense', what: 'Рынок', plan: 25, account: 'acc-gone' });
    openItem({ source: 'journal', id: 'j-gone', ym: '2026-10' }, d);
    expect(plain(dialog('Плановая запись').textContent)).toContain('(удалённый счёт)');
    const account = screen.getByLabelText('Счёт') as HTMLSelectElement;
    expect(account.value).toBe(ACC.card);
    choose(account, ACC.cash);
    fireEvent.click(button('Оплачено'));
    expect(row(current().journal, 'j-gone')).toEqual({
      id: 'j-gone', date: '2026-10-16', kind: 'expense', what: 'Рынок', plan: 25, status: 'paid', account: ACC.cash,
    });
    await stored();
  });

  it('an income row is «Получено»', () => {
    const d = scenario();
    d.journal.push({ id: 'j-inc', date: '2026-10-25', kind: 'income', what: 'Возврат долга', plan: 70, account: ACC.card });
    openItem({ source: 'journal', id: 'j-inc', ym: '2026-10' }, d);
    fireEvent.click(button('Получено'));
    expect(row(current().journal, 'j-inc').status).toBe('paid');
    expect(toastText()).toBe('Получено');
  });

  it('«Перенести»: a new date (a week after the later of the date and today by default) and status postponed', async () => {
    openItem({ source: 'journal', id: 'j-eda', ym: '2026-10' });
    fireEvent.click(button('Перенести'));
    const date = screen.getByLabelText('Новая дата') as HTMLInputElement;
    expect(date.value).toBe(addDays(today() > '2026-10-05' ? today() : '2026-10-05', 7));
    type(date, '2026-10-25');
    fireEvent.click(button('Перенести на 25 октября'));
    expect(row(current().journal, 'j-eda')).toMatchObject({ status: 'postponed', date: '2026-10-25', plan: 100 });
    expect(toastText()).toBe('Перенесено на 25 октября');
    await stored();
  });

  it('«Перенести» needs a valid date; «Назад» returns to the card without changes', () => {
    openItem({ source: 'journal', id: 'j-eda', ym: '2026-10' });
    const before = current();
    fireEvent.click(button('Перенести'));
    const date = screen.getByLabelText('Новая дата');
    type(date, '0025-10-25');
    fireEvent.blur(date);
    expect(screen.getByText('Проверьте год')).toBeTruthy();
    expect((screen.getByRole('button', { name: /^Перенести на/ }) as HTMLButtonElement).disabled).toBe(true);
    type(date, '');
    fireEvent.click(screen.getByRole('button', { name: /^Перенести/ }));
    expect(screen.getByText('Укажите дату')).toBeTruthy();
    fireEvent.click(button('Назад'));
    expect(button('Оплачено')).toBeTruthy();
    expect(current()).toBe(before);
  });

  describe('postponing and the accounting month', () => {
    function withRow(r: Data['journal'][number]): Data {
      const d = scenario();
      d.journal.push(r);
      return d;
    }
    const NOTE = 'Месяц учёта останется: ноябрь 2026';
    const OUT = 'Дата вне учётного года — запись пропадёт из ленты';
    const salary = { id: 'j-zp2', date: '2026-10-30', kind: 'income' as const, what: 'ЗП ноябрь', plan: 400, account: ACC.card, month: '2026-11' as const };

    it('a row with its own accounting month says it stays, and keeps it after the move', async () => {
      openItem({ source: 'journal', id: 'j-zp2', ym: '2026-11' }, withRow(salary));
      fireEvent.click(button('Перенести'));
      expect(screen.getByText(NOTE)).toBeTruthy();
      // the kit field hint: it describes the date input
      expect(screen.getByLabelText('Новая дата').getAttribute('aria-describedby')).toBe(screen.getByText(NOTE).id);
      type(screen.getByLabelText('Новая дата'), '2026-11-05');
      expect(screen.getByText(NOTE)).toBeTruthy();
      fireEvent.click(button('Перенести на 5 ноября'));
      expect(row(current().journal, 'j-zp2')).toEqual({ ...salary, status: 'postponed', date: '2026-11-05' });
      await stored();
    });

    it('a row without its own month has no such note', () => {
      openItem({ source: 'journal', id: 'j-eda', ym: '2026-10' });
      fireEvent.click(button('Перенести'));
      expect(screen.queryByText(/Месяц учёта останется/)).toBeNull();
    });

    it('a month outside the accounting year is not «own»: it does not hold the row in the feed', () => {
      const old = { id: 'j-old', date: '2026-10-20', kind: 'expense' as const, what: 'Старая', plan: 5, month: '2025-01' as const };
      openItem({ source: 'journal', id: 'j-old', ym: '2026-10' }, withRow(old));
      fireEvent.click(button('Перенести'));
      expect(screen.queryByText(/Месяц учёта останется/)).toBeNull();
    });

    it('a new date outside the accounting year warns that the row leaves the feed, and still saves', async () => {
      openItem({ source: 'journal', id: 'j-eda', ym: '2026-10' });
      fireEvent.click(button('Перенести'));
      expect(screen.queryByText(OUT)).toBeNull();
      type(screen.getByLabelText('Новая дата'), '2027-10-05');
      expect(screen.getByText(OUT)).toBeTruthy();
      const go = button('Перенести на 5 октября');
      expect(go.disabled).toBe(false);
      fireEvent.click(go);
      expect(row(current().journal, 'j-eda')).toMatchObject({ status: 'postponed', date: '2027-10-05' });
      await stored();
    });

    it('with its own month an outside-year date needs no warning: the row stays in its month', () => {
      openItem({ source: 'journal', id: 'j-zp2', ym: '2026-11' }, withRow(salary));
      fireEvent.click(button('Перенести'));
      type(screen.getByLabelText('Новая дата'), '2027-10-05');
      expect(screen.queryByText(OUT)).toBeNull();
      expect(screen.getByText(NOTE)).toBeTruthy();
    });
  });

  it('«Пометить отменённой» → status cancelled, with undo («Отменить» only ever means undo)', async () => {
    openItem({ source: 'journal', id: 'j-eda', ym: '2026-10' });
    const before = current();
    expect(screen.queryByRole('button', { name: /^Отменить/ })).toBeNull();
    fireEvent.click(button('Пометить отменённой'));
    expect(row(current().journal, 'j-eda').status).toBe('cancelled');
    expect(toastText()).toBe('Запись отменена');
    await stored();
    fireEvent.click(button('Отменить'));
    expect(current()).toBe(before);
  });

  it('a paid row offers «Снять оплату», «Изменить» and «Удалить» — not paying, postponing or cancelling', () => {
    openItem({ source: 'journal', id: 'j-kafe', ym: '2026-10' });
    expect(screen.queryByRole('button', { name: 'Оплачено' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Перенести' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Пометить отменённой' })).toBeNull();
    expect(button('Снять оплату')).toBeTruthy();
    expect(button('Изменить')).toBeTruthy();
    expect(button('Удалить')).toBeTruthy();
  });

  it('a cancelled row offers only «Изменить» and «Удалить»', () => {
    openItem({ source: 'journal', id: 'j-otmena', ym: '2026-10' });
    expect(screen.queryByRole('button', { name: 'Снять оплату' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Оплачено' })).toBeNull();
    expect(button('Изменить')).toBeTruthy();
    expect(button('Удалить')).toBeTruthy();
  });

  it('a planned row has no «Снять оплату»', () => {
    openItem({ source: 'journal', id: 'j-eda', ym: '2026-10' });
    expect(screen.queryByRole('button', { name: 'Снять оплату' })).toBeNull();
  });

  it('«Снять оплату» → status planned and the fact removed, one commit; undo brings the payment back', async () => {
    openItem({ source: 'journal', id: 'j-taxi', ym: '2026-10' });
    const before = current();
    fireEvent.click(button('Снять оплату'));
    const { fact: _fact, ...rest } = row(before.journal, 'j-taxi');
    expect(row(current().journal, 'j-taxi')).toStrictEqual({ ...rest, status: 'planned' });
    expect(current().journal).toHaveLength(before.journal.length);
    expect(toastText()).toBe('Оплата снята');
    expect(openSheetKind()).toBeNull();
    await stored();
    fireEvent.click(button('Отменить'));
    expect(current()).toBe(before);
  });

  it('un-paying a row paid at its plan keeps the plan', async () => {
    openItem({ source: 'journal', id: 'j-kafe', ym: '2026-10' });
    fireEvent.click(button('Снять оплату'));
    expect(row(current().journal, 'j-kafe')).toStrictEqual({ ...row(scenario().journal, 'j-kafe'), status: 'planned' });
    await stored();
  });

  it('a row whose status was never set but has a fact is paid — and can be un-paid', () => {
    const d = scenario();
    d.journal.push({ id: 'j-bare', date: '2026-10-16', kind: 'expense', what: 'Без статуса', plan: 50, fact: 45, account: ACC.card });
    openItem({ source: 'journal', id: 'j-bare', ym: '2026-10' }, d);
    fireEvent.click(button('Снять оплату'));
    expect(row(current().journal, 'j-bare')).toStrictEqual({
      id: 'j-bare', date: '2026-10-16', kind: 'expense', what: 'Без статуса', plan: 50, account: ACC.card, status: 'planned',
    });
  });

  it('a paid row that had only a fact keeps its amount as the plan when un-paid', () => {
    openItem({ source: 'journal', id: 'j-vozvrat', ym: '2026-10' });
    fireEvent.click(button('Снять оплату'));
    expect(row(current().journal, 'j-vozvrat')).toStrictEqual({
      id: 'j-vozvrat', date: '2026-10-10', kind: 'expense', category: 'Продукты', what: 'Возврат', plan: -20, status: 'planned',
      account: ACC.card,
    });
  });

  it('«Удалить» asks first, then removes the row with undo', async () => {
    openItem({ source: 'journal', id: 'j-eda', ym: '2026-10' });
    const before = current();
    fireEvent.click(button('Удалить'));
    const confirm = screen.getByRole('alertdialog', { name: 'Удалить запись?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Отмена' }));
    expect(current()).toBe(before);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    fireEvent.click(button('Удалить'));
    fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Удалить запись?' })).getByRole('button', { name: 'Удалить' }));
    expect(current().journal.some((r) => r.id === 'j-eda')).toBe(false);
    expect(current().journal).toHaveLength(before.journal.length - 1);
    expect(toastText()).toBe('Запись удалена');
    await stored();
    fireEvent.click(button('Отменить'));
    expect(current()).toBe(before);
  });

  it('«Изменить» opens the journal form with the row', () => {
    openItem({ source: 'journal', id: 'j-eda', ym: '2026-10' });
    fireEvent.click(button('Изменить'));
    expect(openSheetKind()).toBe('journal');
    expect((screen.getByLabelText('Что') as HTMLInputElement).value).toBe('Еда');
  });

  it('warns about a possible duplicate', () => {
    openItem({ source: 'journal', id: 'j-arenda', ym: '2026-10' });
    expect(screen.getByText('Возможный дубль: так же называется постоянный платёж.')).toBeTruthy();
  });

  it('an operation that repeats a journal row names it a «плановая запись» (the UI’s word, not «журнал»)', () => {
    openItem({ source: 'operation', id: 'o-kafe', ym: '2026-10' });
    expect(screen.getByText('Возможный дубль: есть плановая запись с той же датой и суммой.')).toBeTruthy();
  });

  it('a row that is gone shows «Запись не найдена»', () => {
    openItem({ source: 'journal', id: 'nope', ym: '2026-10' });
    expect(dialog('Запись')).toBeTruthy();
    expect(screen.getByText('Запись не найдена')).toBeTruthy();
  });
});

describe('item card: recurring payment', () => {
  it('marks the month paid with ✓ when the amount is unchanged', async () => {
    openItem({ source: 'recurring', id: 'r-strahovka', ym: '2026-11' });
    const card = plain(dialog('Постоянный платёж').textContent);
    expect(card).toContain('Страховка');
    expect(card).toContain('Расход · 15 ноября');
    expect(card).toContain('Раз в 3 месяца'); // the form's words (lists may say «раз в 3 мес.»)
    expect(card).toContain('30,00 €');
    expect((screen.getByLabelText('Сумма факт') as HTMLInputElement).value).toBe('30');
    fireEvent.click(button('Отметить оплату за ноябрь 2026'));
    expect(row(current().recurring, 'r-strahovka').marks).toEqual({ '2026-11': '✓' });
    expect(toastText()).toBe('Отмечено');
    await stored();
  });

  it('another amount is stored as the month’s mark; 0 is a valid mark (skipped this month)', async () => {
    openItem({ source: 'recurring', id: 'r-strahovka', ym: '2026-11' });
    type(screen.getByLabelText('Сумма факт'), '0');
    fireEvent.click(button('Отметить оплату за ноябрь 2026'));
    expect(row(current().recurring, 'r-strahovka').marks).toEqual({ '2026-11': 0 });
    await stored();
  });

  it('a marked month can be unmarked; other months keep their marks', async () => {
    openItem({ source: 'recurring', id: 'r-arenda', ym: '2026-10' });
    expect(plain(dialog('Постоянный платёж').textContent)).toContain('Отметка за октябрь 2026');
    fireEvent.click(button('Снять отметку'));
    expect(row(current().recurring, 'r-arenda').marks).toEqual({ '2026-11': 950 });
    expect(toastText()).toBe('Отметка снята');
    await stored();
  });

  it('shows a numeric mark as the amount paid', () => {
    openItem({ source: 'recurring', id: 'r-arenda', ym: '2026-11' });
    expect(plain(dialog('Постоянный платёж').textContent)).toContain('950,00 €');
  });

  it('income is «Отметить получение за …»; without a month it uses the month shown in «Лента»', () => {
    feedMonth.value = '2026-11';
    openItem({ source: 'recurring', id: 'r-bonus' });
    fireEvent.click(button('Отметить получение за ноябрь 2026'));
    expect(row(current().recurring, 'r-bonus').marks).toEqual({ '2026-10': '✓', '2026-11': '✓' });
  });

  it('a payment without an account asks for one when marking (the first debit account by default); it is saved in the payment', async () => {
    const d = scenario();
    d.recurring.push({ id: 'r-noacc', what: 'Свет', kind: 'expense', category: 'Жильё', day: 7, amount: 60, marks: {} });
    openItem({ source: 'recurring', id: 'r-noacc', ym: '2026-10' }, d);
    const account = screen.getByLabelText('Счёт') as HTMLSelectElement;
    expect(account.value).toBe(ACC.card);
    expect(plain(dialog('Постоянный платёж').textContent)).toContain('Счёт сохранится в постоянном платеже');
    choose(account, ACC.cash);
    fireEvent.click(button('Отметить оплату за октябрь 2026'));
    expect(row(current().recurring, 'r-noacc')).toEqual({
      id: 'r-noacc', what: 'Свет', kind: 'expense', category: 'Жильё', day: 7, amount: 60, marks: { '2026-10': '✓' }, account: ACC.cash,
    });
    await stored();
  });

  it('marks of other months that the balances count: the hint says they will reach the account too (and how many)', () => {
    const d = scenario();
    d.recurring.push({
      id: 'r-noacc', what: 'Свет', kind: 'expense', category: 'Жильё', day: 7, amount: 60,
      // October to December count; a 0 mark and a month outside the year do not (February is shown, unmarked)
      marks: { '2026-10': '✓', '2026-11': '✓', '2026-12': 55, '2027-01': 0, '2025-12': '✓' },
    });
    openItem({ source: 'recurring', id: 'r-noacc', ym: '2027-02' }, d);
    const account = screen.getByLabelText('Счёт');
    const hint = document.getElementById(account.getAttribute('aria-describedby') ?? '');
    expect(plain(hint?.textContent)).toBe(
      'Счёт сохранится в постоянном платеже — отметки за другие месяцы (3) тоже попадут в остаток этого счёта.',
    );
  });

  it('no such words when no other month has a mark the balances count', () => {
    const d = scenario();
    d.recurring.push({ id: 'r-noacc', what: 'Свет', kind: 'expense', day: 7, amount: 60, marks: { '2027-01': 0, '2025-12': '✓' } });
    openItem({ source: 'recurring', id: 'r-noacc', ym: '2026-10' }, d);
    const account = screen.getByLabelText('Счёт');
    const hint = document.getElementById(account.getAttribute('aria-describedby') ?? '');
    expect(plain(hint?.textContent)).toBe('Счёт сохранится в постоянном платеже.');
  });

  it('a payment with an account asks for none', () => {
    openItem({ source: 'recurring', id: 'r-strahovka', ym: '2026-11' });
    expect(screen.queryByRole('combobox', { name: 'Счёт' })).toBeNull();
  });

  it('«Удалить» asks first (the marks go with it), then removes the payment with undo', async () => {
    openItem({ source: 'recurring', id: 'r-strahovka', ym: '2026-11' });
    const before = current();
    fireEvent.click(button('Удалить'));
    const confirm = screen.getByRole('alertdialog', {
      name: 'Удалить постоянный платёж?',
      description: 'Отметки по месяцам удалятся вместе с ним.',
    });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Удалить' }));
    expect(current().recurring.some((r) => r.id === 'r-strahovka')).toBe(false);
    expect(toastText()).toBe('Платёж удалён');
    expect(openSheetKind()).toBeNull();
    await stored();
    fireEvent.click(button('Отменить'));
    expect(current()).toBe(before);
  });

  it('«Изменить» opens the recurring form', () => {
    openItem({ source: 'recurring', id: 'r-arenda', ym: '2026-10' });
    fireEvent.click(button('Изменить'));
    expect(openSheetKind()).toBe('recurring');
  });
});

describe('item card: purchase', () => {
  function withPhone(extra: Partial<Data['purchases'][number]> = {}): Data {
    const d = scenario();
    d.purchases.push({ id: 'p-tel', what: 'Телефон', category: 'Техника', cost: 300, saved: 120, date: '2026-10-15', bought: false, ...extra });
    return d;
  }

  it('«Куплено» with a price and an account', async () => {
    openItem({ source: 'purchase', id: 'p-tel', ym: '2026-10' }, withPhone());
    const card = plain(dialog('Покупка').textContent);
    expect(card).toContain('Телефон');
    expect(card).toContain('Отложено120,00 €'); // «Отложено» as in the form and «Покупки» («Накоплено» is the year’s total)
    expect(card).not.toContain('Накоплено');
    expect((screen.getByLabelText('Цена факт') as HTMLInputElement).value).toBe('300');
    type(screen.getByLabelText('Цена факт'), '280');
    choose(screen.getByLabelText('Счёт'), ACC.card);
    fireEvent.click(button('Куплено'));
    expect(row(current().purchases, 'p-tel')).toEqual({
      id: 'p-tel', what: 'Телефон', category: 'Техника', cost: 300, saved: 120, date: '2026-10-15', bought: true, price: 280,
      account: ACC.card,
    });
    expect(toastText()).toBe('Куплено');
    await stored();
  });

  it('an account is required: no «Без счёта» choice, nothing chosen by itself, «Выберите счёт» and no purchase without it', () => {
    openItem({ source: 'purchase', id: 'p-tel', ym: '2026-10' }, withPhone());
    const account = screen.getByLabelText('Счёт') as HTMLSelectElement;
    expect(account.value).toBe('');
    expect(Array.from(account.options).map((o) => o.textContent)).not.toContain('Без счёта');
    const before = current();
    fireEvent.click(button('Куплено'));
    expect(screen.getByText('Выберите счёт')).toBeTruthy();
    expect(current()).toBe(before);
    expect(openSheetKind()).toBe('item');
    expect(row(current().purchases, 'p-tel').bought).toBe(false);
    choose(account, ACC.cash);
    expect(screen.queryByText('Выберите счёт')).toBeNull();
    fireEvent.click(button('Куплено'));
    expect(row(current().purchases, 'p-tel')).toMatchObject({ bought: true, account: ACC.cash });
  });

  it('a purchase whose account was deleted needs a new one before «Куплено»', () => {
    const d = withPhone();
    d.purchases = d.purchases.map((p) => (p.id === 'p-tel' ? { ...p, account: 'acc-gone' } : p));
    openItem({ source: 'purchase', id: 'p-tel', ym: '2026-10' }, d);
    const account = screen.getByLabelText('Счёт') as HTMLSelectElement;
    expect(account.value).toBe('');
    fireEvent.click(button('Куплено'));
    expect(screen.getByText('Выберите счёт')).toBeTruthy();
    expect(row(current().purchases, 'p-tel').bought).toBe(false);
    choose(account, ACC.cash);
    fireEvent.click(button('Куплено'));
    expect(row(current().purchases, 'p-tel')).toMatchObject({ bought: true, account: ACC.cash });
  });

  it('a recurring payment whose account was deleted asks for one when marking; it replaces the deleted one', () => {
    const d = scenario();
    d.recurring.push({ id: 'r-gone', what: 'Вода', kind: 'expense', day: 7, amount: 20, account: 'acc-gone', marks: {} });
    openItem({ source: 'recurring', id: 'r-gone', ym: '2026-10' }, d);
    const account = screen.getByLabelText('Счёт') as HTMLSelectElement;
    choose(account, ACC.cash);
    fireEvent.click(button('Отметить оплату за октябрь 2026'));
    expect(row(current().recurring, 'r-gone')).toMatchObject({ account: ACC.cash, marks: { '2026-10': '✓' } });
  });

  it('a bought purchase has an account, a date and a price', async () => {
    openItem({ source: 'purchase', id: 'p-tel', ym: '2026-10' }, withPhone());
    choose(screen.getByLabelText('Счёт'), ACC.card);
    type(screen.getByLabelText('Цена факт'), '280');
    fireEvent.click(button('Куплено'));
    const bought = row(current().purchases, 'p-tel');
    expect(bought.bought).toBe(true);
    expect(bought.account).toBe(ACC.card);
    expect(bought.date).toBe('2026-10-15');
    expect(bought.price).toBe(280);
    expect(purchaseFact(bought)).toBe(280);
    await stored();
  });

  it('a purchase without a date gets today’s date when it is bought', async () => {
    openItem({ source: 'purchase', id: 'p-tel', ym: '2026-10' }, withPhone({ date: undefined }));
    choose(screen.getByLabelText('Счёт'), ACC.card);
    fireEvent.click(button('Куплено'));
    expect(row(current().purchases, 'p-tel')).toMatchObject({ bought: true, date: today(), account: ACC.card });
    await stored();
  });

  it('a purchase that already has an account is bought with it: no account question', () => {
    openItem({ source: 'purchase', id: 'p-tel', ym: '2026-10' }, withPhone({ account: ACC.cash }));
    expect(screen.queryByLabelText('Счёт')).toBeNull();
    fireEvent.click(button('Куплено'));
    expect(row(current().purchases, 'p-tel')).toMatchObject({ bought: true, account: ACC.cash });
  });

  it('a mistyped price keeps «Куплено» disabled', () => {
    openItem({ source: 'purchase', id: 'p-tel', ym: '2026-10' }, withPhone());
    choose(screen.getByLabelText('Счёт'), ACC.card);
    type(screen.getByLabelText('Цена факт'), '28x');
    expect(button('Куплено').disabled).toBe(true);
  });

  it('«Удалить» asks first, then removes the purchase with undo', async () => {
    openItem({ source: 'purchase', id: 'p-tel', ym: '2026-10' }, withPhone());
    const before = current();
    fireEvent.click(button('Удалить'));
    const confirm = screen.getByRole('alertdialog', { name: 'Удалить покупку?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Отмена' }));
    expect(current()).toBe(before);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    fireEvent.click(button('Удалить'));
    fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Удалить покупку?' })).getByRole('button', { name: 'Удалить' }));
    expect(current().purchases.some((p) => p.id === 'p-tel')).toBe(false);
    expect(toastText()).toBe('Покупка удалена');
    await stored();
    fireEvent.click(button('Отменить'));
    expect(current()).toBe(before);
  });

  it('a bought purchase offers «Изменить» and «Удалить», not «Куплено»', () => {
    openItem({ source: 'purchase', id: 'p-noutbuk', ym: '2026-12' });
    expect(button('Удалить')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Куплено' })).toBeNull();
    expect(plain(dialog('Покупка').textContent)).toContain('Цена факт480,00 €'); // the form's word
    fireEvent.click(button('Изменить'));
    expect(openSheetKind()).toBe('purchase');
  });
});

describe('item card: operation', () => {
  it('shows a transfer from → to', () => {
    openItem({ source: 'operation', id: 'o-snyatie', ym: '2026-10' });
    const card = plain(dialog('Операция').textContent);
    expect(card).toContain('Снятие');
    expect(card).toContain('Перевод · 13 октября');
    expect(card).toContain('Со счёта');
    expect(card).toContain('Карта');
    expect(card).toContain('На счёт');
    expect(card).toContain('Наличные');
  });

  it('«Удалить» asks, removes it with undo', async () => {
    openItem({ source: 'operation', id: 'o-bilet', ym: '2026-10' });
    const before = current();
    fireEvent.click(button('Удалить'));
    fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Удалить операцию?' })).getByRole('button', { name: 'Удалить' }));
    expect(current().operations.map((o) => o.id)).not.toContain('o-bilet');
    expect(toastText()).toBe('Операция удалена');
    await stored();
    fireEvent.click(button('Отменить'));
    expect(current()).toBe(before);
  });

  it('«Изменить» opens the operation form', () => {
    openItem({ source: 'operation', id: 'o-bilet', ym: '2026-10' });
    fireEvent.click(button('Изменить'));
    expect(openSheetKind()).toBe('operation');
  });
});
