// «Новый постоянный платёж» / «Постоянный платёж» — openSheet('recurring', {initial?}); owner D5.
// What, kind, category, amount, account, day, «как часто», «действует с / по», and the marks of the
// 12 accounting months: a tap marks a month ✓ (paid as planned) or clears its mark; «Сумма за …»
// writes another amount. Months without a payment (by the rhythm and the dates being edited) are pale.
// A regular transfer (spec 2026-10-01-planned-transfers): «Со счёта» and a different «На счёт», no category; a mark
// is a transfer made. «Доход» on a savings account shows the tracker's hint «Похоже на перевод…».
import { useEffect, useRef, useState } from 'preact/hooks';
import { KIND_LABEL, accountingMonths, monthLabel, newId, opt, recurringDue } from '../../engine';
import type { Data, Mark, Recurring, YM } from '../../engine';
import { actions } from '../actions';
import { formatMoney } from '../format';
import {
  AmountField, Button, Confirm, DateField, Icon, NumberField, Section, Segmented, SelectField, Sheet, TextField,
  useFieldValidity,
} from '../kit';
import type { FieldChange, Option } from '../kit';
import { appData } from '../state';
import { accountOptions, compact, hasErrors, lowerFirst, nameOptions, transferErrors, transferHint, upsert } from './planForm';
import type { Errors } from './planForm';
import './RecurringForm.css';

export interface RecurringFormProps {
  open: boolean;
  onClose: () => void;
  initial?: Recurring;
}

type Kind = Recurring['kind'];
type Marks = Record<YM, Mark>;

const KINDS: Option<Kind>[] = (['expense', 'income', 'transfer'] as const).map((k) => ({ value: k, label: KIND_LABEL[k] }));

const EVERY = [1, 2, 3, 4, 6, 12];

/** «Каждый месяц», «Раз в 2 месяца», «Раз в 6 месяцев», «Раз в год» — the words of the forms (lists: «раз в 2 мес.»). */
export function everyText(n: number): string {
  if (n === 1) return 'Каждый месяц';
  if (n === 12) return 'Раз в год';
  return `Раз в ${n} ${n >= 2 && n <= 4 ? 'месяца' : 'месяцев'}`;
}

/** The rhythms of the tracker's list, plus the current one when it is another (1..12 from an import). */
function everyOptions(current: number): Option[] {
  const values = EVERY.includes(current) ? EVERY : [...EVERY, current].sort((a, b) => a - b);
  return values.map((n) => ({ value: String(n), label: everyText(n) }));
}

/** An empty month becomes ✓; a month with any mark (✓ or an amount) becomes empty. A new object. */
export function toggleMark(marks: Marks, ym: YM): Marks {
  const next = { ...marks };
  if (next[ym] === undefined) next[ym] = '✓';
  else delete next[ym];
  return next;
}

function setMark(marks: Marks, ym: YM, amount: number | undefined): Marks {
  const next = { ...marks };
  if (amount === undefined) delete next[ym];
  else next[ym] = amount;
  return next;
}

/** The account a new payment starts with: the first debit card, else the first that is not a credit card. */
function defaultAccount(d: Data): string | undefined {
  return (d.accounts.find((a) => a.type === 'debit') ?? d.accounts.find((a) => a.type !== 'credit') ?? d.accounts[0])?.id;
}

type Field = 'what' | 'amount' | 'day' | 'to' | 'account' | 'toAccount';

export function RecurringForm({ open, onClose, initial }: RecurringFormProps) {
  const d = appData();
  const [kind, setKind] = useState<Kind>(initial?.kind ?? 'expense');
  const [what, setWhat] = useState<string | undefined>(initial?.what || undefined);
  const [category, setCategory] = useState<string | undefined>(opt(initial?.category));
  const [amount, setAmount] = useState<number | undefined>(initial?.amount);
  const [account, setAccount] = useState<string | undefined>(initial ? opt(initial.account) : defaultAccount(d));
  const [toAccount, setToAccount] = useState<string | undefined>(opt(initial?.toAccount));
  const [day, setDay] = useState<number | undefined>(initial?.day);
  const [every, setEvery] = useState<number>(Math.max(1, initial?.every ?? 1));
  const [from, setFrom] = useState<string | undefined>(opt(initial?.from));
  const [to, setTo] = useState<string | undefined>(opt(initial?.to));
  const [marks, setMarks] = useState<Marks>(initial?.marks ?? {});
  const [editing, setEditing] = useState<YM | null>(null);
  const [tried, setTried] = useState(false);
  const [asking, setAsking] = useState(false);
  const v = useFieldValidity();

  const categories = (k: Kind) => (k === 'income' ? d.categories.income : d.categories.expense).map((c) => c.name);
  const transfer = kind === 'transfer';

  const validate = (): Errors<Field> => ({
    what: what?.trim() ? undefined : 'Введите название',
    amount: amount !== undefined && amount > 0 ? undefined : 'Введите сумму',
    day: day !== undefined ? undefined : 'Укажите день',
    to: from !== undefined && to !== undefined && to < from ? 'Не раньше даты начала' : undefined,
    ...transferErrors({ kind, account, toAccount }),
  });
  const errors: Errors<Field> = tried ? validate() : {};

  const changeKind = (k: Kind) => {
    // the category goes only when it is in the old kind's list and not in the new one; a category in
    // neither list (typed in the tracker) is kept, like everywhere else in this form
    if (category !== undefined && categories(kind).includes(category) && !categories(k).includes(category)) {
      setCategory(undefined);
    }
    setKind(k);
  };

  const save = () => {
    setTried(true);
    if (v.anyInvalid || hasErrors(validate())) return;
    const rec = compact<Recurring>({
      ...initial,
      id: initial?.id ?? newId(),
      what: (what ?? '').trim(),
      kind,
      category: transfer ? undefined : category,
      amount: amount ?? 0,
      day,
      every: every > 1 ? every : undefined,
      from,
      to,
      account,
      toAccount: transfer ? toAccount : undefined,
      marks,
    });
    const cur = appData();
    actions.commit({ ...cur, recurring: upsert(cur.recurring, rec) }, 'Сохранено');
    onClose();
  };

  const remove = () => {
    setAsking(false);
    if (!initial) return;
    const cur = appData();
    actions.commit({ ...cur, recurring: cur.recurring.filter((r) => r.id !== initial.id) }, 'Платёж удалён');
    onClose();
  };

  // the payment as it is being edited decides which months are due
  const draft: Recurring = { id: '', what: '', kind, amount: amount ?? 0, every, from, to, marks };
  const months = accountingMonths(d.settings);

  return (
    <Sheet
      open={open}
      title={initial ? 'Постоянный платёж' : 'Новый постоянный платёж'}
      onClose={onClose}
      left={
        <Button kind="plain" onClick={onClose}>
          Отмена
        </Button>
      }
      right={
        <Button kind="plain" onClick={save} disabled={v.anyInvalid}>
          Сохранить
        </Button>
      }
    >
      <div class="recurring-form-kind">
        <Segmented label="Тип" options={KINDS} value={kind} onChange={changeKind} />
      </div>
      <Section>
        <TextField
          label="Что"
          value={what}
          onChange={setWhat}
          placeholder="Аренда, связь, зарплата"
          error={errors.what}
          autoFocus={!initial}
        />
        {!transfer && (
          <SelectField
            label="Категория"
            value={category}
            options={nameOptions(categories(kind), category)}
            onChange={setCategory}
            placeholder="Без категории"
          />
        )}
        <AmountField label="Сумма" value={amount} onChange={v.field('amount', setAmount)} error={errors.amount} />
        {transfer ? (
          <>
            <SelectField
              label="Со счёта"
              value={account}
              options={accountOptions(d, account)}
              onChange={setAccount}
              placeholder="Не выбран"
              error={errors.account}
            />
            <SelectField
              label="На счёт"
              value={toAccount}
              options={accountOptions(d, toAccount)}
              onChange={setToAccount}
              placeholder="Не выбран"
              error={errors.toAccount}
            />
          </>
        ) : (
          <SelectField
            label="Счёт"
            value={account}
            options={accountOptions(d, account)}
            onChange={setAccount}
            placeholder="Без счёта"
            hint={transferHint(d, kind, account)}
          />
        )}
      </Section>
      <Section footer="Пустые даты — платёж действует всегда. День 31 в коротком месяце — последний день.">
        <NumberField
          label="День"
          value={day}
          min={1}
          max={31}
          onChange={v.field('day', setDay)}
          error={errors.day}
          placeholder="1–31"
        />
        <SelectField
          label="Как часто"
          value={String(every)}
          options={everyOptions(every)}
          onChange={(s) => setEvery(Number(s ?? '1'))}
        />
        <DateField label="Действует с" value={from} onChange={v.field('from', setFrom)} />
        <DateField label="Действует по" value={to} min={from} onChange={v.field('to', setTo)} error={errors.to} />
      </Section>
      <Section
        header="Отметки по месяцам"
        footer="✓ — оплачено по плану, сумма — оплачено столько. Бледные месяцы — без списания."
      >
        <div class="recurring-form-marks" role="group" aria-label="Отметки по месяцам">
          {months.map((ym) => (
            <MarkCell
              key={ym}
              ym={ym}
              mark={marks[ym]}
              due={recurringDue(draft, ym, d.settings)}
              editing={editing === ym}
              onToggle={() => setMarks((m) => toggleMark(m, ym))}
              onEdit={() => setEditing(ym)}
            />
          ))}
        </div>
        {editing !== null && (
          <MarkEditor
            ym={editing}
            value={markAmount(marks[editing], amount)}
            onChange={v.field(`mark-${editing}`, (n) => setMarks((m) => setMark(m, editing, n)))}
            onDone={() => setEditing(null)}
          />
        )}
      </Section>
      {initial && (
        <div class="sheet-actions">
          <Button kind="destructive" full onClick={() => setAsking(true)}>
            Удалить платёж
          </Button>
        </div>
      )}
      <Confirm
        open={asking}
        title="Удалить постоянный платёж?"
        message="Отметки по месяцам удалятся вместе с ним."
        confirmLabel="Удалить"
        onConfirm={remove}
        onCancel={() => setAsking(false)}
      />
    </Sheet>
  );
}

/** The amount the editor of a month starts from: its own amount, or the plan for ✓. */
function markAmount(mark: Mark | undefined, amount: number | undefined): number | undefined {
  if (mark === undefined) return undefined;
  return mark === '✓' ? amount : mark;
}

interface MarkEditorProps {
  ym: YM;
  value: number | undefined;
  onChange: FieldChange<number>;
  onDone: () => void;
}

/** «Оплачено за <месяц>»: another amount for one month; it sits under the grid and scrolls into view. */
function MarkEditor({ ym, value, onChange, onDone }: MarkEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [ym]);
  return (
    <div ref={ref} class="recurring-form-editor">
      <AmountField key={ym} label={`Оплачено за ${lowerFirst(monthLabel(ym))}`} value={value} onChange={onChange} autoFocus />
      <div class="recurring-form-editor-done">
        <Button kind="plain" onClick={onDone}>
          Готово
        </Button>
      </div>
    </div>
  );
}

interface MarkCellProps {
  ym: YM;
  mark: Mark | undefined;
  due: boolean;
  editing: boolean;
  onToggle: () => void;
  onEdit: () => void;
}

function MarkCell({ ym, mark, due, editing, onToggle, onEdit }: MarkCellProps) {
  const label = monthLabel(ym);
  const month = label.split(' ')[0];
  const shown = mark === undefined ? '–' : mark === '✓' ? '✓' : formatMoney(mark);
  const state = mark === undefined ? 'не отмечено' : mark === '✓' ? 'оплачено' : formatMoney(mark);
  const cls = [
    'recurring-form-mark',
    due ? '' : 'recurring-form-mark-off',
    mark === undefined ? '' : 'recurring-form-mark-set',
    editing ? 'recurring-form-mark-editing' : '',
  ].filter(Boolean).join(' ');
  return (
    <div class={cls}>
      <button
        type="button"
        class="recurring-form-mark-toggle"
        aria-label={`${label}: ${due ? '' : 'без списания, '}${state}`}
        onClick={onToggle}
      >
        <span class="recurring-form-mark-month">{month}</span>
        <span class="recurring-form-mark-value">{shown}</span>
      </button>
      <button
        type="button"
        class="recurring-form-mark-edit"
        aria-label={`Сумма за ${lowerFirst(label)}`}
        aria-expanded={editing}
        onClick={onEdit}
      >
        <Icon name="edit" size={16} />
      </button>
    </div>
  );
}
