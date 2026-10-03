// Per-month limits (spec 2026-10-03-month-limits): a category's limit in a month is its value for that month when
// set, else the usual limit («Обычный лимит»).
import { describe, expect, it } from 'vitest';
import { limitFor, monthSummary } from '../../src/engine';
import { scenario } from './scenario';

describe('limitFor', () => {
  it('is the month value when set, else the usual limit', () => {
    const c = { name: 'Продукты', limit: 200, monthLimits: { '2026-11': 350, '2026-12': 0 } };
    expect(limitFor(c, '2026-10')).toBe(200);
    expect(limitFor(c, '2026-11')).toBe(350);
    expect(limitFor(c, '2026-12')).toBe(0); // 0 is a limit, not «empty»
  });

  it('a month value works without a usual limit; without either there is no limit', () => {
    const c = { name: 'Подарки', monthLimits: { '2026-12': 300 } };
    expect(limitFor(c, '2026-12')).toBe(300);
    expect(limitFor(c, '2026-11')).toBeUndefined();
    expect(limitFor({ name: 'Прочее' }, '2026-11')).toBeUndefined();
  });

  it('is keyed by the calendar month, not by its place in the accounting year', () => {
    const c = { name: 'Продукты', limit: 200, monthLimits: { '2027-11': 999 } };
    expect(limitFor(c, '2026-11')).toBe(200);
    expect(limitFor(c, '2027-11')).toBe(999);
  });
});

describe('monthSummary with month limits', () => {
  it('uses the month value in that month and the usual limit in others', () => {
    const data = scenario();
    data.categories.expense[1] = { name: 'Продукты', limit: 200, monthLimits: { '2026-10': 250 } }; // fact 210
    data.categories.expense[2] = { name: 'Транспорт', monthLimits: { '2026-10': 100 } }; // fact 125
    const oct = monthSummary(data, '2026-10');
    const food = oct.byCategory.find((c) => c.name === 'Продукты');
    expect([food?.limit, food?.left]).toEqual([250, 40]);
    expect(food?.share).toBeCloseTo(0.84, 10);
    const transport = oct.byCategory.find((c) => c.name === 'Транспорт');
    expect([transport?.limit, transport?.left]).toEqual([100, -25]);
    expect([oct.limitsTotal, oct.limitsLeft]).toEqual([350, 15]);

    const nov = monthSummary(data, '2026-11');
    expect(nov.byCategory.find((c) => c.name === 'Продукты')?.limit).toBe(200);
    expect(nov.byCategory.find((c) => c.name === 'Транспорт')?.limit).toBeUndefined();
  });
});
