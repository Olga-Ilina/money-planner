// @vitest-environment happy-dom
// The journal form (a planned expense or income): validation, create, edit, delete.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import type { Data, JournalRow } from '../../../src/engine';
import { loadData, useFactory } from '../../../src/store/db';
import { actions } from '../../../src/ui/actions';
import { Toast } from '../../../src/ui/kit';
import { SheetHost, openSheet, openSheetKind } from '../../../src/ui/sheets/host';
import { journalFromDraft, validateJournal } from '../../../src/ui/sheets/JournalForm';
import type { JournalDraft } from '../../../src/ui/sheets/JournalForm';
import { data, feedMonth, resetSession, tab, today } from '../../../src/ui/state';
import { ACC, row, scenario } from '../../engine/scenario';
import { button, choose, toastText, type } from './helpers';

beforeEach(() => {
  useFactory(new IDBFactory());
  resetSession();
  data.value = scenario();
});

afterEach(async () => {
  cleanup();
  await actions.flush();
  resetSession();
  useFactory(undefined);
});

const current = (): Data => {
  if (!data.value) throw new Error('no data');
  return data.value;
};

function openForm(props: { initial?: JournalRow; preset?: Partial<JournalRow> } = {}): void {
  render(
    <>
      <SheetHost />
      <Toast />
    </>,
  );
  act(() => openSheet('journal', props));
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement & HTMLSelectElement;
const optionLabels = (label: string): string[] => Array.from(field(label).options).map((o) => o.textContent ?? '');
const save = () => button('Сохранить');

describe('validateJournal', () => {
  const ok: JournalDraft = { kind: 'expense', what: 'Врач', date: '2026-10-18', plan: 60 };

  it('a complete draft has no errors', () => {
    expect(validateJournal(ok)).toEqual({});
  });

  it('«Что» and the date are required (spaces are not a name)', () => {
    // the same words as every other form
    expect(validateJournal({ ...ok, what: '   ' })).toEqual({ what: 'Введите название' });
    expect(validateJournal({ ...ok, what: undefined, date: undefined })).toEqual({ what: 'Введите название', date: 'Укажите дату' });
  });

  it('a non-zero plan or a non-zero fact (a refund is negative), unless cancelled', () => {
    const need = { amount: 'Укажите план или факт' };
    expect(validateJournal({ ...ok, plan: undefined })).toEqual(need);
    expect(validateJournal({ ...ok, plan: 0 })).toEqual(need);
    expect(validateJournal({ ...ok, plan: undefined, fact: 0 })).toEqual(need);
    expect(validateJournal({ ...ok, plan: undefined, fact: 40 })).toEqual({});
    expect(validateJournal({ ...ok, plan: undefined, fact: -20 })).toEqual({});
    // a planned refund is a negative plan
    expect(validateJournal({ ...ok, plan: -20 })).toEqual({});
    expect(validateJournal({ ...ok, plan: -20, fact: undefined })).toEqual({});
    expect(validateJournal({ ...ok, plan: undefined, status: 'cancelled' })).toEqual({});
  });
});

describe('journalFromDraft', () => {
  it('keeps only the fields that are set; «Что» is trimmed', () => {
    expect(journalFromDraft({ kind: 'expense', what: '  Врач ', date: '2026-10-18', plan: 60, status: 'planned' }, 'j1')).toEqual({
      id: 'j1', date: '2026-10-18', kind: 'expense', what: 'Врач', plan: 60, status: 'planned',
    });
  });

  it('stores the accounting month only when it differs from the month of the date', () => {
    const base: JournalDraft = { kind: 'income', what: 'ЗП', date: '2026-10-30', plan: 400, category: 'Зарплата', account: ACC.card };
    expect(journalFromDraft({ ...base, month: '2026-11' }, 'j2').month).toBe('2026-11');
    expect('month' in journalFromDraft({ ...base, month: '2026-10' }, 'j2')).toBe(false);
  });

  it('every optional field when given', () => {
    expect(
      journalFromDraft(
        {
          kind: 'expense', what: 'Такси', date: '2026-10-07', category: 'Транспорт', plan: 100, fact: 90, status: 'paid',
          account: ACC.card, priority: 'Желательно', month: '2026-11',
        },
        'j3',
      ),
    ).toEqual({
      id: 'j3', date: '2026-10-07', kind: 'expense', category: 'Транспорт', what: 'Такси', plan: 100, fact: 90, status: 'paid',
      account: ACC.card, priority: 'Желательно', month: '2026-11',
    });
  });
});

describe('new journal row', () => {
  it('starts as a planned expense today on the first debit account', () => {
    openForm();
    expect(screen.getByRole('dialog', { name: 'Новая плановая запись' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Расход' }).getAttribute('aria-checked')).toBe('true');
    expect(field('Дата').value).toBe(today());
    expect(field('Статус').value).toBe('planned');
    expect(field('Счёт').value).toBe(ACC.card);
    expect(field('Месяц учёта').value).toBe('');
    expect(optionLabels('Статус')).toEqual(['Запланировано', 'Оплачено', 'Перенесено', 'Отменено']);
    expect(optionLabels('Приоритет')).toEqual(['Не указан', 'Обязательно', 'Желательно', 'Можно отложить']);
    expect(optionLabels('Месяц учёта')).toEqual([
      'Как у даты', 'Октябрь 2026', 'Ноябрь 2026', 'Декабрь 2026', 'Январь 2027', 'Февраль 2027', 'Март 2027', 'Апрель 2027',
      'Май 2027', 'Июнь 2027', 'Июль 2027', 'Август 2027', 'Сентябрь 2027',
    ]);
    expect(optionLabels('Категория')).toEqual(['Без категории', 'Жильё', 'Продукты', 'Транспорт', 'Подписки', 'Техника']);
  });

  it('says what is missing and saves nothing', () => {
    openForm();
    const before = current();
    type(field('Дата'), '');
    fireEvent.click(save());
    expect(screen.getByText('Введите название')).toBeTruthy();
    expect(screen.getByText('Укажите дату')).toBeTruthy();
    expect(screen.getByText('Укажите план или факт')).toBeTruthy();
    expect(current()).toBe(before);
    expect(openSheetKind()).toBe('journal');
  });

  it('saves a planned expense, appended, with «Сохранено» and undo', async () => {
    openForm();
    const before = current();
    type(field('Что'), 'Врач');
    type(field('Дата'), '2026-10-18');
    choose(field('Категория'), 'Продукты');
    type(field('План'), '60');
    fireEvent.click(save());
    const added = current().journal[current().journal.length - 1];
    expect(added).toEqual({
      id: expect.any(String), date: '2026-10-18', kind: 'expense', category: 'Продукты', what: 'Врач', plan: 60, status: 'planned',
      account: ACC.card,
    });
    expect(current().journal).toHaveLength(before.journal.length + 1);
    expect(toastText()).toBe('Сохранено');
    expect(openSheetKind()).toBeNull();
    await actions.flush();
    expect(await loadData()).toEqual(data.value);
    fireEvent.click(button('Отменить'));
    expect(current()).toBe(before);
  });

  it('an income row uses the income categories; an expense category does not carry over', () => {
    openForm();
    choose(field('Категория'), 'Продукты');
    fireEvent.click(screen.getByRole('radio', { name: 'Доход' }));
    expect(optionLabels('Категория')).toEqual(['Без категории', 'Зарплата', 'Премия']);
    expect(field('Категория').value).toBe('');
    choose(field('Категория'), 'Премия');
    type(field('Что'), 'Бонус');
    type(field('Дата'), '2026-10-28');
    type(field('План'), '150');
    choose(field('Приоритет'), 'Желательно');
    fireEvent.click(save());
    expect(current().journal.at(-1)).toMatchObject({ kind: 'income', category: 'Премия', what: 'Бонус', plan: 150, priority: 'Желательно' });
  });

  it('switching the kind keeps a category that is in neither list, drops one of the old kind’s list', () => {
    const odd: JournalRow = { id: 'j-odd', date: '2026-10-11', kind: 'expense', category: 'Старое', what: 'Старая запись', plan: 5 };
    data.value = { ...current(), journal: [...current().journal, odd] };
    openForm({ initial: odd });
    expect(field('Категория').value).toBe('Старое');
    fireEvent.click(screen.getByRole('radio', { name: 'Доход' }));
    expect(field('Категория').value).toBe('Старое');
    fireEvent.click(screen.getByRole('radio', { name: 'Расход' }));
    expect(field('Категория').value).toBe('Старое');
    fireEvent.click(save());
    expect(row(current().journal, 'j-odd')).toEqual(odd);
  });

  it('a category in both lists survives the switch', () => {
    const d = scenario();
    d.categories.income.push({ name: 'Продукты' });
    data.value = d;
    openForm();
    choose(field('Категория'), 'Продукты');
    fireEvent.click(screen.getByRole('radio', { name: 'Доход' }));
    expect(field('Категория').value).toBe('Продукты');
  });

  it('a fact typed while the status is untouched makes it «Оплачено»', () => {
    openForm();
    type(field('Что'), 'Аптека');
    type(field('Дата'), '2026-10-03');
    type(field('Факт'), '12,40');
    expect(field('Статус').value).toBe('paid');
    fireEvent.click(save());
    expect(current().journal.at(-1)).toMatchObject({ what: 'Аптека', fact: 12.4, status: 'paid' });
    expect('plan' in (current().journal.at(-1) ?? {})).toBe(false);
  });

  it('a cancelled row needs no amount', () => {
    openForm();
    type(field('Что'), 'Не нужно');
    type(field('Дата'), '2026-10-03');
    choose(field('Статус'), 'cancelled');
    fireEvent.click(save());
    expect(current().journal.at(-1)).toMatchObject({ what: 'Не нужно', status: 'cancelled' });
  });

  it('the accounting month: a month other than the date’s is stored, the same month is not', () => {
    openForm();
    type(field('Что'), 'ЗП ноябрь');
    type(field('Дата'), '2026-10-30');
    type(field('План'), '400');
    choose(field('Месяц учёта'), '2026-11');
    fireEvent.click(save());
    expect(current().journal.at(-1)?.month).toBe('2026-11');
  });

  it('a mistyped plan disables saving and keeps the typed text', () => {
    openForm();
    type(field('Что'), 'Врач');
    type(field('План'), '60abc');
    expect(save().disabled).toBe(true);
    expect(field('План').value).toBe('60abc');
    type(field('План'), '60');
    expect(save().disabled).toBe(false);
  });

  it('takes a preset (e.g. an income on a given date)', () => {
    openForm({ preset: { kind: 'income', date: '2026-11-01', account: ACC.cash } });
    expect(screen.getByRole('radio', { name: 'Доход' }).getAttribute('aria-checked')).toBe('true');
    expect(field('Дата').value).toBe('2026-11-01');
    expect(field('Счёт').value).toBe(ACC.cash);
  });

  it('«Отмена» closes without saving', () => {
    openForm();
    const before = current();
    type(field('Что'), 'Врач');
    fireEvent.click(button('Отмена'));
    expect(openSheetKind()).toBeNull();
    expect(current()).toBe(before);
  });
});

describe('saved into another month than «Лента» shows', () => {
  it('the accounting month counts: «Показать» switches «Лента» to it', async () => {
    tab.value = 'feed';
    feedMonth.value = '2026-10';
    openForm({ preset: { date: '2026-10-15' } });
    type(field('Что'), 'Врач');
    type(field('План'), '60');
    choose(field('Месяц учёта'), '2027-01');
    fireEvent.click(save());
    fireEvent.click(button('Показать'));
    expect(feedMonth.value).toBe('2027-01');
  });

  it('none when the row stays in the shown month', () => {
    tab.value = 'feed';
    feedMonth.value = '2026-10';
    openForm({ preset: { date: '2026-10-15' } });
    type(field('Что'), 'Врач');
    type(field('План'), '60');
    fireEvent.click(save());
    expect(screen.queryByRole('button', { name: 'Показать' })).toBeNull();
  });
});

describe('a date outside the accounting year', () => {
  const NOTE =
    'Дата вне учётного года (Октябрь 2026 — сентябрь 2027): запись учтётся в остатках, но не попадёт в ленту и отчёты. Учётный год меняется в «Ещё → Учёт и прогноз».';
  // «Дата остатков» is 1 October 2026 in the scenario: a row counted before it reaches no balance either
  const NOTE_BEFORE =
    'Дата вне учётного года (Октябрь 2026 — сентябрь 2027): запись не попадёт ни в остатки (раньше даты остатков), ни в ленту и отчёты. Учётный год меняется в «Ещё → Учёт и прогноз».';

  it('warns under the date (describing it) and still saves', async () => {
    openForm({ preset: { date: '2026-10-15' } });
    expect(screen.queryByText(NOTE)).toBeNull();
    type(field('Что'), 'Врач');
    type(field('План'), '60');
    type(field('Дата'), '2027-11-03');
    const note = screen.getByText(NOTE);
    expect(note.closest('.field')).toBe(field('Дата').closest('.field'));
    expect(field('Дата').getAttribute('aria-describedby')).toContain(note.id);
    fireEvent.click(save());
    await actions.flush();
    expect(current().journal).toContainEqual(expect.objectContaining({ what: 'Врач', date: '2027-11-03', plan: 60 }));
  });

  it('it is the accounting month that counts: a month of the year keeps a date outside it in the feed', () => {
    openForm({ preset: { date: '2026-09-30' } });
    expect(screen.getByText(NOTE_BEFORE)).toBeTruthy(); // September: before «Дата остатков» too
    choose(field('Месяц учёта'), '2026-10');
    expect(screen.queryByText(NOTE_BEFORE)).toBeNull();
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it('a stored accounting month outside the year does not count (the engine goes by the date): the date decides', () => {
    openForm({ initial: { id: 'j-old', date: '2026-10-15', kind: 'expense', what: 'Старое', plan: 5, month: '2025-12' } });
    expect(screen.queryByText(NOTE)).toBeNull(); // counted in October: in «Лента»
    expect(screen.queryByText(NOTE_BEFORE)).toBeNull();
    type(field('Дата'), '2025-12-15');
    expect(screen.getByText(NOTE_BEFORE)).toBeTruthy();
  });

  it('the balances count a journal row by its accounting month (the engine’s rule): the month of «Дата остатков» counts whole', () => {
    const d = scenario();
    d.settings = { ...d.settings, balancesDate: '2026-09-15' };
    data.value = d;
    openForm({ preset: { date: '2026-09-03' } }); // before the balances date, but in its month
    expect(screen.getByText(NOTE)).toBeTruthy();
    type(field('Дата'), '2026-08-31');
    expect(screen.getByText(NOTE_BEFORE)).toBeTruthy();
  });
});

describe('editing a journal row', () => {
  it('shows the row and saves changes in place', async () => {
    const taxi = row(scenario().journal, 'j-taxi');
    openForm({ initial: taxi });
    expect(screen.getByRole('dialog', { name: 'Плановая запись' })).toBeTruthy();
    expect(field('Что').value).toBe('Такси');
    expect(field('План').value).toBe('100');
    expect(field('Факт').value).toBe('90');
    expect(field('Статус').value).toBe('paid');
    expect(field('Категория').value).toBe('Транспорт');
    const index = current().journal.findIndex((r) => r.id === 'j-taxi');
    type(field('Факт'), '85');
    fireEvent.click(save());
    expect(current().journal[index]).toEqual({ ...taxi, fact: 85 });
    expect(current().journal).toHaveLength(scenario().journal.length);
    await actions.flush();
    expect(await loadData()).toEqual(data.value);
  });

  it('clearing an optional amount removes it from the row', () => {
    const taxi = row(scenario().journal, 'j-taxi');
    openForm({ initial: taxi });
    type(field('Факт'), '');
    fireEvent.click(save());
    const { fact: _fact, ...rest } = taxi;
    expect(row(current().journal, 'j-taxi')).toEqual(rest);
  });

  it('an untouched status stays unset (the tracker’s empty status)', () => {
    const eda = row(scenario().journal, 'j-eda');
    openForm({ initial: eda });
    expect(field('Статус').value).toBe('planned');
    type(field('План'), '120');
    fireEvent.click(save());
    expect(row(current().journal, 'j-eda')).toEqual({ ...eda, plan: 120 });
  });

  describe('a fact without payment', () => {
    const HINT = 'Сумма факт учитывается как оплата. Очистите поле, если оплаты не было.';
    const taxi = () => row(scenario().journal, 'j-taxi');

    it('no hint while the row is «Оплачено»', () => {
      openForm({ initial: taxi() });
      expect(screen.queryByText(HINT)).toBeNull();
    });

    it('no hint for a row whose status was never set: with a fact it counts as paid (as the form shows it)', () => {
      const bare: JournalRow = { id: 'j-bare', date: '2026-10-16', kind: 'expense', what: 'Без статуса', plan: 50, fact: 45 };
      openForm({ initial: bare });
      expect(field('Статус').value).toBe('paid');
      expect(screen.queryByText(HINT)).toBeNull();
      // and the fact is still there to be cleared: then it is «Запланировано» with no fact, so still no hint
      type(field('Факт'), '');
      expect(field('Статус').value).toBe('planned');
      expect(screen.queryByText(HINT)).toBeNull();
    });

    it('a status-less row with a fact of 0 counts as paid too: no hint', () => {
      const bare: JournalRow = { id: 'j-bare0', date: '2026-10-16', kind: 'expense', what: 'Ноль', plan: 50, fact: 0 };
      openForm({ initial: bare });
      expect(field('Статус').value).toBe('paid');
      expect(screen.queryByText(HINT)).toBeNull();
    });

    it('a fact of 0 is a fact: with a status other than «Оплачено» the hint shows, and goes with the field’s text', () => {
      const zero: JournalRow = { id: 'j-zero', date: '2026-10-16', kind: 'expense', what: 'Ноль', plan: 50, fact: 0, status: 'planned' };
      openForm({ initial: zero });
      expect(field('Факт').value).toBe('0');
      expect(screen.getByText(HINT)).toBeTruthy();
      type(field('Факт'), '');
      expect(screen.queryByText(HINT)).toBeNull();
      type(field('Факт'), '0');
      expect(screen.getByText(HINT)).toBeTruthy();
    });

    it('no hint when there is no fact, whatever the status', () => {
      openForm({ initial: row(scenario().journal, 'j-eda') });
      choose(field('Статус'), 'postponed');
      expect(screen.queryByText(HINT)).toBeNull();
    });

    it('a status changed away from «Оплачено» while «Факт» holds a value shows the hint; clearing the fact removes it', () => {
      openForm({ initial: taxi() });
      choose(field('Статус'), 'planned');
      expect(screen.getByText(HINT)).toBeTruthy();
      type(field('Факт'), '');
      expect(screen.queryByText(HINT)).toBeNull();
    });

    it('the hint sits under «Факт» (the kit field hint, describing the input), before «Статус»', () => {
      openForm({ initial: taxi() });
      choose(field('Статус'), 'postponed');
      const hint = screen.getByText(HINT);
      const fact = field('Факт').closest('.field');
      const status = field('Статус').closest('.field');
      expect(hint.closest('.field')).toBe(fact);
      expect(fact?.nextElementSibling).toBe(status);
      expect(field('Факт').getAttribute('aria-describedby')).toBe(hint.id);
    });

    it('back to «Оплачено» hides the hint', () => {
      openForm({ initial: taxi() });
      choose(field('Статус'), 'planned');
      choose(field('Статус'), 'paid');
      expect(screen.queryByText(HINT)).toBeNull();
    });

    it('un-paying through the form: status «Запланировано» and an empty fact save as a planned row', async () => {
      const t = taxi();
      openForm({ initial: t });
      const before = current();
      choose(field('Статус'), 'planned');
      type(field('Факт'), '');
      fireEvent.click(save());
      const { fact: _fact, ...rest } = t;
      expect(row(current().journal, 'j-taxi')).toStrictEqual({ ...rest, status: 'planned' });
      expect(toastText()).toBe('Сохранено');
      await actions.flush();
      expect(await loadData()).toEqual(data.value);
      fireEvent.click(button('Отменить'));
      expect(current()).toBe(before);
    });

    it('a fact left in place while the status is «Запланировано» is saved as entered (it counts as paid)', () => {
      openForm({ initial: taxi() });
      choose(field('Статус'), 'planned');
      fireEvent.click(save());
      expect(row(current().journal, 'j-taxi')).toMatchObject({ status: 'planned', fact: 90 });
    });
  });

  it('a planned refund: a negative plan is accepted, saved as typed and shown again as it is', () => {
    openForm();
    type(field('Что'), 'Возврат за билет');
    type(field('Дата'), '2026-10-12');
    type(field('План'), '-45,5');
    expect(field('План').getAttribute('aria-invalid')).not.toBe('true');
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    expect(current().journal.at(-1)).toMatchObject({ what: 'Возврат за билет', plan: -45.5 });
    expect(toastText()).toBe('Сохранено');
  });

  it('a refund un-paid with «Снять оплату» (plan −20, «Запланировано») opens in the form without an error and can be saved', () => {
    openForm({ initial: { id: 'j-vozvrat', date: '2026-10-10', kind: 'expense', what: 'Возврат', plan: -20, status: 'planned' } });
    expect(field('План').value).toBe('-20');
    expect(field('План').getAttribute('aria-invalid')).not.toBe('true');
    expect(screen.queryByText('Проверьте сумму')).toBeNull();
    expect(save().disabled).toBe(false);
    type(field('Что'), 'Возврат продуктов');
    fireEvent.click(save());
    expect(row(current().journal, 'j-vozvrat')).toMatchObject({ what: 'Возврат продуктов', plan: -20, status: 'planned' });
  });

  it('a plan with letters is still refused, and a minus alone is not an amount', () => {
    openForm();
    type(field('Что'), 'Врач');
    type(field('План'), '-abc');
    expect(save().disabled).toBe(true);
    type(field('План'), '-');
    expect(save().disabled).toBe(true);
    type(field('План'), '-5');
    expect(save().disabled).toBe(false);
  });

  it('a refund (negative fact) saves as it is', () => {
    const refund = row(scenario().journal, 'j-vozvrat');
    openForm({ initial: refund });
    expect(field('Факт').value).toBe('-20');
    fireEvent.click(save());
    expect(row(current().journal, 'j-vozvrat')).toEqual(refund);
  });

  it('keeps a category, priority or month that are not in the lists', () => {
    const odd: JournalRow = {
      id: 'j-odd', date: '2026-10-11', kind: 'expense', category: 'Старое', what: 'Старая запись', plan: 5,
      priority: 'Срочно', month: '2025-01',
    };
    data.value = { ...current(), journal: [...current().journal, odd] };
    openForm({ initial: odd });
    expect(field('Категория').value).toBe('Старое');
    expect(field('Приоритет').value).toBe('Срочно');
    expect(field('Месяц учёта').value).toBe('2025-01');
    fireEvent.click(save());
    expect(row(current().journal, 'j-odd')).toEqual(odd);
  });

  it('«Удалить» asks, then removes the row with undo', async () => {
    const eda = row(scenario().journal, 'j-eda');
    openForm({ initial: eda });
    const before = current();
    fireEvent.click(button('Удалить'));
    fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Удалить запись?' })).getByRole('button', { name: 'Удалить' }));
    expect(current().journal.map((r) => r.id)).not.toContain('j-eda');
    expect(toastText()).toBe('Запись удалена');
    await waitFor(() => expect(openSheetKind()).toBeNull());
    fireEvent.click(button('Отменить'));
    expect(current()).toBe(before);
  });

  it('a new row has no «Удалить»', () => {
    openForm();
    expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull();
  });
});
