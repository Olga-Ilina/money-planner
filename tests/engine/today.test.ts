import { describe, expect, it } from 'vitest';
import { markPaid, upcoming } from '../../src/engine/today';
import { journalFact, purchaseFact, recurringFact } from '../../src/engine/rules';
import type { Data } from '../../src/engine/model';
import { ACC, row, scenario } from './scenario';

const brief = (data: Data, today: string, days?: number) =>
  upcoming(data, today, days).map((i) => [i.source, i.id, i.date, i.amount, i.kind, i.overdue]);

function withVacuum(): Data {
  const data = scenario();
  data.purchases.push({ id: 'p-pylesos', what: 'Пылесос', category: 'Техника', cost: 200, date: '2026-11-20', bought: false, account: ACC.card });
  return data;
}

describe('upcoming', () => {
  it('today 03.10, 7 days: only «Еда» 05.10', () => {
    // «Аренда» journal row has no amounts, recurring «Аренда» is marked for October,
    // «Сентябрь» 05.09 is outside the accounting year
    expect(brief(scenario(), '2026-10-03', 7)).toEqual([['journal', 'j-eda', '2026-10-05', 100, 'expense', false]]);
    expect(upcoming(scenario(), '2026-10-03')[0]?.what).toBe('Еда');
  });

  it('keeps overdue items whatever their age and adds due unmarked recurring payments', () => {
    expect(brief(scenario(), '2026-11-12', 7)).toEqual([
      ['journal', 'j-eda', '2026-10-05', 100, 'expense', true],
      ['recurring', 'r-strahovka', '2026-11-15', 30, 'expense', false],
    ]);
    expect(upcoming(scenario(), '2026-11-12')[1]?.ym).toBe('2026-11');
  });

  it('lists past income as not overdue', () => {
    expect(brief(scenario(), '2026-11-25', 7)).toEqual([
      ['journal', 'j-eda', '2026-10-05', 100, 'expense', true],
      ['recurring', 'r-strahovka', '2026-11-15', 30, 'expense', true],
      ['recurring', 'r-bonus', '2026-11-20', 200, 'income', false],
    ]);
  });

  it('includes a purchase that is not bought yet', () => {
    const items = brief(withVacuum(), '2026-11-15', 7);
    expect(items).toContainEqual(['purchase', 'p-pylesos', '2026-11-20', 200, 'expense', false]);
  });

  it('does not list recurring payments without a day', () => {
    const data = scenario();
    data.recurring.push({ id: 'r-x', what: 'Без дня', kind: 'expense', amount: 50, account: ACC.card, marks: {} });
    expect(upcoming(data, '2026-10-03').map((i) => i.id)).toEqual(['j-eda']);
  });
});

describe('markPaid', () => {
  it('journal: status paid, the plan becomes the fact', () => {
    const data = scenario();
    const next = markPaid(data, { source: 'journal', id: 'j-eda' });
    const r = row(next.journal, 'j-eda');
    expect(r.status).toBe('paid');
    expect(r.fact).toBeUndefined();
    expect(journalFact(r)).toBe(100);
  });

  it('journal: keeps a different fact, drops one equal to the plan', () => {
    const paid80 = row(markPaid(scenario(), { source: 'journal', id: 'j-eda' }, 80).journal, 'j-eda');
    expect([paid80.status, paid80.fact]).toEqual(['paid', 80]);
    const paid100 = row(markPaid(scenario(), { source: 'journal', id: 'j-eda' }, 100).journal, 'j-eda');
    expect(paid100.fact).toBeUndefined();
  });

  it('recurring: ✓ for the full amount, the number otherwise', () => {
    const tick = markPaid(scenario(), { source: 'recurring', id: 'r-strahovka', ym: '2026-11' });
    expect(row(tick.recurring, 'r-strahovka').marks).toEqual({ '2026-11': '✓' });
    const same = markPaid(scenario(), { source: 'recurring', id: 'r-strahovka', ym: '2026-11' }, 30);
    expect(row(same.recurring, 'r-strahovka').marks['2026-11']).toBe('✓');
    const other = markPaid(scenario(), { source: 'recurring', id: 'r-strahovka', ym: '2026-11' }, 35);
    expect(row(other.recurring, 'r-strahovka').marks['2026-11']).toBe(35);
    expect(recurringFact(row(other.recurring, 'r-strahovka'), '2026-11')).toBe(35);
  });

  it('purchase: bought, price only when it differs from the cost', () => {
    const bought = row(markPaid(withVacuum(), { source: 'purchase', id: 'p-pylesos' }).purchases, 'p-pylesos');
    expect([bought.bought, bought.price]).toEqual([true, undefined]);
    expect(purchaseFact(bought)).toBe(200);
    const cheaper = row(markPaid(withVacuum(), { source: 'purchase', id: 'p-pylesos' }, 190).purchases, 'p-pylesos');
    expect([cheaper.bought, cheaper.price]).toEqual([true, 190]);
    const exact = row(markPaid(withVacuum(), { source: 'purchase', id: 'p-pylesos' }, 200).purchases, 'p-pylesos');
    expect(exact.price).toBeUndefined();
  });

  it('does not change the data it was given', () => {
    const data = withVacuum();
    const before = structuredClone(data);
    markPaid(data, { source: 'journal', id: 'j-eda' }, 80);
    markPaid(data, { source: 'recurring', id: 'r-strahovka', ym: '2026-11' }, 35);
    markPaid(data, { source: 'purchase', id: 'p-pylesos' }, 190);
    expect(data).toEqual(before);
  });

  it('removes a paid item from the upcoming list', () => {
    const next = markPaid(scenario(), { source: 'journal', id: 'j-eda' });
    expect(upcoming(next, '2026-10-03')).toEqual([]);
  });

  it('fails loudly on an unknown row or a recurring payment without a month', () => {
    expect(() => markPaid(scenario(), { source: 'journal', id: 'nope' })).toThrow(/nope/);
    expect(() => markPaid(scenario(), { source: 'recurring', id: 'r-strahovka' })).toThrow(/month/);
  });
});
