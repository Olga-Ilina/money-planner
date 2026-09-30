// ‹ Октябрь 2026 › — steps through the given months only (e.g. the 12 accounting months).
import { monthLabel } from '../../engine';
import type { YM } from '../../engine';
import { Icon } from './Icon';

export interface MonthPickerProps {
  value: YM;
  /** The months that can be chosen, ascending. */
  months: YM[];
  onChange: (value: YM) => void;
}

export function MonthPicker({ value, months, onChange }: MonthPickerProps) {
  // 'YYYY-MM' strings compare like dates; a value outside the list steps to the nearest month inside
  const prev = months.filter((m) => m < value).pop();
  const next = months.find((m) => m > value);
  return (
    <div class="month-picker">
      <button
        type="button"
        class="icon-button"
        aria-label="Предыдущий месяц"
        disabled={prev === undefined}
        onClick={() => prev !== undefined && onChange(prev)}
      >
        <Icon name="chevron-left" size={22} />
      </button>
      <span class="month-picker-label" aria-live="polite">
        {monthLabel(value)}
      </span>
      <button
        type="button"
        class="icon-button"
        aria-label="Следующий месяц"
        disabled={next === undefined}
        onClick={() => next !== undefined && onChange(next)}
      >
        <Icon name="chevron-right" size={22} />
      </button>
    </div>
  );
}
