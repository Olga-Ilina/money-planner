// Segmented control (one of 2–4 options, e.g. Расход / Доход / Перевод) and chips (a wrapping row
// of pill buttons, e.g. categories; one value, or several with `multi`).
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';

export interface Option<T extends string = string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group — what is being chosen, e.g. «Тип операции» (required). */
  label: string;
}

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * A radio group: one tab stop (the selected segment); arrow keys (wrapping), Home and End choose and
 * move focus. Segments are 44 px high and never wrap (4 options get a smaller font).
 */
export function Segmented<T extends string>({ options, value, onChange, label }: SegmentedProps<T>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = options.findIndex((o) => o.value === value);
  const tabStop = selected >= 0 ? selected : 0;

  const choose = (i: number) => {
    const o = options[i];
    if (!o) return;
    if (o.value !== value) onChange(o.value);
    buttons.current[i]?.focus();
  };

  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = options.length;
    let next: number | undefined;
    if (e.key in STEP) next = (i + (STEP[e.key] ?? 0) + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next === undefined) return;
    e.preventDefault();
    choose(next);
  };

  return (
    <div class={`segmented segmented-${options.length}`} role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button
          type="button"
          key={o.value}
          ref={(el) => {
            buttons.current[i] = el;
          }}
          role="radio"
          aria-checked={o.value === value}
          tabIndex={i === tabStop ? 0 : -1}
          class={`segment${o.value === value ? ' segment-selected' : ''}`}
          onClick={() => {
            if (o.value !== value) onChange(o.value);
          }}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface ChipsBase<T extends string> {
  options: Option<T>[];
  /** Accessible name of the group. */
  label?: string;
}

export interface SingleChipsProps<T extends string> extends ChipsBase<T> {
  multi?: false;
  value: T | undefined;
  onChange: (value: T) => void;
}

export interface MultiChipsProps<T extends string> extends ChipsBase<T> {
  multi: true;
  value: T[];
  onChange: (value: T[]) => void;
}

export type ChipsProps<T extends string> = SingleChipsProps<T> | MultiChipsProps<T>;

/** Single: tapping a chip selects it (tapping the selected one keeps it). Multi: tapping toggles. */
export function Chips<T extends string>(props: ChipsProps<T>) {
  const selected = (v: T): boolean => (props.multi ? props.value.includes(v) : props.value === v);
  const tap = (v: T): void => {
    if (props.multi) {
      props.onChange(props.value.includes(v) ? props.value.filter((x) => x !== v) : [...props.value, v]);
    } else if (props.value !== v) {
      props.onChange(v);
    }
  };
  return (
    <div class="chips" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          type="button"
          key={o.value}
          class={`chip${selected(o.value) ? ' chip-selected' : ''}`}
          aria-pressed={selected(o.value)}
          onClick={() => tap(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
