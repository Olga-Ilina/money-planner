// Thin rounded bar (spent of a limit, saved of a price). Over the max it is full and red.
export interface ProgressBarProps {
  value: number;
  max: number;
  tone?: 'tint' | 'green' | 'red' | 'orange';
  /** Accessible name (required), e.g. «Потрачено из лимита». */
  label: string;
}

export function ProgressBar({ value, max, tone = 'tint', label }: ProgressBarProps) {
  const over = value > max;
  const share = max > 0 ? Math.min(1, Math.max(0, value / max)) : value > 0 ? 1 : 0;
  const top = Math.max(0, max);
  // assistive tech expects min ≤ now ≤ max: an overspent bar reports the max (it is also red)
  const now = Math.min(Math.max(0, value), top);
  return (
    <span class="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={top} aria-valuenow={now}>
      <span class={`progress-fill tone-${over ? 'red' : tone}`} style={{ width: `${share * 100}%` }} />
    </span>
  );
}
