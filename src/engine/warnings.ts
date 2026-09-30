// Checks shown to the user, as on the tracker's «Счета» and «Месяц» sheets.
import { accountingMonths, inAccountingYear, ymOf } from './dates';
import type { Data } from './model';
import { opt } from './opt';
import {
  duplicatesForJournal,
  duplicatesForOperation,
  journalFact,
  journalMonth,
  opAmount,
  purchaseFact,
  recurringFact,
} from './rules';

export interface Warnings {
  unassigned: { count: number; sum: number }; // paid without an account: missing from every balance
  transfersWithoutTarget: number;
  outOfYear: number; // journal rows (by accounting month) and operations (by date) outside the 12 months
  duplicates: number; // possible duplicates among journal rows and operations
  unknownAccounts: number; // rows and credit settings pointing to an account that does not exist
  recurringMarkedWithoutDay: number; // marks without a day have no date, so they reach no balance
  boughtWithoutDate: number; // change balances but not the money at the forecast start or the movements
}

export function warnings(data: Data): Warnings {
  const s = data.settings;
  let count = 0;
  let sum = 0;
  const unassigned = (value: number) => {
    count += 1;
    sum += value;
  };
  for (const r of data.journal) {
    if (opt(r.account) === undefined && journalFact(r) !== 0) unassigned(journalFact(r));
  }
  for (const o of data.operations) {
    if (opt(o.account) === undefined) unassigned(opAmount(o));
  }
  for (const ym of accountingMonths(s)) {
    for (const rec of data.recurring) {
      if (opt(rec.account) === undefined && recurringFact(rec, ym) !== 0) unassigned(recurringFact(rec, ym));
    }
  }
  for (const p of data.purchases) {
    if (opt(p.account) === undefined && purchaseFact(p) !== 0) unassigned(purchaseFact(p));
  }

  const outOfYear =
    data.journal.filter((r) => !inAccountingYear(journalMonth(r, s), s)).length +
    data.operations.filter((o) => !inAccountingYear(ymOf(o.date), s)).length;

  const duplicates =
    data.journal.filter((r) => duplicatesForJournal(data, r) !== null).length +
    data.operations.filter((o) => duplicatesForOperation(data, o) !== null).length;

  const known = new Set(data.accounts.map((a) => a.id));
  const unknown = (...ids: (string | undefined)[]): boolean =>
    ids.some((id) => {
      const given = opt(id);
      return given !== undefined && !known.has(given);
    });
  const unknownAccounts =
    data.operations.filter((o) => unknown(o.account, o.toAccount)).length +
    [...data.journal, ...data.recurring, ...data.purchases].filter((r) => unknown(r.account)).length +
    [data.credit.accountId, data.credit.fromAccountId].filter((id) => unknown(id)).length;

  return {
    unassigned: { count, sum },
    transfersWithoutTarget: data.operations.filter((o) => o.kind === 'transfer' && opt(o.toAccount) === undefined).length,
    outOfYear,
    duplicates,
    unknownAccounts,
    recurringMarkedWithoutDay: data.recurring.filter((rec) => !rec.day && Object.keys(rec.marks).length > 0).length,
    boughtWithoutDate: data.purchases.filter((p) => p.bought && opt(p.date) === undefined).length,
  };
}
