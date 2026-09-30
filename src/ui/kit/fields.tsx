// iOS form rows: the label on the left, the value on the right, an error under the row. Put them
// inside a <Section>. Every optional field emits `undefined` (never '') when it is cleared.
// DateField, AmountField and NumberField call onChange(value, {invalid}): text that does not parse
// (letters, a stray symbol, a bad year, too many decimals) is never emitted and never removed from the
// input — the value is `undefined` with invalid: true, the typed text stays visible and the field shows
// why — so a form can tell «invalid» from «empty» and keep the stored value (see useFieldValidity).
// Inputs use 17 px text, so iOS does not zoom in on focus. Every field takes an optional `hint`: muted text
// under the field that also describes its control (aria-describedby, after the error when there is one).
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ISODate } from '../../engine';
import { roundCents } from '../format';
import type { Option } from './Segmented';
import { useUid } from './uid';

/** Second argument of onChange of DateField, AmountField and NumberField. */
export interface FieldInfo {
  /** The field holds text that does not parse (the value is then `undefined`, NOT «cleared»). */
  invalid: boolean;
}

const VALID: FieldInfo = { invalid: false };
const INVALID: FieldInfo = { invalid: true };

/**
 * onChange of DateField, AmountField and NumberField. The one made by `useFieldValidity().field(name, …)`
 * also has `forget`, which a field calls when it unmounts.
 */
export type FieldChange<T> = ((value: T | undefined, info: FieldInfo) => void) & { forget?: () => void };

/**
 * For forms: which fields hold text that does not parse. `field(name, set)` is the onChange for a
 * DateField / AmountField / NumberField: a valid value — or a cleared field — goes to `set`; an
 * invalid one only marks the field, so the stored value is kept (a typo never deletes a value).
 * Disable saving while `anyInvalid`.
 *
 * A field that leaves the page is forgotten by itself (it reports that when it unmounts), so a hidden
 * field never keeps saving disabled; a shown-again field starts valid. `forget(name)` does the same for
 * a form that hides a field without unmounting it.
 */
export function useFieldValidity() {
  const [bad, setBad] = useState<ReadonlySet<string>>(() => new Set());
  const mark = (name: string, invalid: boolean): void =>
    setBad((prev) => {
      if (prev.has(name) === invalid) return prev;
      const next = new Set(prev);
      if (invalid) next.add(name);
      else next.delete(name);
      return next;
    });
  const forget = (name: string): void => mark(name, false);
  const field = <T,>(name: string, set: (value: T | undefined) => void): FieldChange<T> =>
    Object.assign(
      (value: T | undefined, info: FieldInfo): void => {
        mark(name, info.invalid);
        if (!info.invalid) set(value);
      },
      { forget: () => forget(name) },
    );
  return { anyInvalid: bad.size > 0, isInvalid: (name: string) => bad.has(name), field, forget };
}

/** A field tells its form's `useFieldValidity` that it is gone (unmounted); it never calls `set`. */
function useForgetOnUnmount(onChange: { forget?: () => void }): void {
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => () => latest.current.forget?.(), []);
}

interface FieldRowProps {
  id: string;
  label: string;
  error?: string;
  /** Muted text under the field (and under its error). */
  hint?: string;
  children: ComponentChildren;
  /** The value sits under the label instead of beside it (long text). */
  stacked?: boolean;
}

/** Muted text under a field; its id is what the control's aria-describedby names. */
function FieldHint({ id, hint }: { id: string; hint: string | undefined }) {
  return hint ? (
    <div class="field-hint" id={`${id}-hint`}>
      {hint}
    </div>
  ) : null;
}

function FieldRow({ id, label, error, hint, children, stacked }: FieldRowProps) {
  return (
    <div class={`field${error ? ' field-invalid' : ''}${stacked ? ' field-stacked' : ''}`}>
      <div class="field-row">
        <label class="field-label" for={id}>
          {label}
        </label>
        {children}
      </div>
      {error && (
        <div class="field-error" id={`${id}-error`} role="alert">
          {error}
        </div>
      )}
      <FieldHint id={id} hint={hint} />
    </div>
  );
}

/** Focuses the element once after mount (the autofocus attribute does nothing on inserted elements). */
function useAutoFocus<T extends HTMLElement>(on: boolean | undefined) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (on) ref.current?.focus({ preventScroll: true });
  }, []);
  return ref;
}

/** aria-invalid with an error; aria-describedby naming the error and the hint that are shown. */
function describedProps(id: string, error: string | undefined, hint: string | undefined) {
  const by = [error ? `${id}-error` : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ');
  return { ...(error ? { 'aria-invalid': true as const } : {}), ...(by ? { 'aria-describedby': by } : {}) };
}

// ---------- AmountField ----------

export interface AmountFieldProps {
  label: string;
  value?: number;
  /** `info.invalid`: the text is not an amount (value `undefined`) — keep the stored amount. */
  onChange: FieldChange<number>;
  autoFocus?: boolean;
  error?: string;
  placeholder?: string;
  /** Allows a leading minus (a refund in the journal). */
  allowNegative?: boolean;
  /** Muted text under the field (aria-describedby). */
  hint?: string;
}

const AMOUNT_ERROR = 'Проверьте сумму';
const NUMBER_ERROR = 'Проверьте число';
const SPACES = /[\s  ]/g;

/** An amount as it is shown for editing: cents at most, a decimal comma, no grouping ('1234,5'). */
const amountText = (v: number | undefined): string =>
  v === undefined || !Number.isFinite(v) ? '' : String(roundCents(v)).replace('.', ',');

const INVALID_AMOUNT = { value: undefined, invalid: true } as const;

/**
 * Reads a typed amount. Spaces are ignored. With both ',' and '.', the rightmost is the decimal
 * separator and the other one groups thousands; one kind used more than once groups thousands; a
 * single separator followed by exactly 3 digits after a 1–3 digit number groups thousands ('12.500' =
 * 12500; money has at most 2 decimals); otherwise it is the decimal separator. Thousands groups must
 * be well formed ('1.234.567'), and more than 2 decimals is invalid ('0,125').
 */
export function parseAmount(raw: string, allowNegative = false): { value: number | undefined; invalid: boolean } {
  let s = raw.replace(SPACES, '');
  if (s === '') return { value: undefined, invalid: false };
  let negative = false;
  if (/^[-−]/.test(s)) {
    if (!allowNegative) return INVALID_AMOUNT;
    negative = true;
    s = s.slice(1);
  }
  if (!/^[0-9.,]+$/.test(s)) return INVALID_AMOUNT;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let whole = s;
  let fraction = '';
  let group: ',' | '.' | null = null;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? ',' : '.';
    const at = Math.max(lastComma, lastDot);
    whole = s.slice(0, at);
    fraction = s.slice(at + 1);
    group = decimal === ',' ? '.' : ',';
    if (whole.includes(decimal)) return INVALID_AMOUNT;
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const pieces = s.split(sep);
    const [head = '', tail = ''] = pieces;
    if (pieces.length > 2 || (tail.length === 3 && /^[1-9]\d{0,2}$/.test(head))) group = sep;
    else {
      whole = head;
      fraction = tail;
    }
  }
  if (group) {
    const groups = whole.split(group);
    if (!/^[1-9]\d{0,2}$/.test(groups[0] ?? '') || groups.slice(1).some((g) => !/^\d{3}$/.test(g))) return INVALID_AMOUNT;
    whole = groups.join('');
  }
  if (fraction.length > 2 || (whole === '' && fraction === '')) return INVALID_AMOUNT;
  const n = Number(`${whole || '0'}.${fraction || '0'}`);
  if (!Number.isFinite(n)) return INVALID_AMOUNT;
  return { value: negative && n !== 0 ? -n : n, invalid: false };
}

/** Tracks focus: errors about the typed text wait until the field is left (no error while typing). */
function useFocused(): [boolean, { onFocus: () => void; onBlur: () => void }] {
  const [focused, setFocused] = useState(false);
  return [focused, { onFocus: () => setFocused(true), onBlur: () => setFocused(false) }];
}

export function AmountField({
  label, value, onChange, autoFocus, error, placeholder = '0,00', allowNegative = false, hint,
}: AmountFieldProps) {
  const id = useUid();
  const ref = useAutoFocus<HTMLInputElement>(autoFocus);
  const [text, setText] = useState(() => amountText(value));
  const [focused, focusProps] = useFocused();

  useEffect(() => {
    if (parseAmount(text, allowNegative).value !== value) setText(amountText(value));
  }, [value]);

  useForgetOnUnmount(onChange);

  // Nothing is filtered: letters or a symbol (hardware keyboard, paste) stay visible and make the field
  // invalid, so the user sees what to fix and the stored amount is not deleted
  const onInput = (e: JSX.TargetedEvent<HTMLInputElement>) => {
    const typed = e.currentTarget.value;
    setText(typed);
    const parsed = parseAmount(typed, allowNegative);
    onChange(parsed.value, parsed.invalid ? INVALID : VALID);
  };

  const bad = parseAmount(text, allowNegative).invalid;
  const shownError = bad && !focused ? AMOUNT_ERROR : error;

  return (
    <FieldRow id={id} label={label} error={shownError} hint={hint}>
      <input
        ref={ref}
        id={id}
        class="field-input field-amount"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        onInput={onInput}
        {...focusProps}
        {...describedProps(id, shownError, hint)}
      />
    </FieldRow>
  );
}

// ---------- DateField ----------

export interface DateFieldProps {
  label: string;
  value?: ISODate;
  /** `info.invalid`: a year outside 1900..2200 or a half-typed date (value `undefined`) — keep the stored date. */
  onChange: FieldChange<ISODate>;
  error?: string;
  min?: ISODate;
  max?: ISODate;
  /** Muted text under the field (aria-describedby). */
  hint?: string;
}

export const YEAR_MIN = 1900;
export const YEAR_MAX = 2200;
const YEAR_ERROR = 'Проверьте год';

/** A real calendar date 'YYYY-MM-DD' with a year in 1900..2200 (backups refuse anything else). */
export function isValidDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < YEAR_MIN || y > YEAR_MAX || mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

export function DateField({ label, value, onChange, error, min, max, hint }: DateFieldProps) {
  const id = useUid();
  const [text, setText] = useState(value ?? '');
  // the browser's value is '' while a date is half typed; validity.badInput tells it from «cleared»
  const [partial, setPartial] = useState(false);
  const [focused, focusProps] = useFocused();
  useForgetOnUnmount(onChange);

  useEffect(() => {
    const shown = isValidDate(text) ? text : undefined;
    if (shown !== value) {
      setText(value ?? '');
      setPartial(false);
    }
  }, [value]);

  const bad = partial || (text !== '' && !isValidDate(text));
  const onInput = (e: JSX.TargetedEvent<HTMLInputElement>) => {
    const v = e.currentTarget.value;
    const half = v === '' && e.currentTarget.validity?.badInput === true;
    if (v === text && half === partial) return;
    setText(v);
    setPartial(half);
    if (v === '' && !half) onChange(undefined, VALID);
    else if (isValidDate(v)) onChange(v, VALID);
    else onChange(undefined, INVALID);
  };
  const shownError = bad && !focused ? YEAR_ERROR : error;

  return (
    <FieldRow id={id} label={label} error={shownError} hint={hint}>
      <input
        id={id}
        class="field-input field-date"
        type="date"
        value={text}
        min={min}
        max={max}
        onInput={onInput}
        onChange={onInput}
        {...focusProps}
        {...describedProps(id, shownError, hint)}
      />
    </FieldRow>
  );
}

// ---------- TextField ----------

export interface TextFieldProps {
  label: string;
  value?: string;
  onChange: (value: string | undefined) => void;
  placeholder?: string;
  autoFocus?: boolean;
  error?: string;
  maxLength?: number;
  /** Label above a wide input (for long text). */
  stacked?: boolean;
  autoCapitalize?: 'off' | 'none' | 'sentences' | 'words' | 'characters';
  /** Turns off autocorrect and spellcheck (codes, confirmation words). */
  noAutocorrect?: boolean;
  /** Muted text under the field (aria-describedby). */
  hint?: string;
}

export function TextField({
  label, value, onChange, placeholder, autoFocus, error, maxLength, stacked, autoCapitalize, noAutocorrect, hint,
}: TextFieldProps) {
  const id = useUid();
  const ref = useAutoFocus<HTMLInputElement>(autoFocus);
  return (
    <FieldRow id={id} label={label} error={error} hint={hint} stacked={stacked}>
      <input
        ref={ref}
        id={id}
        class="field-input"
        type="text"
        value={value ?? ''}
        placeholder={placeholder}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        {...(noAutocorrect ? { autoCorrect: 'off', spellcheck: false, autoComplete: 'off' } : {})}
        onInput={(e) => {
          const v = e.currentTarget.value;
          onChange(v === '' ? undefined : v);
        }}
        {...describedProps(id, error, hint)}
      />
    </FieldRow>
  );
}

// ---------- SelectField ----------

export interface SelectFieldProps<T extends string> {
  label: string;
  value?: T;
  options: Option<T>[];
  onChange: (value: T | undefined) => void;
  /** Adds an empty first choice with this text (an optional field); choosing it emits undefined. */
  placeholder?: string;
  /**
   * Without a `placeholder`, what a required select reads while nothing is chosen (default «Не выбран»); give
   * the form that agrees with the label, e.g. «Не выбрана» for «Карта».
   */
  emptyLabel?: string;
  error?: string;
  /** Muted text under the field (aria-describedby). */
  hint?: string;
}

export function SelectField<T extends string>({
  label, value, options, onChange, placeholder, emptyLabel = 'Не выбран', error, hint,
}: SelectFieldProps<T>) {
  const id = useUid();
  const known = value !== undefined && options.some((o) => o.value === value);
  return (
    <FieldRow id={id} label={label} error={error} hint={hint}>
      <select
        id={id}
        class="field-input field-select"
        value={known ? value : ''}
        onChange={(e) => {
          const v = e.currentTarget.value;
          onChange(v === '' ? undefined : (v as T));
        }}
        {...describedProps(id, error, hint)}
      >
        {placeholder !== undefined ? (
          <option value="">{placeholder}</option>
        ) : (
          !known && (
            // nothing chosen yet in a required select (an account): said the way a placeholder would
            <option value="" disabled>
              {emptyLabel}
            </option>
          )
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldRow>
  );
}

// ---------- NumberField ----------

export interface NumberFieldProps {
  label: string;
  value?: number;
  /** `info.invalid`: out of range or not a number (value `undefined`) — keep the stored number. */
  onChange: FieldChange<number>;
  min?: number;
  max?: number;
  /**
   * Whole numbers only (default true). `false`: a PLAIN decimal («3,875» = «3.875» = 3.875, e.g. a rate in %);
   * no thousands grouping, so «1 000» is invalid — money is `AmountField`.
   */
  integer?: boolean;
  error?: string;
  placeholder?: string;
  /** Muted text under the field (aria-describedby). */
  hint?: string;
}

function rangeError(n: number, min?: number, max?: number): string | undefined {
  if (min !== undefined && max !== undefined && (n < min || n > max)) return `От ${min} до ${max}`;
  if (min !== undefined && n < min) return `Не меньше ${min}`;
  if (max !== undefined && n > max) return `Не больше ${max}`;
  return undefined;
}

/** A whole number: digits only (spaces around it are ignored); anything else that is not empty is invalid. */
function parseInteger(raw: string): { value: number | undefined; invalid: boolean } {
  const t = raw.trim();
  if (t === '') return { value: undefined, invalid: false };
  const n = Number(t);
  if (!/^[0-9]+$/.test(t) || !Number.isSafeInteger(n)) return INVALID_AMOUNT;
  return { value: n, invalid: false };
}

/**
 * A plain decimal, for a decimal NumberField (rates like «3,875»). Unlike `parseAmount` (money) there is NO
 * thousands grouping: at most one decimal separator (',' or '.'), so «3,875» and «3.875» are both 3.875 and
 * «1 000», «1,2,3» and «1.234,5» are invalid. Spaces (also no-break) only around the number are ignored.
 * At least one digit is needed; «,5» is 0.5 and «5,» is 5 (a half-typed number is fine). A leading minus
 * only with `allowNegative` (a «−» sign counts too), with nothing between it and the digits.
 */
function parseDecimal(raw: string, allowNegative: boolean): { value: number | undefined; invalid: boolean } {
  const t = raw.trim();
  if (t === '') return { value: undefined, invalid: false };
  const m = /^([-−])?(\d*)(?:[.,](\d*))?$/.exec(t);
  const [, sign, whole = '', fraction = ''] = m ?? [];
  if (!m || (whole === '' && fraction === '') || (sign && !allowNegative)) return INVALID_AMOUNT;
  const n = Number(`${whole || '0'}.${fraction || '0'}`);
  if (!Number.isFinite(n)) return INVALID_AMOUNT;
  return { value: sign && n !== 0 ? -n : n, invalid: false };
}

/**
 * A number as it is shown for editing: a decimal comma, no thousands grouping, no float noise (0.1 + 0.2 →
 * «0,3»): at most 6 decimals, trailing zeros trimmed.
 */
const numberText = (v: number | undefined): string => {
  if (v === undefined || !Number.isFinite(v)) return '';
  const s = v.toFixed(6).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return (s === '-0' ? '0' : s).replace('.', ',');
};

export function NumberField({ label, value, onChange, min, max, integer = true, error, placeholder, hint }: NumberFieldProps) {
  const id = useUid();
  const negative = !integer && (min === undefined || min < 0);
  const [text, setText] = useState(() => numberText(value));
  const [focused, focusProps] = useFocused();
  useForgetOnUnmount(onChange);
  const parse = (t: string) => (integer ? parseInteger(t) : parseDecimal(t, negative));

  // Compare what is SHOWN, not the raw numbers: a host that stores a fraction and shows a percent passes
  // `frac * 100` with float noise (7.000000000000001 for a typed «7,»), and rewriting the text then eats the comma.
  useEffect(() => {
    if (numberText(parse(text).value) !== numberText(value)) setText(numberText(value));
  }, [value]);

  const parsed = parse(text);
  const range = parsed.value === undefined ? undefined : rangeError(parsed.value, min, max);
  // out of range shows at once (a limit, not a typo); unparseable text once the field is left
  const shownError = range ?? (parsed.invalid && !focused ? NUMBER_ERROR : error);

  return (
    <FieldRow id={id} label={label} error={shownError} hint={hint}>
      <input
        id={id}
        class="field-input field-number"
        type="text"
        inputMode={integer ? 'numeric' : 'decimal'}
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        onInput={(e) => {
          const typed = e.currentTarget.value; // kept as typed, like AmountField
          setText(typed);
          const next = parse(typed);
          const bad = next.invalid || (next.value !== undefined && rangeError(next.value, min, max) !== undefined);
          onChange(bad ? undefined : next.value, bad ? INVALID : VALID);
        }}
        {...focusProps}
        {...describedProps(id, shownError, hint)}
      />
    </FieldRow>
  );
}

// ---------- ToggleField ----------

export interface ToggleFieldProps {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  /** Muted text under the field (aria-describedby). */
  hint?: string;
}

export function ToggleField({ label, value, onChange, disabled, hint }: ToggleFieldProps) {
  const id = useUid();
  return (
    <div class="field">
      <div class="field-row">
        <span class="field-label" id={`${id}-label`}>
          {label}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={value}
          aria-labelledby={`${id}-label`}
          {...describedProps(id, undefined, hint)}
          class={`switch${value ? ' switch-on' : ''}`}
          disabled={disabled}
          onClick={() => onChange(!value)}
        >
          <span class="switch-knob" />
        </button>
      </div>
      <FieldHint id={id} hint={hint} />
    </div>
  );
}
