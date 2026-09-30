// Summary figures at the top of a screen («На картах», «Наличные», «Кредитка»): a small label, the
// amount (through Money) and an optional small line. StatGrid lays them out 2–3 per row; at 375 pt a
// row of three wraps to two.
import type { ComponentChildren } from 'preact';
import { Icon } from './Icon';
import { Money } from './Money';

export interface StatCardProps {
  label: string;
  value: number;
  /** 'auto' (default): negative → red; 'neg': always red (a debt); 'pos': always green. */
  tone?: 'neg' | 'pos' | 'auto';
  /** A small line under the amount, e.g. «Спишется 10 октября: 300,00 €». */
  sub?: string;
  /** Makes the card a button (e.g. → tab «Счета»). */
  onClick?: () => void;
}

export function StatCard({ label, value, tone = 'auto', sub, onClick }: StatCardProps) {
  const toneClass = tone === 'neg' ? ' tone-red' : tone === 'pos' ? ' tone-green' : '';
  const body = (
    <>
      <span class="stat-label">{label}</span>
      <span class={`stat-value${toneClass}`}>
        <Money value={value} tone={tone === 'auto' ? 'auto' : 'plain'} />
      </span>
      {sub && <span class="stat-sub">{sub}</span>}
    </>
  );
  return onClick ? (
    <button type="button" class="stat-card stat-card-button" onClick={onClick}>
      {body}
      <span class="stat-chevron">
        <Icon name="chevron-right" size={14} />
      </span>
    </button>
  ) : (
    <div class="stat-card">{body}</div>
  );
}

export interface StatGridProps {
  children?: ComponentChildren;
  /** At most this many cards per row (default 3; fewer when the screen is narrow). */
  columns?: 2 | 3;
}

export function StatGrid({ children, columns = 3 }: StatGridProps) {
  return <div class={`stat-grid stat-grid-${columns}`}>{children}</div>;
}
