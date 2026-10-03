import { describe, expect, it } from 'vitest';
import {
  accountingMonths,
  addDays,
  addMonths,
  clampDay,
  dateIn,
  daysFromTo,
  daysInMonth,
  forecastMonths,
  inAccountingYear,
  mondayOnOrBefore,
  monthDiff,
  monthEnd,
  monthLabel,
  monthStart,
  parseMonthLabel,
  ymOf,
} from '../../src/engine/dates';
import type { Settings } from '../../src/engine/model';

const settings = (accountingStart: string, forecastStart = accountingStart): Settings => ({
  accountingStart,
  forecastStart,
  cushion: 0,
  balancesDate: `${accountingStart}-01`,
});

describe('months', () => {
  it('takes the month of a date', () => {
    expect(ymOf('2026-10-05')).toBe('2026-10');
  });

  it('adds months across year boundaries in both directions', () => {
    expect(addMonths('2026-10', 0)).toBe('2026-10');
    expect(addMonths('2026-10', 3)).toBe('2027-01');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-10', -22)).toBe('2024-12');
    expect(addMonths('2026-10', 24)).toBe('2028-10');
  });

  it('counts months between two months (b - a)', () => {
    expect(monthDiff('2026-10', '2027-02')).toBe(4);
    expect(monthDiff('2026-11', '2026-10')).toBe(-1);
    expect(monthDiff('2026-10', '2026-10')).toBe(0);
  });

  it('knows month lengths including leap years', () => {
    expect(daysInMonth('2026-04')).toBe(30);
    expect(daysInMonth('2026-10')).toBe(31);
    expect(daysInMonth('2027-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
    expect(daysInMonth('2100-02')).toBe(28);
    expect(daysInMonth('2000-02')).toBe(29);
  });

  it('gives the first and last day of a month', () => {
    expect(monthStart('2026-10')).toBe('2026-10-01');
    expect(monthEnd('2026-10')).toBe('2026-10-31');
    expect(monthEnd('2027-02')).toBe('2027-02-28');
    expect(monthEnd('2028-02')).toBe('2028-02-29');
  });

  it('builds a date in a month with the day clamped to the month length', () => {
    expect(dateIn('2026-10', 5)).toBe('2026-10-05');
    expect(dateIn('2027-02', 31)).toBe('2027-02-28');
    expect(dateIn('2028-02', 31)).toBe('2028-02-29');
    expect(dateIn('2026-04', 31)).toBe('2026-04-30');
  });

  it('clamps credit-card days to 1..28', () => {
    expect(clampDay(0)).toBe(1);
    expect(clampDay(4)).toBe(4);
    expect(clampDay(28)).toBe(28);
    expect(clampDay(31)).toBe(28);
  });
});

describe('days', () => {
  it('adds days across month, year and leap-day boundaries', () => {
    expect(addDays('2026-10-05', 0)).toBe('2026-10-05');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(addDays('2026-10-01', -3)).toBe('2026-09-28');
    expect(addDays('2026-09-28', 84)).toBe('2026-12-21');
    expect(addDays('2026-01-01', 365)).toBe('2027-01-01');
  });

  it('finds the Monday on or before a date', () => {
    expect(mondayOnOrBefore('2026-10-01')).toBe('2026-09-28'); // Thursday
    expect(mondayOnOrBefore('2026-09-28')).toBe('2026-09-28'); // Monday itself
    expect(mondayOnOrBefore('2026-11-01')).toBe('2026-10-26'); // Sunday
    expect(mondayOnOrBefore('2027-01-01')).toBe('2026-12-28'); // Friday, across the year
  });
});

describe('accounting and forecast periods', () => {
  it('lists the 12 accounting months from the start month', () => {
    const months = accountingMonths(settings('2026-10'));
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2026-10');
    expect(months[2]).toBe('2026-12');
    expect(months[3]).toBe('2027-01');
    expect(months[11]).toBe('2027-09');
  });

  it('lists the 3 forecast months from the forecast start', () => {
    expect(forecastMonths(settings('2026-10', '2026-11'))).toEqual(['2026-11', '2026-12', '2027-01']);
  });

  it('tells whether a month belongs to the accounting year', () => {
    const s = settings('2026-10');
    expect(inAccountingYear('2026-10', s)).toBe(true);
    expect(inAccountingYear('2027-09', s)).toBe(true);
    expect(inAccountingYear('2026-09', s)).toBe(false);
    expect(inAccountingYear('2027-10', s)).toBe(false);
  });
});

describe('month labels', () => {
  it('formats a month in Russian', () => {
    expect(monthLabel('2026-10')).toBe('Октябрь 2026');
    expect(monthLabel('2027-01')).toBe('Январь 2027');
    expect(monthLabel('2027-05')).toBe('Май 2027');
  });

  it('parses a Russian month label back', () => {
    expect(parseMonthLabel('Октябрь 2026')).toBe('2026-10');
    expect(parseMonthLabel('Январь 2027')).toBe('2027-01');
    expect(parseMonthLabel('  Декабрь   2026 ')).toBe('2026-12');
    expect(parseMonthLabel('декабрь 2026')).toBe('2026-12');
  });

  it('returns null for anything that is not a month label', () => {
    expect(parseMonthLabel('Октябрь')).toBeNull();
    expect(parseMonthLabel('October 2026')).toBeNull();
    expect(parseMonthLabel('Октябрь 26')).toBeNull();
    expect(parseMonthLabel('')).toBeNull();
  });

  it('round-trips every month of a year', () => {
    for (let k = 0; k < 12; k++) {
      const ym = addMonths('2026-01', k);
      expect(parseMonthLabel(monthLabel(ym))).toBe(ym);
    }
  });
});

describe('daysFromTo', () => {
  it('counts both ends, across months and a leap day; 0 when the end is before the start', () => {
    expect(daysFromTo('2026-10-15', '2026-10-31')).toBe(17);
    expect(daysFromTo('2026-10-31', '2026-10-31')).toBe(1);
    expect(daysFromTo('2028-02-28', '2028-03-01')).toBe(3);
    expect(daysFromTo('2026-12-31', '2027-01-01')).toBe(2);
    expect(daysFromTo('2026-11-01', '2026-10-31')).toBe(0);
  });
});
