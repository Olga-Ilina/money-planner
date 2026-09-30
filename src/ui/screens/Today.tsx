// Root screen of the «Сегодня» tab (spec §5): money on cards, in cash and the credit card debt; what is
// due in the next 7 days (and everything overdue) with one-tap payment; this month's income and expense
// against the plan; the checks that need a look (each opens where it can be fixed); the «сделайте копию»
// banner and a note when today is outside the accounting year. Numbers come from the engine.
import { useMemo } from 'preact/hooks';
import {
  accountingMonths, addDays, balances, markPaid, monthLabel, monthSummary, nextCreditDebit, opt, upcoming, warnings, ymOf,
} from '../../engine';
import type { Data, ISODate, Settings, UpcomingItem, YM } from '../../engine';
import { actions, needsBackup } from '../actions';
import { copying, makeCopy } from '../backupCopy';
import { formatDate, formatDay, formatWeekdayDate, localDateOf } from '../format';
import { Banner, Button, Icon, Money, Page, ProgressBar, Row, Section, StatCard, StatGrid } from '../kit';
import type { IconName } from '../kit';
import { openTab } from '../nav';
import { monthRange } from '../pages/usageText';
import { openSheet } from '../sheets/host';
import { knownAccount } from '../sheets/planForm';
import { debitText } from './accountsParts';
import { feedCheckCounts, openFeed, openFeedCheck } from './Feed';
import { appData, meta, today } from '../state';
import './Today.css';

const UPCOMING_DAYS = 7;

// ---------- helpers (exported for tests) ----------

/** Overdue items first, then the rest; each part by date. Returns a new array. */
export function orderUpcoming(items: readonly UpcomingItem[]): UpcomingItem[] {
  const byDate = [...items].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return [...byDate.filter((i) => i.overdue), ...byDate.filter((i) => !i.overdue)];
}

/**
 * The month «Этот месяц» shows: the current month when it is one of the 12 accounting months,
 * otherwise the nearest of them (the first before the year, the last after it).
 */
export function summaryMonth(s: Settings, todayDate: ISODate): { ym: YM; current: boolean } {
  const months = accountingMonths(s);
  const ym = ymOf(todayDate);
  if (months.includes(ym)) return { ym, current: true };
  const first = months[0] ?? ym;
  const last = months[months.length - 1] ?? ym;
  return { ym: ym < first ? first : last, current: false };
}

export type Check = 'unassigned' | 'duplicates' | 'boughtWithoutDate' | 'outOfYear';

export interface CheckRow {
  check: Check;
  title: string;
  count: number;
}

/**
 * The rows of «Проверьте записи», only the checks that found something. Each counts what the place it opens
 * can show: paid without an account and the possible duplicates — the rows «Лента» shows filtered to them
 * over the 12 accounting months; bought purchases without a date («Лента» has no month for them) —
 * «Покупки»; journal rows and operations outside the accounting year — «Учёт и прогноз».
 */
export function checkRows(d: Data): CheckRow[] {
  const w = warnings(d);
  const feed = feedCheckCounts(d);
  const rows: CheckRow[] = [
    { check: 'unassigned', title: 'Оплачено без счёта', count: feed.unassigned },
    { check: 'duplicates', title: 'Возможные дубли', count: feed.duplicates },
    { check: 'boughtWithoutDate', title: 'Куплено без даты', count: w.boughtWithoutDate },
    { check: 'outOfYear', title: 'Вне учётного года', count: w.outOfYear },
  ];
  return rows.filter((r) => r.count > 0);
}

function openCheck(check: Check): void {
  if (check === 'outOfYear') openTab('more', 'settings');
  else if (check === 'boughtWithoutDate') openTab('more', 'purchases');
  else openFeedCheck(check);
}

/** «Спишется 10 декабря: 300,00 €» (as on «Счета») for the next credit card debit; nothing when there is none or it is 0. */
export function debitLine(next: { date: ISODate; amount: number } | null, day: ISODate): string | undefined {
  if (!next || !(next.amount > 0)) return undefined;
  return debitText(next, day);
}

/**
 * Whether paying `item` in one tap would leave out what paying needs, so ✓ opens its card instead: a
 * purchase needs an account and a price (or a cost) above 0, a journal row or a recurring payment an
 * account (paid without one, the money reaches no balance) — an account that was deleted is as good as
 * none. A record that is gone opens the card too.
 */
export function needsCard(d: Data, item: UpcomingItem): boolean {
  const noAccount = (id: string | undefined) => knownAccount(d, opt(id)) === undefined;
  switch (item.source) {
    case 'journal': {
      const r = d.journal.find((x) => x.id === item.id);
      return !r || noAccount(r.account);
    }
    case 'recurring': {
      const rec = d.recurring.find((x) => x.id === item.id);
      return !rec || noAccount(rec.account);
    }
    case 'purchase': {
      const p = d.purchases.find((x) => x.id === item.id);
      return !p || noAccount(p.account) || !((p.price ?? p.cost ?? 0) > 0);
    }
  }
}

// ---------- the next 7 days ----------

const SOURCE_ICON: Record<UpcomingItem['source'], IconName> = {
  journal: 'calendar',
  recurring: 'repeat',
  purchase: 'cart',
};

function checkLabel(item: UpcomingItem): string {
  const what = item.what || 'без названия';
  if (item.source === 'purchase') return `Отметить покупку: ${what}`;
  return item.kind === 'income' ? `Отметить поступление: ${what}` : `Отметить оплату: ${what}`;
}

/** The toast after ✓: a recurring tick is «Отмечено» (as on its card and in its form), a purchase «Куплено». */
function paidMessage(item: UpcomingItem): string {
  if (item.source === 'recurring') return 'Отмечено';
  if (item.source === 'purchase') return 'Куплено';
  return item.kind === 'income' ? 'Получено' : 'Оплачено';
}

function dayText(date: ISODate, todayDate: ISODate): string {
  if (date === todayDate) return 'Сегодня';
  if (date === addDays(todayDate, 1)) return 'Завтра';
  return formatDay(date);
}

function UpcomingRow({ item, todayDate }: { item: UpcomingItem; todayDate: ISODate }) {
  const open = () => {
    const { source, id, ym } = item;
    openSheet('item', { item: ym === undefined ? { source, id } : { source, id, ym } });
  };
  // the planned amount as it is; another amount — or what the record still lacks — only through its card
  const pay = () => {
    const d = appData();
    if (needsCard(d, item)) open();
    else actions.commit(markPaid(d, item), paidMessage(item));
  };
  const income = item.kind === 'income';
  return (
    <Row
      icon={SOURCE_ICON[item.source]}
      title={item.what || 'Без названия'}
      subtitle={
        item.overdue ? <span class="tone-red">{`${formatDay(item.date)} · просрочено`}</span> : dayText(item.date, todayDate)
      }
      value={<Money value={item.amount} tone="plain" signed={income} />}
      valueTone={income ? 'green' : 'default'}
      onClick={open}
      trailing={
        <button type="button" class="icon-button today-check" aria-label={checkLabel(item)} onClick={pay}>
          <Icon name="check-circle" size={26} />
        </button>
      }
    />
  );
}

/** Today is after the last accounting month, or before the first: new records would reach no report. */
function YearBanner({ s, todayDate }: { s: Settings; todayDate: ISODate }) {
  const months = accountingMonths(s);
  const first = months[0];
  const last = months[months.length - 1];
  const ym = ymOf(todayDate);
  if (first === undefined || last === undefined || (ym >= first && ym <= last)) return null;
  const range = monthRange(first, last);
  return (
    <Banner tone="warning" action={{ label: 'Учёт и прогноз', onClick: () => openTab('more', 'settings') }}>
      {ym > last
        ? `Учётный год закончился: ${range}. Новые записи не попадут в ленту и отчёты — выберите следующий учётный год.`
        : `Учётный год ещё не начался: ${range}. Записи до его начала не попадут в ленту и отчёты.`}
    </Banner>
  );
}

function BackupBanner() {
  const last = localDateOf(meta.value.lastBackupAt);
  return (
    <Banner tone="warning" action={{ label: 'Сделать копию', disabled: copying.value, onClick: () => void makeCopy() }}>
      {last
        ? `Последняя копия — ${formatDate(last)}. Данные хранятся только на этом телефоне.`
        : 'Резервной копии ещё не было. Данные хранятся только на этом телефоне.'}
    </Banner>
  );
}

// ---------- screen ----------

interface View {
  cards: number;
  cash: number;
  creditDebt: number;
  debit: string | undefined;
  items: UpcomingItem[];
  month: { ym: YM; current: boolean };
  expenseFact: number;
  expensePlan: number;
  incomeFact: number;
  incomePlan: number;
  checks: CheckRow[];
}

function view(d: Data, todayDate: ISODate): View {
  const b = balances(d, todayDate);
  const month = summaryMonth(d.settings, todayDate);
  const sum = monthSummary(d, month.ym);
  return {
    cards: b.cards,
    cash: b.cash,
    creditDebt: b.creditDebt,
    debit: debitLine(nextCreditDebit(d, todayDate), todayDate),
    items: orderUpcoming(upcoming(d, todayDate, UPCOMING_DAYS)),
    month,
    expenseFact: sum.expenseFact,
    expensePlan: sum.expensePlan,
    incomeFact: sum.incomeFact,
    incomePlan: sum.incomePlan,
    checks: checkRows(d),
  };
}

export function Today() {
  const d = appData();
  const todayDate = today();
  const v = useMemo(() => view(d, todayDate), [d, todayDate]);
  const toAccounts = () => openTab('accounts');

  return (
    <Page title="Сегодня" subtitle={formatWeekdayDate(todayDate)}>
      <YearBanner s={d.settings} todayDate={todayDate} />
      {needsBackup(meta.value, d) && <BackupBanner />}

      <StatGrid>
        <StatCard label="На картах" value={v.cards} onClick={toAccounts} />
        <StatCard label="Наличные" value={v.cash} onClick={toAccounts} />
        <StatCard label="Кредитка" value={v.creditDebt} sub={v.debit} onClick={toAccounts} />
      </StatGrid>

      <div class="today-new">
        <Button full onClick={() => openSheet('operation')}>
          <Icon name="plus" size={20} />
          Новая операция
        </Button>
      </div>

      <Section header={`Ближайшие ${UPCOMING_DAYS} дней`}>
        {v.items.length === 0 ? (
          <p class="today-empty">На неделю платежей нет</p>
        ) : (
          v.items.map((item) => (
            <UpcomingRow key={`${item.source}:${item.id}:${item.ym ?? ''}`} item={item} todayDate={todayDate} />
          ))
        )}
      </Section>

      {/* the month's totals as in «Лента» and «Отчёты»: «Доход», then «Расход», each with its plan */}
      <Section header={v.month.current ? 'Этот месяц' : monthLabel(v.month.ym)}>
        <Row
          title="Доход"
          subtitle={
            <>
              план <Money value={v.incomePlan} />
            </>
          }
          value={<Money value={v.incomeFact} />}
          chevron
          onClick={() => openFeed(v.month.ym)}
        />
        <Row
          title="Расход"
          subtitle={
            <>
              план <Money value={v.expensePlan} />
            </>
          }
          value={<Money value={v.expenseFact} />}
          chevron
          onClick={() => openFeed(v.month.ym)}
          bar={<ProgressBar value={v.expenseFact} max={v.expensePlan} label="Расход из плана" />}
        />
      </Section>

      {v.checks.length > 0 && (
        <Section header="Проверьте записи">
          {v.checks.map((c) => (
            <Row
              key={c.check}
              icon="warning"
              iconTone="orange"
              title={c.title}
              value={String(c.count)}
              chevron
              onClick={() => openCheck(c.check)}
            />
          ))}
        </Section>
      )}
    </Page>
  );
}
