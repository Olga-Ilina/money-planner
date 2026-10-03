// «Лента» (spec §5): every record of one accounting month — operations, journal rows, recurring
// payments and purchases — grouped by date, with a filter, the month's fact / plan, «+» for a new
// record and the month report. A row opens its card (sheets/ItemSheet.tsx). The checks of «Сегодня»
// open it filtered to the rows they found («без счёта», «дубль?», the checks of transfers — all also marked on
// every row). Under «Все» the automatic credit card repayment shows on its debit day: for reference only (in no sum,
// no card, nothing to tap), as the tracker's block on «Запланированные».
import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { CARD_REPAYMENT_LABEL, accountingMonths, cardRepayments, monthItems, monthSummary, ymOf } from '../../engine';
import type { CardRepayment, Data, FeedItem, ISODate, OpKind, RowCheck } from '../../engine';
import { formatDay, formatMoney } from '../format';
import { ioErrorMessage, loadReports } from '../io';
import { Banner, EmptyState, Icon, MonthPicker, Money, Page, Row, Section, Segmented, StatCard, StatGrid, showToast } from '../kit';
import type { IconName, IconTone } from '../kit';
import { openTab } from '../nav';
import { shareFile } from '../share';
import { openSheet } from '../sheets/host';
import { itemTitle } from '../sheets/ItemSheet';
import { accountName, appData, clampMonth, feedMonth, onResetSession, today } from '../state';
import './Feed.css';

export type FeedFilter = 'all' | 'expense' | 'income' | 'unpaid';

const FILTERS: { value: FeedFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'expense', label: 'Траты' },
  { value: 'income', label: 'Доходы' },
  { value: 'unpaid', label: 'Не оплачено' },
];

/** The chosen filter; survives tab switches (the month is the shared feedMonth). */
export const feedFilter = signal<FeedFilter>('all');

/**
 * A check of «Сегодня» (and «Счета») shown in «Лента»: only the rows paid without an account, only possible
 * duplicates, or only the rows with a check of a transfer (no «На счёт», the same account, an income to savings).
 */
export type FeedCheck = 'unassigned' | 'duplicates' | 'transfers';

/** The check «Лента» is filtered to (null: none); set by openFeedCheck, cleared by «Показать все». */
export const feedCheck = signal<FeedCheck | null>(null);

onResetSession(() => {
  feedFilter.value = 'all';
  feedCheck.value = null;
});

/**
 * Counts without an account, so it is missing from every balance — the engine's «без счёта» warning row by
 * row: an operation without an account, any other record with a fact.
 */
export function isUnassigned(item: FeedItem): boolean {
  if (item.account !== undefined) return false;
  return item.source === 'operation' || item.fact !== 0;
}

const CHECK_TEST: Record<FeedCheck, (item: FeedItem) => boolean> = {
  unassigned: isUnassigned,
  duplicates: (item) => item.duplicate !== undefined,
  transfers: (item) => item.check !== undefined,
};

/**
 * How many rows «Лента» shows for each check over the 12 accounting months — the filter's own test, so
 * «Сегодня» never counts a row «Лента» cannot show (outside the year, a bought purchase without a date). A check of
 * a transfer belongs to the record, not to a month: a recurring row «Лента» shows in many months counts once.
 */
export function feedCheckCounts(d: Data): Record<FeedCheck, number> {
  const counts: Record<FeedCheck, number> = { unassigned: 0, duplicates: 0, transfers: 0 };
  const checked = new Set<string>();
  for (const ym of accountingMonths(d.settings)) {
    for (const item of monthItems(d, ym)) {
      if (CHECK_TEST.unassigned(item)) counts.unassigned += 1;
      if (CHECK_TEST.duplicates(item)) counts.duplicates += 1;
      if (CHECK_TEST.transfers(item)) checked.add(`${item.source}:${item.id}`);
    }
  }
  counts.transfers = checked.size;
  return counts;
}

/** Whether some accounting month has a row for `check`. */
function anyMonthHas(d: Data, check: FeedCheck): boolean {
  return accountingMonths(d.settings).some((ym) => monthItems(d, ym).some(CHECK_TEST[check]));
}

const CHECK_NOTE: Record<FeedCheck, string> = {
  unassigned: 'Только записи без счёта: они оплачены, но их нет ни в одном остатке. Укажите счёт в карточке записи.',
  duplicates: 'Только возможные дубли. Откройте запись, чтобы сравнить её с похожей и удалить лишнюю.',
  transfers:
    'Только переводы без «На счёт» или на тот же счёт и доходы на сберегательный счёт. Откройте запись, чтобы выбрать счёт или тип «Перевод».',
};

/** Opens «Лента» at month `ym` (when given) with every record: no check filter left on from before. */
export function openFeed(ym?: string): void {
  feedCheck.value = null;
  if (ym !== undefined) feedMonth.value = ym;
  openTab('feed');
}

/**
 * Opens «Лента» filtered to `check` (the segment back to «Все», which could hide some of them): at the shown
 * month when it has such rows, else at the first accounting month that has. When no month has any (only rows
 * «Лента» cannot show), it opens as usual, without the filter.
 */
export function openFeedCheck(check: FeedCheck): void {
  const d = appData();
  const months = accountingMonths(d.settings);
  const shown = clampMonth(feedMonth.value, months, ymOf(today()));
  const has = (ym: string): boolean => monthItems(d, ym).some(CHECK_TEST[check]);
  const first = has(shown) ? shown : months.find(has);
  feedCheck.value = first === undefined ? null : check;
  if (first !== undefined) {
    feedFilter.value = 'all';
    feedMonth.value = first;
  }
  openTab('feed');
}

/** «Траты»: expenses (no transfers); «Доходы»: income; «Не оплачено»: planned or postponed. */
export function filterItems(items: FeedItem[], filter: FeedFilter): FeedItem[] {
  switch (filter) {
    case 'all':
      return items;
    case 'expense':
      return items.filter((i) => i.kind === 'expense');
    case 'income':
      return items.filter((i) => i.kind === 'income');
    case 'unpaid':
      return items.filter((i) => i.status === 'planned' || i.status === 'postponed');
  }
}

export interface DateGroup {
  /** undefined: the items without a date (always the last group). */
  date?: ISODate;
  items: FeedItem[];
  /** The automatic card repayments of that day (addRepayments). */
  repayments?: CardRepayment[];
}

/** Items (in date order, undated last — as monthItems returns them) grouped by date. */
export function groupByDate(items: FeedItem[]): DateGroup[] {
  const groups: DateGroup[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.date === item.date) last.items.push(item);
    else groups.push(item.date === undefined ? { items: [item] } : { date: item.date, items: [item] });
  }
  return groups;
}

/**
 * The groups with the card repayments on their days: added to the group of that date, or as a group of their own in
 * date order (the undated group stays last). A new array; the groups given are not changed.
 */
export function addRepayments(groups: DateGroup[], repayments: CardRepayment[]): DateGroup[] {
  const out = groups.map((g) => ({ ...g }));
  for (const r of repayments) {
    const same = out.find((g) => g.date === r.date);
    if (same) {
      same.repayments = [...(same.repayments ?? []), r];
      continue;
    }
    const at = out.findIndex((g) => g.date === undefined || g.date > r.date);
    const group: DateGroup = { date: r.date, items: [], repayments: [r] };
    if (at < 0) out.push(group);
    else out.splice(at, 0, group);
  }
  return out;
}

/** What the amount of a row is: «план» / «факт» for a record still to pay, plus «перенесено» when postponed. */
export type FeedCaption = 'план' | 'факт' | 'план · перенесено' | 'факт · перенесено' | 'отменено';

/** What a feed row shows. */
export interface FeedRowView {
  title: string;
  subtitle?: string;
  icon: IconName;
  kind: OpKind;
  /** The fact once paid (or whenever a fact counts), the plan before that. */
  amount: number;
  caption?: FeedCaption;
  /** A planned record that is paid (operations are facts by nature and get no check). */
  check: boolean;
  /** What the check says: «Оплачено», «Получено» (income), «Переведено» (a transfer) or «Куплено» (a purchase). */
  checkLabel: string;
  cancelled: boolean;
  /** The amount does not count: a cancelled row with nothing paid. */
  amountStruck: boolean;
  duplicate: boolean;
  /** Counts without an account (missing from every balance): marked «без счёта». */
  unassigned: boolean;
  /** The check of a transfer or of an income to savings (FeedItem.check): marked with CHECK_BADGE. */
  rowCheck?: RowCheck;
}

/** The short marks of the checks on a feed row (the full words: ROW_CHECK_LABEL, on the record's card). */
export const CHECK_BADGE: Record<RowCheck, string> = {
  looksLikeTransfer: 'похоже на перевод',
  noTarget: 'нет «На счёт»',
  sameAccount: 'тот же счёт',
};

const OPERATION_ICON: Record<OpKind, IconName> = { expense: 'cart', income: 'plus-circle', transfer: 'arrows' };
/** The icon square takes the colour of the kind (a cancelled row: grey). */
const ICON_TONE: Record<OpKind, IconTone> = { expense: 'tint', income: 'green', transfer: 'teal' };
const SOURCE_ICON: Record<Exclude<FeedItem['source'], 'operation'>, IconName> = {
  journal: 'calendar',
  recurring: 'repeat',
  purchase: 'cart',
};

/** The plan a cancelled journal row had (its feed plan is 0 once cancelled). */
function cancelledPlan(d: Data, item: FeedItem): number {
  if (item.source !== 'journal') return item.plan;
  const r = d.journal.find((j) => j.id === item.id);
  return r?.plan ?? r?.fact ?? 0;
}

/** A fact counts whenever it is entered (as in the engine), so it is the amount shown — and named «факт». */
function caption(item: FeedItem): FeedCaption | undefined {
  if (item.source === 'operation') return undefined;
  const fact = item.fact !== 0;
  switch (item.status) {
    case 'paid':
      return undefined;
    case 'cancelled':
      return 'отменено';
    case 'postponed':
      return fact ? 'факт · перенесено' : 'план · перенесено';
    case 'planned':
      return fact ? 'факт' : 'план';
  }
}

export function feedRow(item: FeedItem, d: Data): FeedRowView {
  const account = accountName(d, item.account);
  const subtitle =
    item.kind === 'transfer'
      ? [account, accountName(d, item.toAccount)].filter(Boolean).join(' → ')
      : [item.category, account].filter(Boolean).join(' · ');
  const cancelled = item.status === 'cancelled';
  const paid = item.status === 'paid';
  // a fact counts whatever the status says (a cancelled fine that was partly paid, a fact typed in)
  const amount = paid || item.fact !== 0 ? item.fact : cancelled ? cancelledPlan(d, item) : item.plan;
  const view: FeedRowView = {
    title: itemTitle(item),
    subtitle: subtitle || undefined,
    icon: item.source === 'operation' ? OPERATION_ICON[item.kind] : SOURCE_ICON[item.source],
    kind: item.kind,
    amount,
    caption: caption(item),
    check: paid && item.source !== 'operation',
    checkLabel:
      item.source === 'purchase' ? 'Куплено' : item.kind === 'income' ? 'Получено' : item.kind === 'transfer' ? 'Переведено' : 'Оплачено',
    cancelled,
    amountStruck: cancelled && item.fact === 0,
    duplicate: item.duplicate !== undefined,
    unassigned: isUnassigned(item),
  };
  if (item.check !== undefined) view.rowCheck = item.check;
  return view;
}

const EMPTY_FILTER: Record<FeedFilter, string> = {
  all: 'Записей нет',
  expense: 'Трат нет',
  income: 'Доходов нет',
  unpaid: 'Всё оплачено',
};

function FeedValue({ view }: { view: FeedRowView }) {
  const income = view.kind === 'income';
  const tone = view.cancelled || view.kind === 'transfer' ? ' tone-muted' : income ? ' tone-green' : '';
  return (
    <span class="feed-value">
      <span class={`feed-amount${tone}${view.amountStruck ? ' feed-struck' : ''}`}>
        {view.check && (
          <span class="feed-check" role="img" aria-label={view.checkLabel}>
            <Icon name="check" size={15} />
          </span>
        )}
        <Money value={view.amount} tone="plain" signed={income} />
      </span>
      {view.caption && (
        <>
          <span class="sr-only">, </span>
          <span class="feed-caption">{view.caption}</span>
        </>
      )}
    </span>
  );
}

function FeedRow({ item, d }: { item: FeedItem; d: Data }) {
  const view = feedRow(item, d);
  return (
    <Row
      icon={view.icon}
      iconTone={view.cancelled ? 'muted' : ICON_TONE[view.kind]}
      title={
        <>
          <span class={`feed-title${view.cancelled ? ' feed-struck' : ''}`}>{view.title}</span>
          {view.duplicate && (
            <>
              {' '}
              <span class="feed-badge">дубль?</span>
            </>
          )}
          {view.unassigned && (
            <>
              {' '}
              <span class="feed-badge">без счёта</span>
            </>
          )}
          {view.rowCheck && (
            <>
              {' '}
              <span class="feed-badge">{CHECK_BADGE[view.rowCheck]}</span>
            </>
          )}
        </>
      }
      subtitle={view.subtitle}
      value={<FeedValue view={view} />}
      onClick={() => openSheet('item', { item: { source: item.source, id: item.id, ym: item.ym } })}
    />
  );
}

/** The automatic card repayment of a day: «Погашение кредитки: <card> ← <from>», for reference, not a button. */
function RepaymentRow({ r, d }: { r: CardRepayment; d: Data }) {
  const from = accountName(d, r.from);
  return (
    <Row
      icon="card"
      iconTone="muted"
      title={`${CARD_REPAYMENT_LABEL}: ${accountName(d, r.card)}${from ? ` ← ${from}` : ''}`}
      subtitle="Справочно, уже учтено"
      value={
        <span class="feed-value">
          <span class="feed-amount tone-muted">
            <Money value={r.amount} tone="plain" />
          </span>
          <span class="sr-only">, </span>
          <span class="feed-caption">{r.debited ? 'списано' : 'ожидается'}</span>
        </span>
      }
    />
  );
}

export function Feed() {
  const d = appData();
  const months = accountingMonths(d.settings);
  const ym = clampMonth(feedMonth.value, months, ymOf(today()));
  const filter = feedFilter.value;
  // a check that finds nothing in any month (its last row was fixed) is dropped: no note, «Лента» as usual
  const stale = feedCheck.value !== null && !anyMonthHas(d, feedCheck.value);
  const check = stale ? null : feedCheck.value;
  useEffect(() => {
    if (stale) feedCheck.value = null;
  }, [stale]);
  const all = monthItems(d, ym);
  const shown = filterItems(all, filter);
  // the card repayments of the month (only a debit, not a 0): under «Все» only, never under a check
  const repayments =
    filter === 'all' && !check ? cardRepayments(d, today()).filter((r) => r.amount !== 0 && ymOf(r.date) === ym) : [];
  const groups = addRepayments(groupByDate(check ? shown.filter(CHECK_TEST[check]) : shown), repayments);
  const summary = monthSummary(d, ym);
  const [exporting, setExporting] = useState(false);

  // called straight from the tap: Safari opens the share sheet only right after a user gesture
  const exportMonth = async () => {
    setExporting(true);
    try {
      const { monthReport } = await loadReports();
      const { filename, buffer } = await monthReport(appData(), ym);
      await shareFile(filename, buffer);
    } catch (e) {
      showToast(ioErrorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Page
      title="Лента"
      right={
        <>
          <button
            type="button"
            class="icon-button"
            aria-label="Выгрузить отчёт за месяц"
            disabled={exporting}
            onClick={() => void exportMonth()}
          >
            <Icon name="download" size={22} />
          </button>
          <button type="button" class="icon-button" aria-label="Добавить" onClick={() => openSheet('add')}>
            <Icon name="plus" size={26} />
          </button>
        </>
      }
    >
      {check && (
        <Banner tone="warning" action={{ label: 'Показать все', onClick: () => (feedCheck.value = null) }}>
          {CHECK_NOTE[check]}
        </Banner>
      )}
      <div class="feed-month">
        <MonthPicker value={ym} months={months} onChange={(m) => (feedMonth.value = m)} />
      </div>
      <div class="feed-filter">
        <Segmented label="Что показать" options={FILTERS} value={filter} onChange={(f) => (feedFilter.value = f)} />
      </div>
      {/* the month's totals as on «Сегодня» and in «Отчёты»: «Доход», then «Расход», each with its plan */}
      <StatGrid columns={2}>
        <StatCard label="Доход" value={summary.incomeFact} sub={`план ${formatMoney(summary.incomePlan)}`} />
        <StatCard label="Расход" value={summary.expenseFact} sub={`план ${formatMoney(summary.expensePlan)}`} />
      </StatGrid>
      {groups.length === 0 ? (
        check ? (
          <EmptyState title="В этом месяце таких записей нет" />
        ) : all.length === 0 ? (
          <EmptyState title={EMPTY_FILTER.all} text="Добавьте операцию или плановую запись кнопкой «+»." />
        ) : (
          <EmptyState title={EMPTY_FILTER[filter]} />
        )
      ) : (
        groups.map((g) => (
          <Section key={g.date ?? 'none'} header={g.date === undefined ? 'Без даты' : formatDay(g.date)}>
            {g.items.map((item) => (
              <FeedRow key={`${item.source}:${item.id}`} item={item} d={d} />
            ))}
            {g.repayments?.map((r) => (
              <RepaymentRow key={`repayment:${r.date}`} r={r} d={d} />
            ))}
          </Section>
        ))
      )}
    </Page>
  );
}
