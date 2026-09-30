import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, emptyData, newId } from '../../src/engine/model';

describe('emptyData', () => {
  const data = emptyData('2026-09-30');

  it('starts accounting and forecast in the month of today', () => {
    expect(data.schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(1);
    expect(data.settings).toEqual({
      accountingStart: '2026-09',
      forecastStart: '2026-09',
      cushion: 0,
      balancesDate: '2026-09-01',
    });
  });

  it('has the tracker default categories in order', () => {
    expect(data.categories.expense.map((c) => c.name)).toEqual([
      'Жильё и коммуналка', 'Продукты', 'Кафе и доставка', 'Транспорт', 'Здоровье и аптека',
      'Красота и уход', 'Одежда и обувь', 'Дом и ремонт', 'Техника', 'Подписки и связь',
      'Образование', 'Развлечения', 'Подарки', 'Путешествия', 'Кредиты и долги', 'Прочее',
    ]);
    expect(data.categories.expense.every((c) => c.limit === undefined)).toBe(true);
    expect(data.categories.income.map((c) => c.name)).toEqual([
      'Зарплата', 'Аванс', 'Премия', 'Фриланс', 'Подработка', 'Проценты и инвестиции', 'Прочие поступления',
    ]);
  });

  it('has the three default accounts with zero start and distinct ids', () => {
    expect(data.accounts.map((a) => [a.name, a.type, a.start])).toEqual([
      ['Основная карта', 'debit', 0],
      ['Наличные', 'cash', 0],
      ['Кредитная карта', 'credit', 0],
    ]);
    expect(new Set(data.accounts.map((a) => a.id)).size).toBe(3);
  });

  it('pays the credit card automatically, statement on the 4th, debit on the 10th', () => {
    expect(data.credit).toEqual({ auto: true, closeDay: 4, payDay: 10 });
  });

  it('has no rows yet', () => {
    expect(data.operations).toEqual([]);
    expect(data.journal).toEqual([]);
    expect(data.recurring).toEqual([]);
    expect(data.purchases).toEqual([]);
    expect(data.debts).toEqual([]);
  });

  it('gives fresh account ids on every call', () => {
    const other = emptyData('2026-09-30');
    expect(other.accounts[0]?.id).not.toBe(data.accounts[0]?.id);
  });
});

describe('newId', () => {
  it('returns distinct UUIDs', () => {
    const a = newId();
    const b = newId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});
