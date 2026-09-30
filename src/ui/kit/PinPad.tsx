// PIN entry like the iOS passcode screen: title, message, 4 dots, keypad 1–9, 0 and delete.
// Controlled: the owner keeps the digits (in memory only) and reacts when all 4 are in.
// Digits and Backspace on a hardware keyboard work too, except while typing in a field, and never
// for a pad inside a hidden or inert part of the page (e.g. the «PIN» page behind the lock screen).
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Icon } from './Icon';

export interface PinPadProps {
  title: string;
  /** Hint or error under the title. */
  message?: ComponentChildren;
  messageTone?: 'default' | 'error';
  /** Digits entered so far. */
  value: string;
  onChange: (value: string) => void;
  length?: number;
  disabled?: boolean;
  /** Changing this number plays the «wrong PIN» shake. */
  shake?: number;
  /** Under the keypad (e.g. «Забыли PIN?»). */
  footer?: ComponentChildren;
  /** Inside a <Page> (the «PIN» settings page): no lock icon, and the title is an h2 under the page's h1. */
  inPage?: boolean;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** A key meant for something else: a field, or a sheet open over the keypad (e.g. «Забыли PIN?»). */
function meantForOther(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return true;
  return target.closest('[role="dialog"], [role="alertdialog"]') !== null;
}

export function PinPad({
  title, message, messageTone = 'default', value, onChange, length = 4, disabled, shake = 0, footer, inPage = false,
}: PinPadProps) {
  const root = useRef<HTMLDivElement>(null);
  const state = useRef({ value, disabled, onChange, length });
  state.current = { value, disabled, onChange, length };

  const press = (digit: string) => {
    const s = state.current;
    if (s.disabled || s.value.length >= s.length) return;
    s.onChange(s.value + digit);
  };
  const erase = () => {
    const s = state.current;
    if (s.disabled || s.value.length === 0) return;
    s.onChange(s.value.slice(0, -1));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || meantForOther(e.target)) return;
      // a pad that cannot be seen (the app hidden behind the lock) never takes keys
      if (root.current?.closest('[inert], [hidden]')) return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') erase();
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div class={`pinpad${inPage ? ' pinpad-in-page' : ''}`} ref={root}>
      <div class="pinpad-head">
        {!inPage && <Icon name="lock" size={28} />}
        {inPage ? <h2 class="pinpad-title">{title}</h2> : <h1 class="pinpad-title">{title}</h1>}
        <p class={`pinpad-message${messageTone === 'error' ? ' pinpad-message-error' : ''}`} aria-live="polite">
          {message ?? ' '}
        </p>
        <div
          key={shake}
          class={`pin-dots${shake > 0 ? ' shake' : ''}`}
          role="img"
          aria-label={`Введено цифр: ${value.length} из ${length}`}
        >
          {Array.from({ length }, (_, i) => (
            <span class={`pin-dot${i < value.length ? ' pin-dot-filled' : ''}`} />
          ))}
        </div>
      </div>
      <div class="keypad">
        {KEYS.map((d) => (
          <button type="button" class="key" aria-label={d} disabled={disabled} onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <span class="key-spacer" />
        <button type="button" class="key" aria-label="0" disabled={disabled} onClick={() => press('0')}>
          0
        </button>
        <button
          type="button"
          class="key key-delete"
          aria-label="Удалить цифру"
          disabled={disabled || value.length === 0}
          onClick={erase}
        >
          Удалить
        </button>
      </div>
      {footer && <div class="pinpad-footer">{footer}</div>}
    </div>
  );
}
