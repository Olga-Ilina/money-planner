// «Новая операция» / «Операция» (spec §5): a bottom sheet to enter or edit an expense, income or
// transfer. Amount first (large), then the kind, category chips (the most used lately first), the
// account (the last one used for that kind), the date (today) and «Что». Validates inline, warns about a
// possible duplicate before saving, saves through actions.commit (toast «Сохранено» with «Отменить»);
// editing adds «Удалить». Opened with openSheet('operation', {initial?, preset?}).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { KIND_LABEL, addDays, dateInBalances, duplicatesForOperation, journalFact, newId, opAmount, opt, ymOf } from '../../engine';
import type { Data, ISODate, OpKind, Operation } from '../../engine';
import { actions } from '../actions';
import { formatDay, formatMoney } from '../format';
import {
  AmountField, Banner, Button, Chips, Confirm, DateField, Section, Segmented, SelectField, Sheet, TextField,
  useFieldValidity,
} from '../kit';
import type { Option } from '../kit';
import { appData, today } from '../state';
import { outsideYearNote, showInFeed } from './planForm';
import './OperationForm.css';

export interface OperationFormProps {
  open: boolean;
  onClose: () => void;
  /** Editing an existing operation. */
  initial?: Operation;
  /** Prefilled fields for a new operation (e.g. kind 'transfer' from «Счета»). */
  preset?: Partial<Operation>;
}

/** Categories used within this many days before today come first. */
const RECENT_DAYS = 60;

const KINDS: Option<OpKind>[] = (['expense', 'income', 'transfer'] as const).map((k) => ({ value: k, label: KIND_LABEL[k] }));

// ---------- helpers (exported for tests) ----------

/**
 * Category chips for `kind`: categories used by operations and journal rows with a fact (paid or entered,
 * not planned or cancelled ones) of that kind in the last 60 days (today included) first, the most used
 * first (ties keep the list order), then the rest in the list order. `current` (the edited row's category,
 * only while its kind is unchanged) is kept at the end when it is no longer in the list. None for transfers.
 */
export function categoryChoices(data: Data, kind: OpKind, todayDate: ISODate, current?: string): string[] {
  if (kind === 'transfer') return [];
  const names = [...new Set((kind === 'expense' ? data.categories.expense : data.categories.income).map((c) => c.name))];
  const from = addDays(todayDate, -RECENT_DAYS);
  const uses = new Map<string, number>();
  const count = (k: OpKind, category: string | undefined, date: ISODate): void => {
    const c = opt(category);
    if (k !== kind || c === undefined || date < from || date > todayDate) return;
    uses.set(c, (uses.get(c) ?? 0) + 1);
  };
  for (const o of data.operations) count(o.kind, o.category, o.date);
  for (const r of data.journal) if (journalFact(r) > 0) count(r.kind, r.category, r.date);
  const used = names.filter((n) => uses.has(n)).sort((a, b) => (uses.get(b) ?? 0) - (uses.get(a) ?? 0));
  const list = [...used, ...names.filter((n) => !uses.has(n))];
  const kept = opt(current);
  if (kept !== undefined && !list.includes(kept)) list.push(kept);
  return list;
}

/**
 * Default accounts for a new operation of `kind`: those of the last entered operation of that kind
 * whose account still exists (a transfer also takes its «на счёт» when it exists and differs), else the
 * first debit account (else the first account).
 */
export function defaultAccounts(data: Data, kind: OpKind): { account?: string; toAccount?: string } {
  const known = new Set(data.accounts.map((a) => a.id));
  for (let i = data.operations.length - 1; i >= 0; i -= 1) {
    const o = data.operations[i];
    if (!o || o.kind !== kind) continue;
    const account = opt(o.account);
    if (account === undefined || !known.has(account)) continue;
    if (kind !== 'transfer') return { account };
    const to = opt(o.toAccount);
    return to !== undefined && to !== account && known.has(to) ? { account, toAccount: to } : { account };
  }
  const first = data.accounts.find((a) => a.type === 'debit') ?? data.accounts[0];
  return first ? { account: first.id } : {};
}

export interface OperationDraft {
  kind: OpKind;
  amount?: number;
  date?: ISODate;
  account?: string;
  toAccount?: string;
}

export type OperationErrors = Partial<Record<'amount' | 'date' | 'account' | 'toAccount', string>>;

/** Amount above zero, a date; a transfer needs «Со счёта» and a different «На счёт». */
export function validateOperation(d: OperationDraft): OperationErrors {
  const errors: OperationErrors = {};
  if (d.amount === undefined) errors.amount = 'Введите сумму';
  else if (!(d.amount > 0)) errors.amount = 'Сумма должна быть больше нуля';
  if (d.date === undefined) errors.date = 'Укажите дату';
  if (d.kind === 'transfer') {
    if (d.account === undefined) errors.account = 'Выберите счёт';
    if (d.toAccount === undefined) errors.toAccount = 'Выберите счёт';
    else if (d.toAccount === d.account) errors.toAccount = 'Счета должны различаться';
  }
  return errors;
}

/** «Похоже на …» when the engine sees `op` as a possible duplicate, naming what it repeats; else null. */
export function duplicateText(data: Data, op: Operation): string | null {
  const of = duplicatesForOperation(data, op);
  if (of === null) return null;
  const same = (name: string): boolean => name.toLowerCase() === op.what.toLowerCase();
  let text: string;
  switch (of) {
    case 'journal': {
      const amount = opAmount(op);
      const r = data.journal.find((j) => j.date === op.date && journalFact(j) === amount);
      text = r ? `Похоже на плановую запись «${r.what || 'Без названия'}» за ${formatDay(r.date)}` : 'Похоже на плановую запись';
      break;
    }
    case 'recurring':
      text = `Похоже на постоянный платёж «${data.recurring.find((x) => same(x.what))?.what ?? op.what}»`;
      break;
    case 'purchase':
      text = `Похоже на покупку «${data.purchases.find((x) => same(x.what))?.what ?? op.what}»`;
      break;
  }
  return `${text}. Возможно, это дубль.`;
}

/**
 * What an empty «Что» is saved as (and shows as its placeholder): the category, or «Перевод». An edited
 * operation named exactly like that (it was saved with an empty «Что») starts with an empty field, so its
 * name keeps following the category and the kind instead of going stale.
 */
function fallbackWhat(kind: OpKind, category: string | undefined): string {
  return kind === 'transfer' ? 'Перевод' : (category ?? '');
}

// ---------- form ----------

export function OperationForm({ open, onClose, initial, preset }: OperationFormProps) {
  const d = appData();
  const todayDate = today();
  const start: Partial<Operation> = initial ?? preset ?? {};
  const presetAccounts = start.account !== undefined || start.toAccount !== undefined;

  const [kind, setKind] = useState<OpKind>(start.kind ?? 'expense');
  const [amount, setAmount] = useState<number | undefined>(start.amount === undefined ? undefined : Math.abs(start.amount));
  const [category, setCategory] = useState<string | undefined>(opt(start.category));
  const [accounts, setAccounts] = useState<{ account?: string; toAccount?: string }>(() =>
    initial || presetAccounts
      ? { account: opt(start.account), toAccount: opt(start.toAccount) }
      : defaultAccounts(d, start.kind ?? 'expense'),
  );
  // once the user (or the edited row) chose an account, a change of kind keeps it
  const [accountChosen, setAccountChosen] = useState(initial !== undefined || presetAccounts);
  const [date, setDate] = useState<ISODate | undefined>(opt(start.date) ?? todayDate);
  const [what, setWhat] = useState<string | undefined>(() =>
    initial && initial.what === fallbackWhat(initial.kind, opt(initial.category)) ? undefined : opt(start.what),
  );
  const [tried, setTried] = useState(false);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [askDelete, setAskDelete] = useState(false);
  const v = useFieldValidity();
  const duplicateRef = useRef<HTMLDivElement>(null);

  // the row's own category (even one that is no longer in the list) stays offered only for its own kind
  const startKind = start.kind ?? 'expense';
  const keptCategory = kind === startKind ? opt(start.category) : undefined;
  const choices = useMemo(() => categoryChoices(d, kind, todayDate, keptCategory), [d, kind, todayDate, keptCategory]);
  const accountOptions = d.accounts.map((a): Option => ({ value: a.id, label: a.name }));
  const errors = validateOperation({ kind, amount, date, ...accounts });

  useEffect(() => {
    if (duplicate !== null) duplicateRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [duplicate]);

  /** Wraps a setter: any change hides the duplicate warning (the next save checks again). */
  const edited =
    <T,>(set: (value: T) => void) =>
    (value: T): void => {
      setDuplicate(null);
      set(value);
    };

  const changeKind = (k: OpKind): void => {
    setDuplicate(null);
    setKind(k);
    // the category of the other kind is dropped (a transfer has none to show, so it just waits there); the
    // row's own one stays only for its own kind
    if (
      k !== 'transfer' && category !== undefined &&
      !categoryChoices(d, k, todayDate, k === startKind ? opt(start.category) : undefined).includes(category)
    ) {
      setCategory(undefined);
    }
    if (!accountChosen) setAccounts(defaultAccounts(d, k));
  };

  const chooseAccount = (key: 'account' | 'toAccount') => (id: string | undefined) => {
    setDuplicate(null);
    setAccountChosen(true);
    setAccounts((prev) => ({ ...prev, [key]: id }));
  };

  const build = (): Operation => {
    const op: Operation = {
      id: initial?.id ?? newId(),
      date: date ?? todayDate,
      kind,
      what: what?.trim() || fallbackWhat(kind, category),
      amount: amount ?? 0,
    };
    if (kind !== 'transfer' && category !== undefined) op.category = category;
    if (accounts.account !== undefined) op.account = accounts.account;
    if (kind === 'transfer' && accounts.toAccount !== undefined) op.toAccount = accounts.toAccount;
    return op;
  };

  const save = (anyway = false): void => {
    setTried(true);
    if (v.anyInvalid || Object.keys(errors).length > 0) return;
    const current = appData();
    const op = build();
    const dup = duplicateText(current, op);
    // an edited row that already looked like the same thing is not flagged again
    const before = initial ? duplicateText(current, initial) : null;
    if (!anyway && dup !== null && dup !== before && dup !== duplicate) {
      setDuplicate(dup);
      return;
    }
    const exists = initial !== undefined && current.operations.some((o) => o.id === initial.id);
    const operations = exists ? current.operations.map((o) => (o.id === op.id ? op : o)) : [...current.operations, op];
    actions.commit({ ...current, operations }, 'Сохранено', showInFeed(current.settings, ymOf(op.date)));
    onClose();
  };

  const remove = (): void => {
    if (!initial) return;
    const current = appData();
    setAskDelete(false);
    actions.commit({ ...current, operations: current.operations.filter((o) => o.id !== initial.id) }, 'Операция удалена');
    onClose();
  };

  const shown = (name: keyof OperationErrors): string | undefined =>
    tried && !v.isInvalid(name) ? errors[name] : undefined;

  return (
    <Sheet
      open={open}
      title={initial ? 'Операция' : 'Новая операция'}
      onClose={onClose}
      left={
        <Button kind="plain" onClick={onClose}>
          Отмена
        </Button>
      }
      right={
        <Button kind="plain" disabled={v.anyInvalid} onClick={() => save()}>
          Сохранить
        </Button>
      }
    >
      {duplicate !== null && (
        <div ref={duplicateRef} class="opform-duplicate">
          <Banner tone="warning" action={{ label: 'Всё равно сохранить', onClick: () => save(true) }}>
            {duplicate}
          </Banner>
        </div>
      )}

      <div class="opform-amount">
        <Section>
          <AmountField
            label="Сумма"
            value={amount}
            onChange={v.field('amount', edited(setAmount))}
            autoFocus={!initial}
            error={shown('amount')}
          />
        </Section>
      </div>

      <div class="opform-kind">
        <Segmented label="Тип операции" options={KINDS} value={kind} onChange={changeKind} />
      </div>

      {kind !== 'transfer' && (
        <div class="opform-categories">
          <p class="opform-caption" aria-hidden="true">
            Категория
          </p>
          <Chips
            label="Категория"
            options={choices.map((name) => ({ value: name, label: name }))}
            value={category}
            onChange={edited(setCategory)}
          />
        </div>
      )}

      <Section>
        {kind === 'transfer' ? (
          <>
            <SelectField
              label="Со счёта"
              value={accounts.account}
              options={accountOptions}
              onChange={chooseAccount('account')}
              error={shown('account')}
            />
            <SelectField
              label="На счёт"
              value={accounts.toAccount}
              options={accountOptions}
              placeholder="Не выбран"
              onChange={chooseAccount('toAccount')}
              error={shown('toAccount')}
            />
          </>
        ) : (
          <SelectField label="Счёт" value={accounts.account} options={accountOptions} onChange={chooseAccount('account')} />
        )}
        <DateField
          label="Дата"
          value={date}
          onChange={v.field('date', edited(setDate))}
          error={shown('date')}
          hint={date ? outsideYearNote(d.settings, ymOf(date), dateInBalances(date, d.settings)) : undefined}
        />
        <TextField
          label="Что"
          value={what}
          onChange={edited(setWhat)}
          placeholder={fallbackWhat(kind, category) || 'Необязательно'}
          maxLength={200}
        />
      </Section>

      {initial && (
        <div class="opform-delete">
          <Button kind="destructive" full onClick={() => setAskDelete(true)}>
            Удалить
          </Button>
        </div>
      )}

      {initial && (
        <Confirm
          open={askDelete}
          title="Удалить операцию?"
          message={`«${initial.what || 'Без названия'}», ${formatMoney(Math.abs(initial.amount))}`}
          confirmLabel="Удалить"
          onConfirm={remove}
          onCancel={() => setAskDelete(false)}
        />
      )}
    </Sheet>
  );
}
