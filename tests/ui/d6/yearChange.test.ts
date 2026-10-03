import { describe, expect, it } from 'vitest';
import { warnings } from '../../../src/engine';
import type { Data } from '../../../src/engine';
import { outOfYear, outOfYearNote, yearChangeNote } from '../../../src/ui/pages/yearChange';
import { scenario } from '../../engine/scenario';

const TODAY = '2026-12-15';
const withStart = (d: Data, accountingStart: string): Data => ({ ...d, settings: { ...d.settings, accountingStart } });

describe('outOfYear', () => {
  it('counts the recurring marks, journal rows (by «Месяц учёта») and operations outside a new accounting year', () => {
    // October → December: October and November fall out
    expect(outOfYear(scenario(), '2026-12')).toEqual({ marks: 4, journal: 10, operations: 6, monthLimits: 0 });
    // as the engine counts them once the year is changed
    const moved = withStart(scenario(), '2026-12');
    expect(outOfYear(scenario(), '2026-12').journal + outOfYear(scenario(), '2026-12').operations).toBe(warnings(moved).outOfYear);
    // the year as it is: only the September journal row lies outside
    expect(outOfYear(scenario(), '2026-10')).toEqual({ marks: 0, journal: 1, operations: 0, monthLimits: 0 });
  });

  it('a journal row counted in a chosen month follows that month only while it is inside the year', () => {
    const d = scenario();
    d.journal.push({ id: 'j-m', date: '2026-10-30', kind: 'income', what: 'ЗП', plan: 400, status: 'paid', month: '2026-11' });
    // year from November: the row counts in November (inside)
    expect(outOfYear(d, '2026-11').journal).toBe(outOfYear(scenario(), '2026-11').journal);
    // year from December: November is outside, and so is the row's date
    expect(outOfYear(d, '2026-12').journal).toBe(outOfYear(scenario(), '2026-12').journal + 1);
  });
});

describe('outOfYear — month limits', () => {
  /** Month limits of two categories: Nov 2026, Dec 2026, Jan 2027 and Oct 2027. */
  function withLimits(): Data {
    const d = scenario();
    d.categories.expense[0] = { name: d.categories.expense[0]!.name, monthLimits: { '2026-11': 10, '2027-10': 20 } };
    d.categories.expense[1] = { name: d.categories.expense[1]!.name, limit: 5, monthLimits: { '2026-12': 30, '2027-01': 40 } };
    return d;
  }

  it('counts the month limits that fall outside the accounting year of the chosen start', () => {
    expect(outOfYear(withLimits(), '2026-10').monthLimits).toBe(1); // Oct 2026 – Sep 2027: only 2027-10
    expect(outOfYear(withLimits(), '2026-12').monthLimits).toBe(1); // Dec 2026 – Nov 2027: only 2026-11
    expect(outOfYear(withLimits(), '2027-01').monthLimits).toBe(2); // Jan – Dec 2027: 2026-11 and 2026-12
    expect(outOfYear(scenario(), '2026-12').monthLimits).toBe(0);
  });
});

describe('yearChangeNote', () => {
  it('names what falls out, what that means, and that the balances change', () => {
    expect(yearChangeNote(scenario(), '2026-12', TODAY)).toBe(
      'Вне учётного года: 4 отметки в постоянных, 10 плановых записей, 6 операций — их не будет в ленте и отчётах, ' +
        'а отметки не попадут и в остатки. Остатки счетов изменятся.',
    );
  });

  it('only marks, only rows, or nothing at all', () => {
    const marksOnly = scenario();
    marksOnly.journal = [];
    marksOnly.operations = [];
    expect(yearChangeNote(marksOnly, '2026-12', TODAY)).toBe(
      'Вне учётного года: 4 отметки в постоянных — они не попадут ни в отчёты, ни в остатки. Остатки счетов изменятся.',
    );
    const rowsOnly = scenario();
    rowsOnly.recurring = [];
    rowsOnly.purchases = [];
    rowsOnly.credit.auto = false;
    expect(yearChangeNote(rowsOnly, '2026-12', TODAY)).toBe(
      'Вне учётного года: 10 плановых записей, 6 операций — их не будет в ленте и отчётах.',
    );
    const empty = { ...scenario(), journal: [], operations: [], recurring: [], purchases: [] };
    expect(yearChangeNote(empty, '2026-12', TODAY)).toBe('Все отметки, плановые записи и операции останутся в учётном году.');
  });
});

describe('yearChangeNote — month limits', () => {
  const LIMITS = 'Лимиты по месяцам вне учётного года: 2 — они останутся, убрать их можно в «Категории и лимиты».';
  function withLimits(): Data {
    const d = scenario();
    d.categories.expense[1] = { name: d.categories.expense[1]!.name, monthLimits: { '2026-11': 10, '2026-12': 30, '2027-10': 20 } };
    return d;
  }

  it('names them next to the rest', () => {
    const d = withLimits();
    expect(yearChangeNote(d, '2027-01', TODAY)).toContain(LIMITS);
    expect(yearChangeNote(d, '2026-12', TODAY)).toContain('Лимиты по месяцам вне учётного года: 1 — ');
    // the rest of the note stays as it is
    expect(yearChangeNote(d, '2026-12', TODAY)).toContain('Вне учётного года: 4 отметки в постоянных, 10 плановых записей, 6 операций');
  });

  it('with nothing else outside, the note says the rest stays and still names the limits', () => {
    const d = { ...withLimits(), journal: [], operations: [], recurring: [], purchases: [] };
    expect(yearChangeNote(d, '2027-01', TODAY)).toBe(
      `Все отметки, плановые записи и операции останутся в учётном году. Лимиты по месяцам вне учётного года: 2 — они останутся, убрать их можно в «Категории и лимиты».`,
    );
  });

  it('no month limits outside: the note is the same as before', () => {
    const d = scenario();
    d.categories.expense[1] = { name: d.categories.expense[1]!.name, monthLimits: { '2026-12': 30 } };
    expect(yearChangeNote(d, '2026-12', TODAY)).toBe(yearChangeNote(scenario(), '2026-12', TODAY));
  });
});

describe('outOfYearNote', () => {
  it('the rows «Сегодня» counts outside the year as they are now (journal rows and operations), or nothing', () => {
    const inside = scenario();
    inside.journal = inside.journal.filter((r) => r.id !== 'j-sentyabr');
    expect(outOfYearNote(inside)).toBeUndefined();
    const moved = withStart(inside, '2026-12'); // October and November fall out: all from «Дата остатков» on
    expect(outOfYearNote(moved)).toBe(
      'Вне учётного года: 9 плановых записей, 6 операций. Такие записи учтены в остатках, но не попадают в ленту и отчёты. ' +
        'Чтобы увидеть их там, выберите учётный год, в который они входят.',
    );
  });

  it('rows before «Дата остатков» are in no balance either (journal rows by accounting month, operations by date)', () => {
    // the scenario's one row outside the year is in September; the balances start on 1 October
    expect(outOfYearNote(scenario())).toBe(
      'Вне учётного года: 1 плановая запись. Такие записи не попадают ни в остатки (они раньше даты остатков), ни в ленту и отчёты. ' +
        'Чтобы увидеть их в ленте и отчётах, выберите учётный год, в который они входят.',
    );
    const some = withStart(scenario(), '2026-12'); // September's row (before) + October and November's (from it on)
    expect(outOfYearNote(some)).toBe(
      'Вне учётного года: 10 плановых записей, 6 операций. Такие записи не попадают в ленту и отчёты, а в остатках учтены только ' +
        'те, что не раньше даты остатков (15 из 16). Чтобы увидеть их в ленте и отчётах, выберите учётный год, в который они входят.',
    );
    const sameMonth = scenario();
    sameMonth.settings = { ...sameMonth.settings, balancesDate: '2026-09-20' }; // the row (5 September) counts by its month
    expect(outOfYearNote(sameMonth)).toMatch(/Такие записи учтены в остатках/);
  });
});
