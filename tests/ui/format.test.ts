import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatDate, formatDay, formatMoney, formatShortDate, formatWeekdayDate, isNegativeMoney, localDateOf, localTimeOf, roundCents,
  todayISO,
} from '../../src/ui/format';

/** Intl puts no-break spaces (U+00A0 or U+202F) between groups and before €; compare with plain spaces. */
const plain = (s: string): string => s.replace(/[  ]/g, ' ');

describe('formatMoney', () => {
  it('formats euro the Russian way', () => {
    expect(plain(formatMoney(1234.56))).toBe('1 234,56 €');
    expect(plain(formatMoney(5))).toBe('5,00 €');
    expect(plain(formatMoney(1_000_000))).toBe('1 000 000,00 €');
  });

  it('keeps no-break spaces so an amount never wraps', () => {
    expect(formatMoney(1234.56)).not.toContain(' ');
  });

  it('shows negatives with a minus and never «-0,00 €»', () => {
    expect(plain(formatMoney(-1234.56))).toBe('-1 234,56 €');
    expect(plain(formatMoney(-0))).toBe('0,00 €');
    expect(plain(formatMoney(-0.001))).toBe('0,00 €');
  });

  it('adds a plus to positive amounts when signed', () => {
    expect(plain(formatMoney(12.5, { signed: true }))).toBe('+12,50 €');
    expect(plain(formatMoney(-12.5, { signed: true }))).toBe('-12,50 €');
    expect(plain(formatMoney(0, { signed: true }))).toBe('0,00 €');
  });

  it('rounds to cents', () => {
    expect(plain(formatMoney(0.005))).toBe('0,01 €');
    expect(plain(formatMoney(2.675))).toBe('2,68 €');
    expect(plain(formatMoney(1.005))).toBe('1,01 €');
  });

  it('rounds half away from zero, the same way for negative amounts', () => {
    expect(plain(formatMoney(12.345))).toBe('12,35 €');
    expect(plain(formatMoney(-12.345))).toBe('-12,35 €');
    expect(plain(formatMoney(0.125))).toBe('0,13 €');
    expect(plain(formatMoney(-0.125))).toBe('-0,13 €');
    expect(plain(formatMoney(-0.005))).toBe('-0,01 €');
    expect(plain(formatMoney(-0.004))).toBe('0,00 €');
    expect(isNegativeMoney(-0.004)).toBe(false);
    expect(isNegativeMoney(-0.005)).toBe(true);
    expect(roundCents(-12.345)).toBe(-12.35);
    expect(Object.is(roundCents(-0.004), 0)).toBe(true);
  });
});

describe('formatDate and formatDay', () => {
  it('formatDate → дд.мм.гггг without touching time zones', () => {
    expect(formatDate('2026-09-30')).toBe('30.09.2026');
    expect(formatDate('2028-02-29')).toBe('29.02.2028');
  });

  it('formatShortDate → дд.мм (a date inside a line: «спишется 10.12», a week «28.09–04.10»)', () => {
    expect(formatShortDate('2026-12-10')).toBe('10.12');
    expect(formatShortDate('2026-09-03')).toBe('03.09');
    expect(formatShortDate('2028-02-29')).toBe('29.02');
    // the same reading as formatDate: what it cannot read comes back unchanged
    expect(formatShortDate('2026-13-01')).toBe('2026-13-01');
    expect(formatShortDate('30.09.2026')).toBe('30.09.2026');
    expect(formatShortDate('')).toBe('');
    for (const iso of ['2026-01-31', '2026-10-05', '2027-12-28']) expect(formatShortDate(iso)).toBe(formatDate(iso).slice(0, 5));
  });

  it('formatDay → day and month in the genitive', () => {
    expect(formatDay('2026-09-30')).toBe('30 сентября');
    expect(formatDay('2026-03-01')).toBe('1 марта');
    expect(formatDay('2027-01-05')).toBe('5 января');
  });

  it('formatDay can add the year', () => {
    expect(formatDay('2027-05-09', { year: true })).toBe('9 мая 2027');
  });

  it('returns text that is not a date unchanged', () => {
    expect(formatDate('')).toBe('');
    expect(formatDate('вчера')).toBe('вчера');
    expect(formatDay('2026-13-01')).toBe('2026-13-01');
  });
});

describe('formatWeekdayDate', () => {
  it('«Среда, 30 сентября»: capitalised weekday, day and month, worked out from the date string alone', () => {
    expect(formatWeekdayDate('2026-09-30')).toBe('Среда, 30 сентября');
    expect(formatWeekdayDate('2026-10-04')).toBe('Воскресенье, 4 октября');
    expect(formatWeekdayDate('2026-10-05')).toBe('Понедельник, 5 октября');
    expect(formatWeekdayDate('2027-01-01')).toBe('Пятница, 1 января');
    expect(formatWeekdayDate('2028-02-29')).toBe('Вторник, 29 февраля');
    expect(formatWeekdayDate('1900-01-01')).toBe('Понедельник, 1 января');
  });

  it('returns text that is not a date unchanged', () => {
    expect(formatWeekdayDate('вчера')).toBe('вчера');
    expect(formatWeekdayDate('2026-13-01')).toBe('2026-13-01');
  });
});

describe('the test run time zone', () => {
  it('is pinned to Pacific/Auckland, so local-date tests tell local from UTC', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Pacific/Auckland');
    // 00:30 on 1 October in Auckland is still 30 September in UTC
    expect(new Date(2026, 9, 1, 0, 30).toISOString().slice(0, 10)).toBe('2026-09-30');
  });
});

describe('localDateOf', () => {
  it('the LOCAL calendar date of a stored timestamp (e.g. meta.lastBackupAt)', () => {
    expect(localDateOf('2026-09-30T22:30:00.000Z')).toBe('2026-10-01'); // Auckland, UTC+13
    expect(localDateOf('2026-09-30T10:00:00.000Z')).toBe('2026-09-30');
    expect(localDateOf('2026-09-30T22:30:00.000Z')).toBe(todayISO(new Date('2026-09-30T22:30:00.000Z')));
  });

  it('undefined for nothing or an unreadable value', () => {
    expect(localDateOf(undefined)).toBeUndefined();
    expect(localDateOf('вчера')).toBeUndefined();
  });
});

describe('localTimeOf', () => {
  it('the LOCAL time HH:MM of a stored timestamp (e.g. meta.sync.lastAt)', () => {
    expect(localTimeOf('2026-09-30T22:30:00.000Z')).toBe('11:30'); // Auckland, UTC+13
    expect(localTimeOf('2026-10-01T10:05:59.999Z')).toBe('23:05');
  });

  it('undefined for nothing or an unreadable value', () => {
    expect(localTimeOf(undefined)).toBeUndefined();
    expect(localTimeOf('вчера')).toBeUndefined();
  });
});

describe('todayISO', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('takes a Date: the local date of that moment', () => {
    expect(todayISO(new Date(2026, 8, 30, 23, 59))).toBe('2026-09-30');
  });

  it('is the LOCAL calendar date, not the UTC one', () => {
    vi.useFakeTimers();
    // 00:30 local time on 1 October: in any zone east of UTC the UTC date is still 30 September
    vi.setSystemTime(new Date(2026, 9, 1, 0, 30));
    expect(todayISO()).toBe('2026-10-01');
    vi.setSystemTime(new Date(2026, 8, 30, 23, 59));
    expect(todayISO()).toBe('2026-09-30');
  });

  it('pads month and day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2027, 0, 5, 12, 0));
    expect(todayISO()).toBe('2027-01-05');
  });
});
