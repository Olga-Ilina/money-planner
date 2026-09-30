// An amount in euro, formatted the Russian way ('1 234,56 €', never wrapping). With the default
// 'auto' tone a negative amount is red.
import { formatMoney, isNegativeMoney } from '../format';

export interface MoneyProps {
  value: number;
  /** 'auto' (default): negative → red; 'plain': never coloured. */
  tone?: 'auto' | 'plain';
  /** Adds '+' to positive amounts. */
  signed?: boolean;
}

export function Money({ value, tone = 'auto', signed = false }: MoneyProps) {
  const red = tone === 'auto' && isNegativeMoney(value);
  return <span class={`money${red ? ' tone-red' : ''}`}>{formatMoney(value, { signed })}</span>;
}
