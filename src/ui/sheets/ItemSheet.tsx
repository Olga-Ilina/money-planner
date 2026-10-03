// Card of one record (spec §5 «касание — карточка»), opened with openSheet('item', {item}) from
// «Лента» and «Сегодня»; `item` is null while closed. It shows the record and what can be done with
// it, by source: a journal row — «Оплачено» (with the fact; «Переведено» for a transfer), «Перенести», «Пометить
// отменённой», and «Снять оплату» once paid; a recurring payment — the month's mark (✓ or an amount; the account it
// lacks is saved in the payment) or «Снять отметку»; a purchase — «Куплено» (with the price and the account it needs); every record —
// «Изменить» (its form) and «Удалить» (asked first). A transfer shows «Со счёта» and «На счёт» (paying asks for the
// one it lacks); the tracker's check of a row («Перевод: укажите «На счёт»», …) is said on top. Every change is one
// commit with «Отменить» in the toast.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import {
  JOURNAL_STATUS_LABEL, KIND_LABEL, ROW_CHECK_LABEL, addDays, duplicatesForJournal, duplicatesForOperation, inAccountingYear, journalFact,
  journalMonth, markPaid, marksInBalances, monthLabel, opAmount, purchaseFact, recurringDate, recurringFact, rowCheck, ymOf,
} from '../../engine';
import type { Data, DuplicateOf, FeedSource, ISODate, JournalRow, OpKind, Operation, Purchase, Recurring, YM } from '../../engine';
import { actions } from '../actions';
import { formatDate, formatDay } from '../format';
import {
  AmountField, Banner, Button, Confirm, DateField, EmptyState, Money, Row, Section, SelectField, Sheet,
  useFieldValidity,
} from '../kit';
import { accountName, appData, data, feedMonth, today } from '../state';
import { openSheet } from './host';
import { defaultAccountId, journalStatus } from './JournalForm';
import { knownAccount } from './planForm';
import { everyText } from './RecurringForm';
import './ItemSheet.css';

export interface ItemRef {
  source: FeedSource;
  id: string;
  /** Month of a recurring payment (which month's mark); the month shown in «Лента» when absent. */
  ym?: YM;
}

export interface ItemSheetProps {
  item: ItemRef | null;
  onClose: () => void;
}

/** A record's name: what it is, else its category, else «Перевод» / «Без названия». */
export function itemTitle(item: { what: string; category?: string; kind: OpKind }): string {
  const what = item.what.trim();
  if (what) return what;
  if (item.category) return item.category;
  return item.kind === 'transfer' ? 'Перевод' : 'Без названия';
}

const DUPLICATE_TEXT: Record<DuplicateOf, string> = {
  journal: 'Возможный дубль: есть плановая запись с той же датой и суммой.',
  recurring: 'Возможный дубль: так же называется постоянный платёж.',
  purchase: 'Возможный дубль: так же называется покупка.',
};

const accountOptions = (d: Data) => d.accounts.map((a) => ({ value: a.id, label: a.name }));

/** Replaces the row with id `id` (rows are never changed in place). */
function replaceRow<T extends { id: string }>(rows: T[], id: string, change: (row: T) => T): T[] {
  return rows.map((r) => (r.id === id ? change(r) : r));
}

type Found =
  | { source: 'journal'; row: JournalRow }
  | { source: 'recurring'; row: Recurring }
  | { source: 'purchase'; row: Purchase }
  | { source: 'operation'; row: Operation };

function findRecord(d: Data, ref: ItemRef): Found | null {
  const by = <T extends { id: string }>(rows: T[]) => rows.find((r) => r.id === ref.id);
  switch (ref.source) {
    case 'journal': {
      const row = by(d.journal);
      return row ? { source: 'journal', row } : null;
    }
    case 'recurring': {
      const row = by(d.recurring);
      return row ? { source: 'recurring', row } : null;
    }
    case 'purchase': {
      const row = by(d.purchases);
      return row ? { source: 'purchase', row } : null;
    }
    case 'operation': {
      const row = by(d.operations);
      return row ? { source: 'operation', row } : null;
    }
  }
}

/** The sheet's title: what kind of record it is (the name itself is in the card, wrapped in full). */
const SOURCE_TITLES: Record<FeedSource, string> = {
  journal: 'Плановая запись',
  recurring: 'Постоянный платёж',
  purchase: 'Покупка',
  operation: 'Операция',
};

/** A destructive question asked from a card (rendered outside the sheet, so it closes with it). */
interface Ask {
  title: string;
  message: string;
  run: () => void;
}

interface CardProps {
  d: Data;
  close: () => void;
  ask: (a: Ask) => void;
}

export function ItemSheet({ item, onClose }: ItemSheetProps) {
  const d = data.value;
  const found = item && d ? findRecord(d, item) : null;
  const [ask, setAsk] = useState<Ask | null>(null);
  const [askOpen, setAskOpen] = useState(false);

  const askFirst = (a: Ask) => {
    setAsk(a);
    setAskOpen(true);
  };

  let body: ComponentChildren;
  if (!found || !d || !item) {
    body = <EmptyState title="Запись не найдена" text="Возможно, её уже удалили." />;
  } else {
    const props: CardProps = { d, close: onClose, ask: askFirst };
    switch (found.source) {
      case 'journal':
        body = <JournalCard {...props} r={found.row} />;
        break;
      case 'recurring':
        body = <RecurringCard {...props} rec={found.row} ym={item.ym ?? feedMonth.value} />;
        break;
      case 'purchase':
        body = <PurchaseCard {...props} p={found.row} />;
        break;
      case 'operation':
        body = <OperationCard {...props} o={found.row} />;
        break;
    }
  }

  return (
    <>
      <Sheet
        open={item !== null}
        title={found ? SOURCE_TITLES[found.source] : 'Запись'}
        onClose={onClose}
        left={
          <Button kind="plain" onClick={onClose}>
            Закрыть
          </Button>
        }
      >
        {body}
      </Sheet>
      <Confirm
        open={askOpen && item !== null}
        title={ask?.title ?? ''}
        message={ask?.message}
        confirmLabel="Удалить"
        onConfirm={() => {
          setAskOpen(false);
          ask?.run();
        }}
        onCancel={() => setAskOpen(false)}
      />
    </>
  );
}

// ---------- building blocks ----------

function Head({ amount, income, name, meta }: { amount: number; income?: boolean; name: string; meta: string }) {
  return (
    <div class="item-sheet-head">
      <p class={`item-sheet-amount${income ? ' tone-green' : ''}`}>
        <Money value={amount} tone="plain" signed={income} />
      </p>
      <p class="item-sheet-name">{name}</p>
      <p class="item-sheet-meta">{meta}</p>
    </div>
  );
}

function DuplicateNote({ of }: { of: DuplicateOf | null }) {
  return of ? <Banner tone="warning">{DUPLICATE_TEXT[of]}</Banner> : null;
}

/** The tracker's check of the row's type and accounts, in its words (none: nothing shown). */
function CheckNote({ d, row }: { d: Data; row: { kind: OpKind; account?: string; toAccount?: string } }) {
  const check = rowCheck(d, row);
  return check ? <Banner tone="warning">{ROW_CHECK_LABEL[check]}</Banner> : null;
}

/** «Счёт», or «Со счёта» and «На счёт» of a transfer («не указан» for one it lacks). */
function AccountRows({ d, row }: { d: Data; row: { kind: OpKind; account?: string; toAccount?: string } }) {
  if (row.kind !== 'transfer') return row.account ? <Row title="Счёт" value={accountName(d, row.account)} /> : null;
  return (
    <>
      <Row title="Со счёта" value={accountName(d, row.account) || 'не указан'} />
      <Row title="На счёт" value={accountName(d, row.toAccount) || 'не указан'} />
    </>
  );
}

/** «Изменить», «Удалить» and the like: a list of tappable rows under the card. */
function ActionRow({ label, onClick, destructive }: { label: string; onClick: () => void; destructive?: boolean }) {
  const title = destructive ? label : <span class="item-sheet-action">{label}</span>;
  return <Row title={title} onClick={onClick} destructive={destructive} />;
}

const money = (n: number) => <Money value={n} tone="plain" />;

/** «Расход · 5 октября». */
function kindAndDate(kind: OpKind, date: ISODate | undefined): string {
  return date ? `${KIND_LABEL[kind]} · ${formatDay(date)}` : KIND_LABEL[kind];
}

/**
 * «Счёт» for paying a record that has none (a paid row without an account is missing from every balance).
 * A purchase must have one (`required`): the empty choice is then «Не выбран», not «Без счёта», and
 * nothing is chosen for the user.
 */
function PayAccount({
  d, value, onChange, required, error, hint, label = 'Счёт',
}: {
  d: Data; value?: string; onChange: (id: string | undefined) => void; required?: boolean; error?: string; hint?: string; label?: string;
}) {
  return (
    <SelectField
      label={label}
      value={value}
      options={accountOptions(d)}
      placeholder={required ? 'Не выбран' : 'Без счёта'}
      onChange={onChange}
      error={error}
      hint={hint}
    />
  );
}

// ---------- journal ----------

function JournalCard({ d, close, ask, r }: CardProps & { r: JournalRow }) {
  const status = journalStatus(r);
  const payable = status === 'planned' || status === 'postponed';
  const income = r.kind === 'income';
  const transfer = r.kind === 'transfer';
  const paidLabel = income ? 'Получено' : transfer ? 'Переведено' : 'Оплачено';
  const v = useFieldValidity();
  const [mode, setMode] = useState<'card' | 'postpone'>('card');
  const [fact, setFact] = useState<number | undefined>(r.fact ?? r.plan);
  // no account, or a deleted one (as good as none): paying asks for one (a transfer also for «На счёт»)
  const lacksAccount = knownAccount(d, r.account) === undefined;
  const lacksTo = transfer && knownAccount(d, r.toAccount) === undefined;
  const [account, setAccount] = useState<string | undefined>(lacksAccount ? defaultAccountId(d) : undefined);
  const [toAccount, setToAccount] = useState<string | undefined>(undefined);
  const [payTried, setPayTried] = useState(false);
  // postponing means later: a week after the row's date, or after today when it is overdue
  const [newDate, setNewDate] = useState<ISODate | undefined>(() => addDays(r.date > today() ? r.date : today(), 7));
  const [moveTried, setMoveTried] = useState(false);

  const payError = fact === undefined ? 'Введите сумму' : fact === 0 ? 'Сумма не может быть нулевой' : undefined;
  const month = journalMonth(r, d.settings);
  // an accounting month of its own (one of the 12) stays with the row when it moves
  const ownMonth = r.month && inAccountingYear(r.month, d.settings) ? r.month : undefined;
  const leavesYear = ownMonth === undefined && newDate !== undefined && !inAccountingYear(ymOf(newDate), d.settings);
  const shownFact = r.fact ?? (status === 'paid' ? journalFact(r) : undefined);

  const change = (next: (row: JournalRow) => JournalRow, message: string) => {
    const cur = appData();
    close();
    actions.commit({ ...cur, journal: replaceRow(cur.journal, r.id, next) }, message);
  };

  const pay = () => {
    if (v.anyInvalid) return;
    if (payError) {
      setPayTried(true);
      return;
    }
    let next = markPaid(appData(), { source: 'journal', id: r.id }, fact);
    if (lacksAccount && account) next = { ...next, journal: replaceRow(next.journal, r.id, (x) => ({ ...x, account })) };
    if (lacksTo && toAccount) next = { ...next, journal: replaceRow(next.journal, r.id, (x) => ({ ...x, toAccount })) };
    close();
    actions.commit(next, paidLabel);
  };

  const postpone = () => {
    if (v.anyInvalid) return;
    if (!newDate) {
      setMoveTried(true);
      return;
    }
    change((x) => ({ ...x, status: 'postponed', date: newDate }), `Перенесено на ${formatDay(newDate)}`);
  };

  const cancel = () => change((x) => ({ ...x, status: 'cancelled' }), 'Запись отменена');

  // back to «Запланировано» without the fact (a fact counts as paid whatever the status says); a row that
  // had only a fact keeps that amount as its plan, so un-paying never loses the number
  const unpay = () =>
    change((x): JournalRow => {
      const { fact, ...rest } = x;
      return { ...rest, status: 'planned', ...(x.plan === undefined && fact !== undefined ? { plan: fact } : {}) };
    }, 'Оплата снята');

  const remove = () =>
    ask({
      title: 'Удалить запись?',
      message: 'Запись пропадёт из ленты и из расчётов.',
      run: () => {
        const cur = appData();
        close();
        actions.commit({ ...cur, journal: cur.journal.filter((x) => x.id !== r.id) }, 'Запись удалена');
      },
    });

  return (
    <>
      <Head amount={r.fact ?? r.plan ?? 0} income={income} name={itemTitle(r)} meta={kindAndDate(r.kind, r.date)} />
      <CheckNote d={d} row={r} />
      <DuplicateNote of={duplicatesForJournal(d, r)} />
      <Section>
        <Row title="Статус" value={JOURNAL_STATUS_LABEL[status]} />
        {r.plan !== undefined && <Row title="План" value={money(r.plan)} />}
        {shownFact !== undefined && <Row title="Факт" value={money(shownFact)} />}
        {r.category && !transfer && <Row title="Категория" value={r.category} />}
        <AccountRows d={d} row={r} />
        {r.priority && <Row title="Приоритет" value={r.priority} />}
        {month !== ymOf(r.date) && <Row title="Месяц учёта" value={monthLabel(month)} />}
      </Section>

      {mode === 'postpone' ? (
        <>
          <Section header="Перенести" footer="Запись останется в плане со статусом «Перенесено».">
            <DateField
              label="Новая дата"
              value={newDate}
              onChange={v.field('newDate', setNewDate)}
              error={moveTried && !newDate ? 'Укажите дату' : undefined}
              hint={ownMonth ? `Месяц учёта останется: ${monthLabel(ownMonth).toLowerCase()}` : undefined}
            />
          </Section>
          {leavesYear && <Banner tone="warning">Дата вне учётного года — запись пропадёт из ленты</Banner>}
          <div class="sheet-actions item-sheet-actions">
            <Button full disabled={v.anyInvalid} onClick={postpone}>
              {newDate ? `Перенести на ${formatDay(newDate)}` : 'Перенести'}
            </Button>
            <Button kind="plain" full onClick={() => setMode('card')}>
              Назад
            </Button>
          </div>
        </>
      ) : (
        <>
          {payable && (
            <>
              <Section>
                <AmountField
                  label="Сумма факт"
                  value={fact}
                  allowNegative
                  onChange={v.field('fact', setFact)}
                  error={payTried ? payError : undefined}
                />
                {lacksAccount && (
                  <PayAccount d={d} value={account} onChange={setAccount} label={transfer ? 'Со счёта' : 'Счёт'} />
                )}
                {lacksTo && <PayAccount d={d} value={toAccount} onChange={setToAccount} label="На счёт" />}
              </Section>
              <div class="sheet-actions item-sheet-actions">
                <Button full disabled={v.anyInvalid} onClick={pay}>
                  {paidLabel}
                </Button>
              </div>
            </>
          )}
          <Section>
            {payable && <ActionRow label="Перенести" onClick={() => setMode('postpone')} />}
            {payable && <ActionRow label="Пометить отменённой" onClick={cancel} />}
            {status === 'paid' && <ActionRow label="Снять оплату" onClick={unpay} />}
            <ActionRow label="Изменить" onClick={() => openSheet('journal', { initial: r })} />
            <ActionRow label="Удалить" destructive onClick={remove} />
          </Section>
        </>
      )}
    </>
  );
}

// ---------- recurring ----------

function RecurringCard({ d, close, ask, rec, ym }: CardProps & { rec: Recurring; ym: YM }) {
  const income = rec.kind === 'income';
  const transfer = rec.kind === 'transfer';
  const mark = rec.marks[ym];
  const month = monthLabel(ym).toLowerCase();
  const v = useFieldValidity();
  const [amount, setAmount] = useState<number | undefined>(rec.amount);
  // a payment without an account (or with a deleted one) reaches no balance: marking offers one (it is saved in the
  // payment); a transfer without «На счёт» is offered that one too
  const lacksAccount = knownAccount(d, rec.account) === undefined;
  const lacksTo = transfer && knownAccount(d, rec.toAccount) === undefined;
  const [account, setAccount] = useState<string | undefined>(lacksAccount ? defaultAccountId(d) : undefined);
  const [toAccount, setToAccount] = useState<string | undefined>(undefined);
  const [tried, setTried] = useState(false);
  const every = Math.max(1, rec.every ?? 1);
  // the account goes into the payment: its marks of other months that the balances count reach it too
  const otherMarks = lacksAccount ? marksInBalances(rec, d.settings).filter((m) => m !== ym).length : 0;
  const accountHint =
    otherMarks > 0
      ? `Счёт сохранится в постоянном платеже — отметки за другие месяцы (${otherMarks}) тоже попадут в остаток этого счёта.`
      : 'Счёт сохранится в постоянном платеже.';

  const markMonth = () => {
    if (v.anyInvalid) return;
    if (amount === undefined) {
      setTried(true);
      return;
    }
    let next = markPaid(appData(), { source: 'recurring', id: rec.id, ym }, amount);
    if (lacksAccount && account) next = { ...next, recurring: replaceRow(next.recurring, rec.id, (x) => ({ ...x, account })) };
    if (lacksTo && toAccount) next = { ...next, recurring: replaceRow(next.recurring, rec.id, (x) => ({ ...x, toAccount })) };
    close();
    actions.commit(next, 'Отмечено');
  };

  const unmark = () => {
    const cur = appData();
    close();
    actions.commit(
      {
        ...cur,
        recurring: replaceRow(cur.recurring, rec.id, (x) => {
          const { [ym]: _gone, ...marks } = x.marks;
          return { ...x, marks };
        }),
      },
      'Отметка снята',
    );
  };

  const remove = () =>
    ask({
      title: 'Удалить постоянный платёж?',
      message: 'Отметки по месяцам удалятся вместе с ним.',
      run: () => {
        const cur = appData();
        close();
        actions.commit({ ...cur, recurring: cur.recurring.filter((x) => x.id !== rec.id) }, 'Платёж удалён');
      },
    });

  const range = [rec.from && `с ${formatDate(rec.from)}`, rec.to && `по ${formatDate(rec.to)}`].filter(Boolean).join(' ');

  return (
    <>
      <Head
        amount={mark !== undefined ? recurringFact(rec, ym) : rec.amount}
        income={income}
        name={itemTitle(rec)}
        meta={kindAndDate(rec.kind, recurringDate(rec, ym))}
      />
      <CheckNote d={d} row={rec} />
      <Section>
        <Row title="Сумма" value={money(rec.amount)} />
        <Row title="Периодичность" value={everyText(every)} />
        {range && <Row title="Действует" value={range} />}
        {rec.category && !transfer && <Row title="Категория" value={rec.category} />}
        <AccountRows d={d} row={rec} />
        {mark !== undefined && (
          <Row
            title={`Отметка за ${month}`}
            value={mark === '✓' ? <>✓ {money(rec.amount)}</> : money(mark)}
            valueTone="green"
          />
        )}
      </Section>
      {mark === undefined && (
        <>
          <Section footer="По умолчанию — сумма платежа; другая сумма запишется в отметку месяца.">
            <AmountField
              label="Сумма факт"
              value={amount}
              onChange={v.field('amount', setAmount)}
              error={tried && amount === undefined ? 'Введите сумму' : undefined}
            />
            {lacksAccount && (
              <PayAccount d={d} value={account} onChange={setAccount} hint={accountHint} label={transfer ? 'Со счёта' : 'Счёт'} />
            )}
            {lacksTo && <PayAccount d={d} value={toAccount} onChange={setToAccount} label="На счёт" />}
          </Section>
          <div class="sheet-actions item-sheet-actions">
            <Button full disabled={v.anyInvalid} onClick={markMonth}>
              {`${income ? 'Отметить получение' : transfer ? 'Отметить перевод' : 'Отметить оплату'} за ${month}`}
            </Button>
          </div>
        </>
      )}
      <Section>
        {mark !== undefined && <ActionRow label="Снять отметку" onClick={unmark} />}
        <ActionRow label="Изменить" onClick={() => openSheet('recurring', { initial: rec })} />
        <ActionRow label="Удалить" destructive onClick={remove} />
      </Section>
    </>
  );
}

// ---------- purchase ----------

function PurchaseCard({ d, close, ask, p }: CardProps & { p: Purchase }) {
  const v = useFieldValidity();
  const [price, setPrice] = useState<number | undefined>(p.price ?? p.cost);
  // a bought purchase needs an account (as in the purchase form; a deleted one is as good as none): none is
  // chosen for the user
  const lacksAccount = knownAccount(d, p.account) === undefined;
  const [account, setAccount] = useState<string | undefined>(undefined);
  const [tried, setTried] = useState(false);
  const priceError = price === undefined ? 'Введите цену' : price === 0 ? 'Цена не может быть нулевой' : undefined;
  const accountError = lacksAccount && account === undefined ? 'Выберите счёт' : undefined;

  const remove = () =>
    ask({
      title: 'Удалить покупку?',
      message: 'Покупка пропадёт из планов, ленты и расчётов.',
      run: () => {
        const cur = appData();
        close();
        actions.commit({ ...cur, purchases: cur.purchases.filter((x) => x.id !== p.id) }, 'Покупка удалена');
      },
    });

  const buy = () => {
    if (v.anyInvalid) return;
    if (priceError || accountError) {
      setTried(true);
      return;
    }
    const next = markPaid(appData(), { source: 'purchase', id: p.id }, price);
    close();
    actions.commit(
      {
        ...next,
        purchases: replaceRow(next.purchases, p.id, (x) => ({
          ...x,
          ...(lacksAccount && account ? { account } : {}),
          ...(!x.date ? { date: today() } : {}),
        })),
      },
      'Куплено',
    );
  };

  return (
    <>
      <Head
        amount={p.bought ? purchaseFact(p) : (p.cost ?? 0)}
        name={itemTitle({ ...p, kind: 'expense' })}
        meta={kindAndDate('expense', p.date)}
      />
      <Section>
        <Row title="Статус" value={p.bought ? 'Куплено' : 'Не куплено'} />
        {p.cost !== undefined && <Row title="Стоимость" value={money(p.cost)} />}
        {p.bought && p.price !== undefined && <Row title="Цена факт" value={money(p.price)} />}
        {p.saved !== undefined && <Row title="Отложено" value={money(p.saved)} />}
        {p.category && <Row title="Категория" value={p.category} />}
        {p.priority && <Row title="Приоритет" value={p.priority} />}
        {p.account && <Row title="Счёт" value={accountName(d, p.account)} />}
      </Section>
      {!p.bought && (
        <>
          <Section>
            <AmountField
              label="Цена факт"
              value={price}
              onChange={v.field('price', setPrice)}
              error={tried ? priceError : undefined}
            />
            {lacksAccount && (
              <PayAccount d={d} value={account} onChange={setAccount} required error={tried ? accountError : undefined} />
            )}
          </Section>
          <div class="sheet-actions item-sheet-actions">
            <Button full disabled={v.anyInvalid} onClick={buy}>
              Куплено
            </Button>
          </div>
        </>
      )}
      <Section>
        <ActionRow label="Изменить" onClick={() => openSheet('purchase', { initial: p })} />
        <ActionRow label="Удалить" destructive onClick={remove} />
      </Section>
    </>
  );
}

// ---------- operation ----------

function OperationCard({ d, close, ask, o }: CardProps & { o: Operation }) {
  const remove = () =>
    ask({
      title: 'Удалить операцию?',
      message: 'Операция пропадёт из ленты, остатков и расчётов.',
      run: () => {
        const cur = appData();
        close();
        actions.commit({ ...cur, operations: cur.operations.filter((x) => x.id !== o.id) }, 'Операция удалена');
      },
    });
  const income = o.kind === 'income';
  return (
    <>
      <Head amount={opAmount(o)} income={income} name={itemTitle(o)} meta={kindAndDate(o.kind, o.date)} />
      <CheckNote d={d} row={o} />
      <DuplicateNote of={duplicatesForOperation(d, o)} />
      <Section>
        {o.category && <Row title="Категория" value={o.category} />}
        {o.kind === 'transfer' ? (
          <>
            <Row title="Со счёта" value={accountName(d, o.account) || 'не указан'} />
            <Row title="На счёт" value={accountName(d, o.toAccount) || 'не указан'} />
          </>
        ) : (
          <Row title="Счёт" value={accountName(d, o.account) || 'не указан'} />
        )}
      </Section>
      <Section>
        <ActionRow label="Изменить" onClick={() => openSheet('operation', { initial: o })} />
        <ActionRow label="Удалить" destructive onClick={remove} />
      </Section>
    </>
  );
}
