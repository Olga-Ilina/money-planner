import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyData } from '../../src/engine';
import type { Data } from '../../src/engine';
import { clampMonth, data, feedMonth, refreshToday, resetSession } from '../../src/ui/state';

function withYear(accountingStart: string): Data {
  const d = emptyData('2026-09-15');
  return { ...d, settings: { ...d.settings, accountingStart } };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 15, 12, 0)); // 15 September 2026, local
  resetSession();
});

afterEach(() => {
  resetSession();
  vi.useRealTimers();
});

describe('feedMonth («Лента»)', () => {
  it('stays inside the accounting months: a month outside becomes the current month when it is inside', () => {
    data.value = withYear('2026-01');
    feedMonth.value = '2027-05';
    expect(feedMonth.value).toBe('2026-09');
    feedMonth.value = '2026-03';
    expect(feedMonth.value).toBe('2026-03');
  });

  it('is re-clamped when the accounting year changes: the current month, else the nearest accounting month', () => {
    data.value = withYear('2026-01');
    feedMonth.value = '2026-03';
    data.value = withYear('2026-10'); // October 2026 – September 2027: neither March nor September 2026
    expect(feedMonth.value).toBe('2026-10');
    feedMonth.value = '2027-08';
    data.value = withYear('2026-06'); // June 2026 – May 2027: not August 2027, but September 2026
    expect(feedMonth.value).toBe('2026-09');
    // today (September 2026) is after January – December 2025: the nearest month is the LAST one
    data.value = withYear('2025-01');
    expect(feedMonth.value).toBe('2025-12');
  });

  it('follows the day: a new month is used once the old one is outside', () => {
    data.value = withYear('2025-10'); // October 2025 – September 2026
    feedMonth.value = '2026-09';
    vi.setSystemTime(new Date(2026, 9, 2, 12, 0));
    refreshToday();
    expect(feedMonth.value).toBe('2026-09'); // still inside: kept
  });

  it('clampMonth: a month of the year stays; else the current month when inside; else the nearest end of the year', () => {
    const year = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09'];
    expect(clampMonth('2027-02', year, '2026-11')).toBe('2027-02');
    expect(clampMonth('2025-05', year, '2026-11')).toBe('2026-11');
    // today before the year → the first month; after it → the last month (never jumps back a whole year)
    expect(clampMonth('2025-05', year, '2026-09')).toBe('2026-10');
    expect(clampMonth('2025-05', year, '2027-10')).toBe('2027-09');
    expect(clampMonth('2031-01', year, '2031-01')).toBe('2027-09');
    expect(clampMonth('2026-01', [], '2026-09')).toBe('2026-01');
  });

  it('without data it is left alone', () => {
    feedMonth.value = '2031-01';
    expect(feedMonth.value).toBe('2031-01');
  });
});
