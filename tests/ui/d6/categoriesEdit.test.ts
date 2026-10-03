import { describe, expect, it } from 'vitest';
import type { Data } from '../../../src/engine';
import {
  addCategory, categoryNameError, categoryUsage, clearOutOfYearMonthLimits, moveCategory, outOfYearMonths, removeCategory,
  renameCategory, setLimit, setMonthLimit, usageText,
} from '../../../src/ui/pages/categoriesEdit';
import { scenario } from '../../engine/scenario';

const names = (d: Data, kind: 'expense' | 'income') => d.categories[kind].map((c) => c.name);

describe('categoryUsage', () => {
  it('counts every row that uses an expense category, by source', () => {
    const u = categoryUsage(scenario(), 'expense', 'Продукты');
    expect(u).toEqual({ operations: 2, journal: 5, recurring: 0, purchases: 0, total: 7 });
    expect(categoryUsage(scenario(), 'expense', 'Техника')).toEqual({ operations: 0, journal: 0, recurring: 0, purchases: 1, total: 1 });
    expect(categoryUsage(scenario(), 'expense', 'Подписки')).toMatchObject({ recurring: 2, total: 2 });
  });

  it('counts income rows for an income category', () => {
    expect(categoryUsage(scenario(), 'income', 'Премия')).toEqual({ operations: 1, journal: 0, recurring: 1, purchases: 0, total: 2 });
  });

  it('a name in both lists counts only rows of its own kind', () => {
    const d = scenario();
    d.categories.income.push({ name: 'Продукты' });
    d.operations.push({ id: 'o-inc', date: '2026-10-15', kind: 'income', category: 'Продукты', what: 'Возврат', amount: 5 });
    expect(categoryUsage(d, 'expense', 'Продукты').total).toBe(7);
    expect(categoryUsage(d, 'income', 'Продукты')).toMatchObject({ operations: 1, total: 1 });
  });

  it('a name only in one list counts rows of any kind (nothing may keep a deleted name)', () => {
    const d = scenario();
    d.operations.push({ id: 'o-stray', date: '2026-10-15', kind: 'income', category: 'Продукты', what: 'Возврат', amount: 5 });
    expect(categoryUsage(d, 'expense', 'Продукты').operations).toBe(3);
  });
});

describe('usageText', () => {
  it('names each kind of row with Russian plurals', () => {
    expect(usageText({ operations: 2, journal: 5, recurring: 0, purchases: 0, total: 7 })).toBe('2 операции, 5 плановых записей');
    expect(usageText({ operations: 1, journal: 1, recurring: 1, purchases: 1, total: 4 })).toBe(
      '1 операция, 1 плановая запись, 1 постоянный платёж, 1 покупка',
    );
    expect(usageText({ operations: 11, journal: 21, recurring: 3, purchases: 5, total: 40 })).toBe(
      '11 операций, 21 плановая запись, 3 постоянных платежа, 5 покупок',
    );
  });
});

describe('renameCategory', () => {
  it('renames the category and every row that uses it, keeping the limit and the order', () => {
    const d = scenario();
    d.categories.expense[1] = { name: 'Продукты', limit: 300 };
    const before = structuredClone(d);
    const next = renameCategory(d, 'expense', 'Продукты', 'Еда');
    expect(d).toEqual(before); // never in place
    expect(next.categories.expense[1]).toEqual({ name: 'Еда', limit: 300 });
    expect(names(next, 'expense')).toEqual(['Жильё', 'Еда', 'Транспорт', 'Подписки', 'Техника']);
    expect(next.journal.filter((r) => r.category === 'Еда')).toHaveLength(5);
    expect(next.operations.filter((o) => o.category === 'Еда')).toHaveLength(2);
    expect(JSON.stringify(next)).not.toContain('"Продукты"');
    expect(categoryUsage(next, 'expense', 'Еда').total).toBe(7);
  });

  it('renames recurring payments and purchases too', () => {
    const next = renameCategory(renameCategory(scenario(), 'expense', 'Подписки', 'Связь'), 'expense', 'Техника', 'Гаджеты');
    expect(next.recurring.filter((r) => r.category === 'Связь').map((r) => r.id)).toEqual(['r-podpiska', 'r-strahovka']);
    expect(next.purchases[0]?.category).toBe('Гаджеты');
  });

  it('with the same name in both lists, only rows of the renamed kind change', () => {
    const d = scenario();
    d.categories.income.push({ name: 'Продукты' });
    d.operations.push({ id: 'o-inc', date: '2026-10-15', kind: 'income', category: 'Продукты', what: 'Возврат', amount: 5 });
    const next = renameCategory(d, 'expense', 'Продукты', 'Еда');
    expect(next.operations.find((o) => o.id === 'o-inc')?.category).toBe('Продукты');
    expect(names(next, 'income')).toContain('Продукты');
  });

  it('an income category renames income rows', () => {
    const next = renameCategory(scenario(), 'income', 'Зарплата', 'Оклад');
    expect(next.journal.find((r) => r.id === 'j-zp')?.category).toBe('Оклад');
    expect(names(next, 'income')).toEqual(['Оклад', 'Премия']);
  });

  it('an operation named after its category (the form’s empty «Что») is renamed along with it', () => {
    const d = scenario();
    d.operations.push(
      { id: 'o-auto', date: '2026-10-15', kind: 'expense', category: 'Продукты', what: 'Продукты', amount: 12, account: 'acc-card' },
      { id: 'o-other', date: '2026-10-16', kind: 'expense', category: 'Транспорт', what: 'Продукты', amount: 3, account: 'acc-card' },
    );
    d.journal.push({ id: 'j-auto', date: '2026-10-15', kind: 'expense', category: 'Продукты', what: 'Продукты', plan: 5 });
    const next = renameCategory(d, 'expense', 'Продукты', 'Еда');
    expect(next.operations.find((o) => o.id === 'o-auto')).toMatchObject({ category: 'Еда', what: 'Еда' });
    // only where the category was renamed too; only operations
    expect(next.operations.find((o) => o.id === 'o-other')).toMatchObject({ category: 'Транспорт', what: 'Продукты' });
    expect(next.journal.find((r) => r.id === 'j-auto')).toMatchObject({ category: 'Еда', what: 'Продукты' });
    // an operation with its own name keeps it
    expect(next.operations.find((o) => o.id === 'o-kafe')).toMatchObject({ category: 'Еда', what: 'Кафе' });
  });

  it('with the same name in both lists, an auto-named operation of the other kind keeps its name', () => {
    const d = scenario();
    d.categories.income.push({ name: 'Продукты' });
    d.operations.push({ id: 'o-inc', date: '2026-10-15', kind: 'income', category: 'Продукты', what: 'Продукты', amount: 5 });
    expect(renameCategory(d, 'expense', 'Продукты', 'Еда').operations.find((o) => o.id === 'o-inc')).toMatchObject({
      category: 'Продукты', what: 'Продукты',
    });
  });

  it('trims the new name', () => {
    expect(names(renameCategory(scenario(), 'expense', 'Жильё', '  Квартира '), 'expense')[0]).toBe('Квартира');
  });

  it('refuses a blank name, a name already in the list, or one from the other list', () => {
    const d = scenario();
    expect(() => renameCategory(d, 'expense', 'Продукты', '   ')).toThrow();
    expect(() => renameCategory(d, 'expense', 'Продукты', ' жильё ')).toThrow();
    expect(() => renameCategory(d, 'expense', 'Продукты', 'Зарплата')).toThrow();
    expect(() => renameCategory(d, 'income', 'Премия', 'транспорт')).toThrow();
  });

  it('a change of letter case only renames the category and its rows', () => {
    const next = renameCategory(scenario(), 'expense', 'Продукты', 'продукты');
    expect(names(next, 'expense')[1]).toBe('продукты');
    expect(categoryUsage(next, 'expense', 'продукты').total).toBe(7);
    expect(JSON.stringify(next)).not.toContain('"Продукты"');
  });

  it('a name kept as it is (both lists may share it, as imported) is no change', () => {
    const d = scenario();
    d.categories.income.push({ name: 'Продукты' });
    expect(renameCategory(d, 'expense', 'Продукты', ' Продукты ')).toBe(d);
  });
});

describe('categoryNameError', () => {
  it('requires a name that is not already in the same list (case and spaces ignored)', () => {
    const d = scenario();
    expect(categoryNameError(d, 'expense', undefined)).toBe('Введите название');
    expect(categoryNameError(d, 'expense', '   ')).toBe('Введите название');
    expect(categoryNameError(d, 'expense', ' продукты ')).toBe('Такая категория уже есть');
    expect(categoryNameError(d, 'expense', 'Продукты', 'Продукты')).toBeUndefined(); // its own name
    expect(categoryNameError(d, 'expense', 'продукты', 'Продукты')).toBeUndefined(); // its own, other letter case
    expect(categoryNameError(d, 'expense', 'Одежда')).toBeUndefined();
  });

  it('a name from the other list is refused too, for a new category and for a rename', () => {
    const d = scenario();
    expect(categoryNameError(d, 'expense', ' зарплата ')).toBe('Такая категория уже есть среди доходов');
    expect(categoryNameError(d, 'expense', 'Зарплата', 'Продукты')).toBe('Такая категория уже есть среди доходов');
    expect(categoryNameError(d, 'income', 'Транспорт', 'Премия')).toBe('Такая категория уже есть среди расходов');
    // a name both lists already share (an imported tracker) stays usable as it is
    d.categories.income.push({ name: 'Продукты' });
    expect(categoryNameError(d, 'expense', 'Продукты', 'Продукты')).toBeUndefined();
    expect(() => addCategory(scenario(), 'expense', 'Премия')).toThrow();
    expect(() => addCategory(scenario(), 'income', ' ')).toThrow();
  });
});

describe('addCategory / setLimit / moveCategory', () => {
  it('adds at the end, with a limit for expenses when given', () => {
    const d = addCategory(addCategory(scenario(), 'expense', ' Одежда ', 50), 'income', 'Фриланс');
    expect(d.categories.expense.at(-1)).toEqual({ name: 'Одежда', limit: 50 });
    expect(d.categories.income.at(-1)).toEqual({ name: 'Фриланс' });
    expect(addCategory(scenario(), 'expense', 'Кино').categories.expense.at(-1)).toEqual({ name: 'Кино' });
  });

  it('sets and clears a limit (a cleared limit is absent, 0 is a limit)', () => {
    const d = setLimit(scenario(), 'Продукты', 300);
    expect(d.categories.expense[1]).toEqual({ name: 'Продукты', limit: 300 });
    expect(setLimit(d, 'Продукты', 0).categories.expense[1]).toEqual({ name: 'Продукты', limit: 0 });
    const cleared = setLimit(d, 'Продукты', undefined).categories.expense[1];
    expect(cleared).toEqual({ name: 'Продукты' });
    expect(cleared && 'limit' in cleared).toBe(false);
  });

  it('the usual limit and the month limits are set apart: neither clears the other', () => {
    let d = setMonthLimit(scenario(), 'Продукты', '2026-12', 400);
    d = setMonthLimit(d, 'Продукты', '2026-11', 0); // 0 is a month limit
    expect(d.categories.expense[1]).toEqual({ name: 'Продукты', monthLimits: { '2026-11': 0, '2026-12': 400 } });
    expect(Object.keys(d.categories.expense[1]?.monthLimits ?? {})).toEqual(['2026-11', '2026-12']); // by month
    d = setLimit(d, 'Продукты', 300);
    expect(d.categories.expense[1]).toEqual({ name: 'Продукты', limit: 300, monthLimits: { '2026-11': 0, '2026-12': 400 } });
    d = setLimit(setMonthLimit(d, 'Продукты', '2026-11', undefined), 'Продукты', undefined);
    expect(d.categories.expense[1]).toEqual({ name: 'Продукты', monthLimits: { '2026-12': 400 } });
    const cleared = setMonthLimit(d, 'Продукты', '2026-12', undefined).categories.expense[1];
    expect(cleared).toEqual({ name: 'Продукты' });
    expect(cleared && 'monthLimits' in cleared).toBe(false);
  });

  it('month limits outside the accounting year (Oct 2026 – Sep 2027): listed, and cleared alone', () => {
    const d = scenario();
    d.categories.expense[1] = { name: 'Продукты', limit: 300, monthLimits: { '2025-12': 70, '2026-12': 400, '2027-09': 5, '2027-10': 60 } };
    expect(outOfYearMonths(d.categories.expense[1]!, d.settings)).toEqual(['2025-12', '2027-10']);
    expect(outOfYearMonths(d.categories.expense[0]!, d.settings)).toEqual([]);
    const next = clearOutOfYearMonthLimits(d, 'Продукты');
    expect(next.categories.expense[1]).toEqual({ name: 'Продукты', limit: 300, monthLimits: { '2026-12': 400, '2027-09': 5 } });
    expect(next.categories.expense.filter((_, i) => i !== 1)).toEqual(d.categories.expense.filter((_, i) => i !== 1));
    expect(d.categories.expense[1]?.monthLimits).toEqual({ '2025-12': 70, '2026-12': 400, '2027-09': 5, '2027-10': 60 }); // not in place
  });

  it('clearing the only month limits drops `monthLimits`; with nothing outside, the same Data', () => {
    const d = scenario();
    d.categories.expense[1] = { name: 'Продукты', monthLimits: { '2025-12': 70 } };
    const next = clearOutOfYearMonthLimits(d, 'Продукты');
    expect(next.categories.expense[1]).toEqual({ name: 'Продукты' });
    expect('monthLimits' in next.categories.expense[1]!).toBe(false);
    expect(clearOutOfYearMonthLimits(scenario(), 'Продукты')).toEqual(scenario());
    const inside = setMonthLimit(scenario(), 'Продукты', '2026-12', 400);
    expect(clearOutOfYearMonthLimits(inside, 'Продукты')).toBe(inside);
  });

  it('a rename keeps the month limits', () => {
    const d = renameCategory(setMonthLimit(scenario(), 'Продукты', '2026-12', 400), 'expense', 'Продукты', 'Еда');
    expect(d.categories.expense[1]).toEqual({ name: 'Еда', monthLimits: { '2026-12': 400 } });
  });

  it('moves a category up or down; at the ends nothing changes', () => {
    expect(names(moveCategory(scenario(), 'expense', 1, -1), 'expense')).toEqual(['Продукты', 'Жильё', 'Транспорт', 'Подписки', 'Техника']);
    expect(names(moveCategory(scenario(), 'expense', 1, 1), 'expense')).toEqual(['Жильё', 'Транспорт', 'Продукты', 'Подписки', 'Техника']);
    const d = scenario();
    expect(moveCategory(d, 'expense', 0, -1)).toBe(d);
    expect(moveCategory(d, 'income', 1, 1)).toBe(d);
  });
});

describe('removeCategory', () => {
  it('removes an unused category', () => {
    const d = addCategory(scenario(), 'expense', 'Кино');
    expect(names(removeCategory(d, 'expense', 'Кино'), 'expense')).toEqual(names(scenario(), 'expense'));
  });

  it('refuses to leave rows pointing to a removed category', () => {
    expect(() => removeCategory(scenario(), 'expense', 'Продукты')).toThrow();
  });

  it('moves the rows to another category, in the same change', () => {
    const next = removeCategory(scenario(), 'expense', 'Продукты', 'Жильё');
    expect(names(next, 'expense')).toEqual(['Жильё', 'Транспорт', 'Подписки', 'Техника']);
    expect(categoryUsage(next, 'expense', 'Жильё').total).toBe(7 + 2);
    expect(JSON.stringify(next)).not.toContain('"Продукты"');
  });

  it('«Без категории» (null) clears the category of those rows', () => {
    const next = removeCategory(scenario(), 'expense', 'Техника', null);
    expect(next.purchases[0]).not.toHaveProperty('category');
    expect(next.purchases[0]?.what).toBe('Ноутбук');
  });

  it('refuses a target that is not a category of that list, or the removed one itself', () => {
    expect(() => removeCategory(scenario(), 'expense', 'Продукты', 'Зарплата')).toThrow();
    expect(() => removeCategory(scenario(), 'expense', 'Продукты', 'Продукты')).toThrow();
  });
});
