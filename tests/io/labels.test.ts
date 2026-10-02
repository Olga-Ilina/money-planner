import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_TYPE_LABEL,
  CHECK,
  DUPLICATE_LABEL,
  JOURNAL_STATUS_LABEL,
  KIND_LABEL,
  PRIORITIES,
  SOURCE_LABEL,
  parseAccountType,
  parseKind,
  parseStatus,
} from '../../src/io/labels';

describe('labels', () => {
  it('uses the tracker check mark', () => {
    expect(CHECK).toBe('✓');
  });

  it('names every journal status', () => {
    expect(JOURNAL_STATUS_LABEL).toEqual({
      planned: 'Запланировано', paid: 'Оплачено', postponed: 'Перенесено', cancelled: 'Отменено',
    });
  });

  it('names every operation kind', () => {
    expect(KIND_LABEL).toEqual({ expense: 'Расход', income: 'Доход', transfer: 'Перевод' });
  });

  it('names every account type', () => {
    expect(ACCOUNT_TYPE_LABEL).toEqual({
      debit: 'Дебетовая', cash: 'Наличные', credit: 'Кредитная', savings: 'Сберегательная',
    });
  });

  it('names every source of the month feed', () => {
    expect(SOURCE_LABEL).toEqual({ operation: 'Операция', journal: 'Запланированные', recurring: 'Постоянный', purchase: 'Покупка' });
  });

  it('names what an item may duplicate', () => {
    expect(DUPLICATE_LABEL).toEqual({ journal: 'Запланированные', recurring: 'Постоянные', purchase: 'Покупки' });
  });

  it('lists the priorities in the tracker order', () => {
    expect(PRIORITIES).toEqual(['Обязательно', 'Желательно', 'Можно отложить']);
  });
});

describe('parseStatus', () => {
  it.each([
    ['Запланировано', 'planned'],
    ['Оплачено', 'paid'],
    ['Перенесено', 'postponed'],
    ['Отменено', 'cancelled'],
  ])('%s → %s', (text, status) => {
    expect(parseStatus(text)).toBe(status);
  });

  it('trims and ignores letter case', () => {
    expect(parseStatus('  оплачено ')).toBe('paid');
    expect(parseStatus('ОТМЕНЕНО')).toBe('cancelled');
    expect(parseStatus(' Перенесено ')).toBe('postponed');
  });

  it.each([undefined, '', '   ', 'Оплачен', 'paid'])('unknown text %j → undefined', (text) => {
    expect(parseStatus(text)).toBeUndefined();
  });
});

describe('parseKind', () => {
  it.each([
    ['Доход', 'income'],
    ['Расход', 'expense'],
    ['Перевод', 'transfer'],
    [' доход ', 'income'],
    ['РАСХОД', 'expense'],
  ])('%j → %s', (text, kind) => {
    expect(parseKind(text)).toBe(kind);
  });

  it.each([undefined, '', 'Приход', 'income'])('unknown text %j → undefined', (text) => {
    expect(parseKind(text)).toBeUndefined();
  });
});

describe('parseAccountType', () => {
  it.each([
    ['Дебетовая', 'debit'],
    ['Наличные', 'cash'],
    ['Кредитная', 'credit'],
    ['Сберегательная', 'savings'],
    ['  кредитная', 'credit'],
    ['НАЛИЧНЫЕ', 'cash'],
  ])('%j → %s', (text, type) => {
    expect(parseAccountType(text)).toBe(type);
  });

  it.each([undefined, '', 'Карта', 'debit'])('unknown text %j → undefined', (text) => {
    expect(parseAccountType(text)).toBeUndefined();
  });
});
