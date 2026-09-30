// Buttons: 'filled' (the one main action of a view — at most one per view), 'plain' (tinted text)
// and 'destructive' (red text).
import type { ComponentChildren } from 'preact';

export interface ButtonProps {
  kind?: 'filled' | 'plain' | 'destructive';
  onClick?: () => void;
  disabled?: boolean;
  /** Stretches to the full width of the column. */
  full?: boolean;
  type?: 'button' | 'submit';
  children?: ComponentChildren;
}

export function Button({ kind = 'filled', onClick, disabled, full, type = 'button', children }: ButtonProps) {
  return (
    <button type={type} class={`btn btn-${kind}${full ? ' btn-full' : ''}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
