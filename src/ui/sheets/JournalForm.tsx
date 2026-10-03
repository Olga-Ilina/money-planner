// A planned expense, income or transfer — a journal row (spec §3, §5; transfers: spec 2026-10-01-planned-transfers):
// kind, category, what, date, plan, fact, status, account («Со счёта» and «На счёт» for a transfer, which has no
// category), priority and the accounting month. openSheet('journal', {initial?, preset?}).
// Validation: «Что» and the date are required; a plan or a fact that is not zero (a refund is a negative
// amount, in the plan or in the fact) unless the row is cancelled; a transfer needs «Со счёта» and another «На счёт».
// «Доход» on a savings account shows the tracker's hint «Похоже на перевод…». Editing adds «Удалить» (asked first, undoable).
import { useState } from 'preact/hooks';
import {
  JOURNAL_STATUS_LABEL, KIND_LABEL, PRIORITIES, accountingMonthOf, accountingMonths, journalMonth, monthInBalances, monthLabel, newId,
  ymOf,
} from '../../engine';
import type { Data, ISODate, JournalRow, JournalStatus, YM } from '../../engine';
import { actions } from '../actions';
import {
  AmountField, Button, Confirm, DateField, Section, Segmented, SelectField, Sheet, TextField, useFieldValidity,
} from '../kit';
import type { Option } from '../kit';
import { accountName, appData, today } from '../state';
import { outsideYearNote, showInFeed, transferErrors, transferHint } from './planForm';
import './JournalForm.css';

export interface JournalFormProps {
  open: boolean;
  onClose: () => void;
  initial?: JournalRow;
  preset?: Partial<JournalRow>;
}

type Kind = JournalRow['kind'];

/** What the form holds; every optional field is absent (never '') when not set. */
export interface JournalDraft {
  kind: Kind;
  category?: string;
  what?: string;
  date?: ISODate;
  plan?: number;
  fact?: number;
  status?: JournalStatus;
  account?: string;
  toAccount?: string;
  priority?: string;
  month?: YM;
}

export interface JournalErrors {
  what?: string;
  date?: string;
  amount?: string;
  account?: string;
  toAccount?: string;
}

/** The status a journal row counts with: an empty status is «paid» once a fact is entered (as in the tracker). */
export function journalStatus(r: Pick<JournalRow, 'status' | 'fact'>): JournalStatus {
  return r.status ?? (r.fact !== undefined ? 'paid' : 'planned');
}

/** Where a payment goes by default: the first debit account, else the first that is not a credit card. */
export function defaultAccountId(d: Data): string | undefined {
  return (d.accounts.find((a) => a.type === 'debit') ?? d.accounts.find((a) => a.type !== 'credit') ?? d.accounts[0])?.id;
}

const KINDS: Option<Kind>[] = (['expense', 'income', 'transfer'] as const).map((k) => ({ value: k, label: KIND_LABEL[k] }));

const MONTH_NOTE =
  'Месяц учёта — если запись относится к другому месяцу, чем её дата (например, зарплата 30-го за следующий месяц).';

/** Under «Факт» when the status is not «Оплачено» but a fact is entered: the engine counts that fact as paid. */
const FACT_HINT = 'Сумма факт учитывается как оплата. Очистите поле, если оплаты не было.';

const STATUSES: Option<JournalStatus>[] = (['planned', 'paid', 'postponed', 'cancelled'] as const).map((s) => ({
  value: s,
  label: JOURNAL_STATUS_LABEL[s],
}));

/**
 * «Что» and the date are required; a plan or a fact that is not zero (a refund is negative), unless cancelled; a
 * transfer needs «Со счёта» and a different «На счёт».
 */
export function validateJournal(d: JournalDraft): JournalErrors {
  const errors: JournalErrors = {};
  if (!d.what?.trim()) errors.what = 'Введите название';
  if (!d.date) errors.date = 'Укажите дату';
  const hasAmount = (d.plan !== undefined && d.plan !== 0) || (d.fact !== undefined && d.fact !== 0);
  if (!hasAmount && d.status !== 'cancelled') errors.amount = 'Укажите план или факт';
  return { ...errors, ...transferErrors(d) };
}

/**
 * The row to store: only the fields that are set; the month only when it differs from the date's. A transfer keeps
 * «На счёт» and no category; another kind no «На счёт».
 */
export function journalFromDraft(d: JournalDraft, id: string): JournalRow {
  const date = d.date ?? '';
  const row: JournalRow = { id, date, kind: d.kind, what: (d.what ?? '').trim() };
  if (d.category !== undefined && d.kind !== 'transfer') row.category = d.category;
  if (d.plan !== undefined) row.plan = d.plan;
  if (d.fact !== undefined) row.fact = d.fact;
  if (d.status !== undefined) row.status = d.status;
  if (d.account !== undefined) row.account = d.account;
  if (d.toAccount !== undefined && d.kind === 'transfer') row.toAccount = d.toAccount;
  if (d.priority !== undefined) row.priority = d.priority;
  if (d.month !== undefined && d.month !== ymOf(date)) row.month = d.month;
  return row;
}

/** The options, plus the current value when it is not among them (a renamed category, an old month). */
function withCurrent<T extends string>(
  options: Option<T>[],
  value: T | undefined,
  label: (v: T) => string = (v) => v,
): Option<T>[] {
  if (value === undefined || options.some((o) => o.value === value)) return options;
  return [...options, { value, label: label(value) }];
}

/** An empty string (e.g. from an old import) counts as not set. */
const given = <T extends string>(v: T | undefined): T | undefined => (v === '' ? undefined : v);

function startDraft(d: Data, initial: JournalRow | undefined, preset: Partial<JournalRow> | undefined): JournalDraft {
  if (initial) {
    return {
      kind: initial.kind,
      category: given(initial.category),
      what: initial.what,
      date: given(initial.date),
      plan: initial.plan,
      fact: initial.fact,
      status: initial.status,
      account: given(initial.account),
      toAccount: given(initial.toAccount),
      priority: given(initial.priority),
      month: given(initial.month),
    };
  }
  return {
    kind: preset?.kind ?? 'expense',
    category: given(preset?.category),
    what: given(preset?.what),
    date: given(preset?.date) ?? today(),
    plan: preset?.plan,
    fact: preset?.fact,
    status: preset?.status,
    account: given(preset?.account) ?? defaultAccountId(d),
    toAccount: given(preset?.toAccount),
    priority: given(preset?.priority),
    month: given(preset?.month),
  };
}

export function JournalForm({ open, onClose, initial, preset }: JournalFormProps) {
  const [draft, setDraft] = useState<JournalDraft>(() => startDraft(appData(), initial, preset));
  const [tried, setTried] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const v = useFieldValidity();
  const d = appData();

  const setter = <K extends keyof JournalDraft>(key: K) => (value: JournalDraft[K] | undefined) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const errors = tried ? validateJournal(draft) : {};
  // where the row counts: its own accounting month while that is one of the 12, else its date's month (the engine's rule)
  const countedIn = draft.date ? accountingMonthOf(draft.date, draft.month, d.settings) : undefined;
  const dateNote = countedIn ? outsideYearNote(d.settings, countedIn, monthInBalances(countedIn, d.settings)) : undefined;
  // an empty status is shown as what it counts as (paid once a fact is entered)
  const shownStatus = journalStatus(draft);

  const transfer = draft.kind === 'transfer';
  const names = (draft.kind === 'income' ? d.categories.income : d.categories.expense).map((c) => c.name);
  const categories = withCurrent(names.map((n) => ({ value: n, label: n })), draft.category);
  const priorities = withCurrent(PRIORITIES.map((p) => ({ value: p as string, label: p })), draft.priority);
  const accountChoices = (current: string | undefined) => withCurrent(
    d.accounts.map((a) => ({ value: a.id, label: a.name })),
    current,
    (id) => accountName(d, id),
  );
  const months = withCurrent(
    accountingMonths(d.settings).map((m) => ({ value: m, label: monthLabel(m) })),
    draft.month,
    monthLabel,
  );

  // a category of the old kind's list does not carry over (unless the new list has it too); one that is in
  // neither list (renamed, deleted) is kept: the form must not silently rewrite it (a transfer has no category: its
  // list is the expenses' as in the tracker, and the category is not saved with it)
  const changeKind = (kind: Kind) => {
    const names = (k: Kind) => (k === 'income' ? d.categories.income : d.categories.expense).map((c) => c.name);
    const category = draft.category;
    const drop = category !== undefined && names(draft.kind).includes(category) && !names(kind).includes(category);
    setDraft((prev) => ({ ...prev, kind, category: drop ? undefined : prev.category }));
  };

  const save = () => {
    if (v.anyInvalid) return;
    if (Object.keys(validateJournal(draft)).length > 0) {
      setTried(true);
      return;
    }
    // a new row stores the status it is shown with; an edited one keeps an empty status untouched
    const status = draft.status ?? (initial ? undefined : shownStatus);
    const cur = appData();
    const row = journalFromDraft({ ...draft, status }, initial?.id ?? newId());
    const exists = initial !== undefined && cur.journal.some((r) => r.id === initial.id);
    const journal = exists ? cur.journal.map((r) => (r.id === row.id ? row : r)) : [...cur.journal, row];
    onClose();
    actions.commit({ ...cur, journal }, 'Сохранено', showInFeed(cur.settings, journalMonth(row, cur.settings)));
  };

  const remove = () => {
    setAskDelete(false);
    if (!initial) return;
    const cur = appData();
    onClose();
    actions.commit({ ...cur, journal: cur.journal.filter((r) => r.id !== initial.id) }, 'Запись удалена');
  };

  return (
    <>
      <Sheet
        open={open}
        title={initial ? 'Плановая запись' : 'Новая плановая запись'}
        onClose={onClose}
        left={
          <Button kind="plain" onClick={onClose}>
            Отмена
          </Button>
        }
        right={
          <Button kind="plain" disabled={v.anyInvalid} onClick={save}>
            Сохранить
          </Button>
        }
      >
        <div class="journal-form-kind">
          <Segmented label="Тип записи" options={KINDS} value={draft.kind} onChange={changeKind} />
        </div>
        <Section>
          <TextField
            label="Что"
            value={draft.what}
            onChange={setter('what')}
            placeholder="Например, врач"
            error={errors.what}
          />
          {!transfer && (
            <SelectField
              label="Категория"
              value={draft.category}
              options={categories}
              placeholder="Без категории"
              onChange={setter('category')}
            />
          )}
          <DateField
            label="Дата"
            value={draft.date}
            onChange={v.field('date', setter('date'))}
            error={errors.date}
            hint={dateNote}
          />
        </Section>
        <Section footer="Факт — сколько заплачено на самом деле. Возврат — сумма со знаком минус, в плане или в факте.">
          <AmountField
            label="План"
            value={draft.plan}
            allowNegative
            onChange={v.field('plan', setter('plan'))}
            error={errors.amount}
          />
          <AmountField
            label="Факт"
            value={draft.fact}
            allowNegative
            onChange={v.field('fact', setter('fact'))}
            hint={shownStatus !== 'paid' && draft.fact !== undefined ? FACT_HINT : undefined}
          />
          <SelectField label="Статус" value={shownStatus} options={STATUSES} onChange={setter('status')} />
        </Section>
        <Section footer={MONTH_NOTE}>
          {transfer ? (
            <>
              <SelectField
                label="Со счёта"
                value={draft.account}
                options={accountChoices(draft.account)}
                placeholder="Не выбран"
                onChange={setter('account')}
                error={errors.account}
              />
              <SelectField
                label="На счёт"
                value={draft.toAccount}
                options={accountChoices(draft.toAccount)}
                placeholder="Не выбран"
                onChange={setter('toAccount')}
                error={errors.toAccount}
              />
            </>
          ) : (
            <SelectField
              label="Счёт"
              value={draft.account}
              options={accountChoices(draft.account)}
              placeholder="Без счёта"
              onChange={setter('account')}
              hint={transferHint(d, draft.kind, draft.account)}
            />
          )}
          <SelectField
            label="Приоритет"
            value={draft.priority}
            options={priorities}
            placeholder="Не указан"
            onChange={setter('priority')}
          />
          <SelectField
            label="Месяц учёта"
            value={draft.month}
            options={months}
            placeholder="Как у даты"
            onChange={setter('month')}
          />
        </Section>
        {initial && (
          <div class="sheet-actions journal-form-delete">
            <Button kind="destructive" full onClick={() => setAskDelete(true)}>
              Удалить
            </Button>
          </div>
        )}
      </Sheet>
      <Confirm
        open={askDelete && open}
        title="Удалить запись?"
        message="Запись пропадёт из ленты и из расчётов."
        confirmLabel="Удалить"
        onConfirm={remove}
        onCancel={() => setAskDelete(false)}
      />
    </>
  );
}
