import { describe, expect, it } from 'vitest';
import { monthItems } from '../../src/engine/feed';
import type { FeedItem } from '../../src/engine/feed';
import { ACC, row, scenario, zpNovember } from './scenario';

/** source:id, date, plan, fact, status, duplicate — enough to read the feed at a glance. */
type Line = [string, string | undefined, number, number, string, string | null];
const lines = (items: FeedItem[]): Line[] =>
  items.map((i) => [`${i.source}:${i.id}`, i.date, i.plan, i.fact, i.status, i.duplicate ?? null]);

describe('monthItems — scenario October', () => {
  const items = monthItems(scenario(), '2026-10');

  it('lists the 6 operations, the 8 October journal rows and the 2 marked recurring payments, by date', () => {
    expect(lines(items)).toEqual<Line[]>([
      ['journal:j-zp', '2026-10-01', 3000, 3000, 'paid', null],
      ['journal:j-eda', '2026-10-05', 100, 0, 'planned', null],
      ['recurring:r-arenda', '2026-10-05', 900, 900, 'paid', null],
      ['operation:o-kafe', '2026-10-06', 0, 100, 'paid', 'journal'],
      ['journal:j-kafe', '2026-10-06', 100, 100, 'paid', null],
      ['journal:j-taxi', '2026-10-07', 100, 90, 'paid', null],
      ['journal:j-otmena', '2026-10-08', 0, 0, 'cancelled', null],
      ['journal:j-shtraf', '2026-10-09', 0, 15, 'cancelled', null],
      ['journal:j-vozvrat', '2026-10-10', -20, -20, 'paid', null],
      ['operation:o-magazin', '2026-10-12', 0, 30, 'paid', null],
      ['operation:o-snyatie', '2026-10-13', 0, 100, 'paid', null],
      ['operation:o-bilet', '2026-10-14', 0, 20, 'paid', null],
      ['operation:o-pogashenie', '2026-10-20', 0, 30, 'paid', null],
      ['journal:j-arenda', '2026-10-20', 0, 0, 'planned', 'recurring'],
      ['recurring:r-bonus', '2026-10-20', 200, 200, 'paid', null],
      ['operation:o-keshbek', '2026-10-21', 0, 5, 'paid', null],
    ]);
  });

  it('leaves out «Страховка» and «Подписка» (not due, not marked) and rows of other months', () => {
    const ids = items.map((i) => i.id);
    expect(ids).not.toContain('r-strahovka');
    expect(ids).not.toContain('r-podpiska');
    expect(ids).not.toContain('j-noyabr');
    expect(ids).not.toContain('j-sentyabr');
    expect(ids).not.toContain('p-noutbuk');
  });

  it('carries the operation fields, transfers with both accounts', () => {
    expect(items.find((i) => i.id === 'o-snyatie')).toEqual({
      source: 'operation', id: 'o-snyatie', ym: '2026-10', date: '2026-10-13', kind: 'transfer',
      what: 'Снятие', plan: 0, fact: 100, status: 'paid', account: ACC.card, toAccount: ACC.cash,
    });
    expect(items.find((i) => i.id === 'o-magazin')).toEqual({
      source: 'operation', id: 'o-magazin', ym: '2026-10', date: '2026-10-12', kind: 'expense', category: 'Продукты',
      what: 'Магазин', plan: 0, fact: 30, status: 'paid', account: ACC.credit,
    });
  });

  it('carries the journal fields and the possible duplicate', () => {
    expect(items.find((i) => i.id === 'j-arenda')).toEqual({
      source: 'journal', id: 'j-arenda', ym: '2026-10', date: '2026-10-20', kind: 'expense', category: 'Жильё',
      what: 'Аренда', plan: 0, fact: 0, status: 'planned', account: ACC.card, duplicate: 'recurring',
    });
    expect(items.find((i) => i.id === 'j-zp')).toEqual({
      source: 'journal', id: 'j-zp', ym: '2026-10', date: '2026-10-01', kind: 'income', category: 'Зарплата',
      what: 'ЗП', plan: 3000, fact: 3000, status: 'paid', account: ACC.card,
    });
  });

  it('carries the recurring fields for the month', () => {
    expect(items.find((i) => i.id === 'r-arenda')).toEqual({
      source: 'recurring', id: 'r-arenda', ym: '2026-10', date: '2026-10-05', kind: 'expense', category: 'Жильё',
      what: 'Аренда', plan: 900, fact: 900, status: 'paid', account: ACC.card,
    });
    expect(items.find((i) => i.id === 'r-bonus')).toMatchObject({ kind: 'income', what: 'ЗП бонус', fact: 200, status: 'paid' });
  });

  it('leaves out absent optional fields instead of setting them to undefined', () => {
    const snyatie = items.find((i) => i.id === 'o-snyatie');
    expect(snyatie && 'category' in snyatie).toBe(false);
    expect(snyatie && 'duplicate' in snyatie).toBe(false);
  });
});

describe('monthItems — scenario November', () => {
  const items = monthItems(scenario(), '2026-11');

  it('lists «Аренда» (950 of 900), «Подписка» (paid 10), journal «Ноябрь», «Страховка» (planned 30), «ЗП бонус» (planned)', () => {
    expect(lines(items)).toEqual<Line[]>([
      ['recurring:r-arenda', '2026-11-05', 900, 950, 'paid', null],
      ['recurring:r-podpiska', '2026-11-10', 10, 10, 'paid', null],
      ['journal:j-noyabr', '2026-11-15', 50, 50, 'paid', null],
      ['recurring:r-strahovka', '2026-11-15', 30, 0, 'planned', null],
      ['recurring:r-bonus', '2026-11-20', 200, 0, 'planned', null],
    ]);
  });
});

describe('monthItems — scenario December', () => {
  const items = monthItems(scenario(), '2026-12');

  it('lists the purchase «Ноутбук» after the recurring payment of the same day', () => {
    expect(lines(items)).toEqual<Line[]>([
      ['recurring:r-arenda', '2026-12-05', 900, 0, 'planned', null],
      ['recurring:r-podpiska', '2026-12-10', 10, 0, 'planned', null],
      ['purchase:p-noutbuk', '2026-12-10', 500, 480, 'paid', null],
      ['recurring:r-bonus', '2026-12-20', 200, 0, 'planned', null],
    ]);
  });

  it('carries the purchase fields', () => {
    expect(items.find((i) => i.id === 'p-noutbuk')).toEqual({
      source: 'purchase', id: 'p-noutbuk', ym: '2026-12', date: '2026-12-10', kind: 'expense', category: 'Техника',
      what: 'Ноутбук', plan: 500, fact: 480, status: 'paid', account: ACC.card,
    });
  });
});

describe('monthItems — rules', () => {
  it('puts a journal row into its accounting month, keeping its own date', () => {
    const data = scenario();
    data.journal.push(zpNovember);
    expect(monthItems(data, '2026-10').map((i) => i.id)).not.toContain('j-zp-nov');
    expect(monthItems(data, '2026-11').find((i) => i.id === 'j-zp-nov')).toMatchObject({
      ym: '2026-11', date: '2026-10-30', plan: 400, fact: 400, status: 'paid',
    });
  });

  it('shows the journal status, or paid when a fact is entered, or planned', () => {
    const data = scenario();
    data.journal = [
      { id: 'a', date: '2026-10-02', kind: 'expense', what: 'С фактом', fact: 40 },
      { id: 'b', date: '2026-10-02', kind: 'expense', what: 'Без факта', plan: 40 },
      { id: 'c', date: '2026-10-02', kind: 'expense', what: 'Перенесён', plan: 40, status: 'postponed' },
    ];
    const status = Object.fromEntries(monthItems(data, '2026-10').filter((i) => i.source === 'journal').map((i) => [i.id, i.status]));
    expect(status).toEqual({ a: 'paid', b: 'planned', c: 'postponed' });
  });

  it('shows a recurring payment marked in a month when it is not due, with plan 0', () => {
    const data = scenario();
    row(data.recurring, 'r-strahovka').marks['2026-12'] = '✓';
    expect(monthItems(data, '2026-12').find((i) => i.id === 'r-strahovka')).toMatchObject({
      date: '2026-12-15', plan: 0, fact: 30, status: 'paid',
    });
  });

  it('treats a mark of 0 as paid', () => {
    const data = scenario();
    row(data.recurring, 'r-bonus').marks['2026-11'] = 0;
    expect(monthItems(data, '2026-11').find((i) => i.id === 'r-bonus')).toMatchObject({ plan: 200, fact: 0, status: 'paid' });
  });

  it('puts items without a date last', () => {
    const data = scenario();
    delete row(data.recurring, 'r-arenda').day;
    const items = monthItems(data, '2026-10');
    const last = items[items.length - 1];
    expect(last?.id).toBe('r-arenda');
    expect(last && 'date' in last).toBe(false);
  });

  it('shows a purchase not bought yet as planned, and a purchase without a date nowhere', () => {
    const data = scenario();
    data.purchases = [
      { id: 'p1', what: 'Стул', cost: 70, date: '2026-10-03', bought: false },
      { id: 'p2', what: 'Лампа', cost: 20, bought: false },
    ];
    const purchases = monthItems(data, '2026-10').filter((i) => i.source === 'purchase');
    expect(purchases).toEqual([
      { source: 'purchase', id: 'p1', ym: '2026-10', date: '2026-10-03', kind: 'expense', what: 'Стул', plan: 70, fact: 0, status: 'planned' },
    ]);
  });

  it('orders items of the same date and source by what', () => {
    const data = scenario();
    data.operations = [
      { id: 'x1', date: '2026-10-02', kind: 'expense', what: 'Яблоки', amount: 1 },
      { id: 'x2', date: '2026-10-02', kind: 'expense', what: 'аптека', amount: 1 },
      { id: 'x3', date: '2026-10-02', kind: 'expense', what: 'Булочная', amount: 1 },
    ];
    const ops = monthItems(data, '2026-10').filter((i) => i.source === 'operation');
    expect(ops.map((i) => i.what)).toEqual(['аптека', 'Булочная', 'Яблоки']);
  });

  it('shows only the due recurring payments in a month without rows of its own', () => {
    expect(monthItems(scenario(), '2027-10').filter((i) => i.source !== 'recurring')).toEqual([]);
    expect(monthItems(scenario(), '2026-09').map((i) => i.id)).toEqual(['j-sentyabr', 'r-bonus']);
  });

  it('does not change the data', () => {
    const data = scenario();
    const before = structuredClone(data);
    monthItems(data, '2026-10');
    expect(data).toEqual(before);
  });
});
