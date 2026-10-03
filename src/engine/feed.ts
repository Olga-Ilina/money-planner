// Month feed: every row that belongs to a month — operations, journal rows, recurring payments and
// purchases — as one list with its plan, fact and status, ordered by date.
import { ymOf } from './dates';
import type { Data, ISODate, OpKind, YM } from './model';
import { opt } from './opt';
import {
  duplicatesForJournal,
  duplicatesForOperation,
  journalFact,
  journalMonth,
  journalPlan,
  opAmount,
  purchaseFact,
  purchasePlan,
  recurringDate,
  recurringDue,
  recurringFact,
  recurringPlan,
} from './rules';
import type { DuplicateOf } from './rules';
import { rowCheck } from './transfers';
import type { RowCheck } from './transfers';

export type FeedSource = 'operation' | 'journal' | 'recurring' | 'purchase';
export type FeedStatus = 'paid' | 'planned' | 'postponed' | 'cancelled';

export interface FeedItem {
  source: FeedSource;
  id: string;
  ym: YM;
  date?: ISODate;
  kind: OpKind;
  category?: string;
  what: string;
  plan: number;
  fact: number;
  status: FeedStatus;
  account?: string;
  toAccount?: string;
  duplicate?: DuplicateOf;
  check?: RowCheck; // the tracker's check of the row's type and accounts (never together with `duplicate`)
}

const SOURCE_ORDER: Record<FeedSource, number> = { operation: 0, journal: 1, recurring: 2, purchase: 3 };

/** The item without its undefined optional fields. */
function item(fields: FeedItem): FeedItem {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as unknown as FeedItem;
}

/** By date (items without a date last), then operation → journal → recurring → purchase, then by name. */
function compareItems(a: FeedItem, b: FeedItem): number {
  if (a.date !== b.date) {
    if (a.date === undefined) return 1;
    if (b.date === undefined) return -1;
    return a.date < b.date ? -1 : 1;
  }
  return SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || a.what.localeCompare(b.what, 'ru');
}

/**
 * Items of month ym: operations dated in it, journal rows of that accounting month, recurring payments
 * due in it or marked for it, purchases dated in it.
 */
export function monthItems(data: Data, ym: YM): FeedItem[] {
  const s = data.settings;
  const items: FeedItem[] = [];

  for (const o of data.operations) {
    if (ymOf(o.date) !== ym) continue;
    items.push(item({
      source: 'operation', id: o.id, ym, date: o.date, kind: o.kind, category: opt(o.category), what: o.what,
      plan: 0, fact: opAmount(o), status: 'paid', account: opt(o.account), toAccount: opt(o.toAccount),
      duplicate: duplicatesForOperation(data, o) ?? undefined, check: rowCheck(data, o) ?? undefined,
    }));
  }
  for (const r of data.journal) {
    if (journalMonth(r, s) !== ym) continue;
    items.push(item({
      source: 'journal', id: r.id, ym, date: r.date, kind: r.kind, category: opt(r.category), what: r.what,
      plan: journalPlan(r), fact: journalFact(r), status: r.status ?? (r.fact !== undefined ? 'paid' : 'planned'),
      account: opt(r.account), toAccount: r.kind === 'transfer' ? opt(r.toAccount) : undefined,
      duplicate: duplicatesForJournal(data, r) ?? undefined, check: rowCheck(data, r) ?? undefined,
    }));
  }
  for (const rec of data.recurring) {
    const marked = rec.marks[ym] !== undefined; // a mark of 0 is still a mark
    if (!marked && !recurringDue(rec, ym, s)) continue;
    items.push(item({
      source: 'recurring', id: rec.id, ym, date: recurringDate(rec, ym), kind: rec.kind, category: opt(rec.category),
      what: rec.what, plan: recurringPlan(rec, ym, s), fact: recurringFact(rec, ym), status: marked ? 'paid' : 'planned',
      account: opt(rec.account), toAccount: rec.kind === 'transfer' ? opt(rec.toAccount) : undefined,
      check: rowCheck(data, rec) ?? undefined,
    }));
  }
  for (const p of data.purchases) {
    const date = opt(p.date);
    if (date === undefined || ymOf(date) !== ym) continue;
    items.push(item({
      source: 'purchase', id: p.id, ym, date, kind: 'expense', category: opt(p.category), what: p.what,
      plan: purchasePlan(p), fact: purchaseFact(p), status: p.bought ? 'paid' : 'planned', account: opt(p.account),
    }));
  }

  return items.sort(compareItems);
}
