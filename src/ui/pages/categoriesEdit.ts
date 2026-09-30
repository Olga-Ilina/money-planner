// Changes of the category lists («Категории и лимиты»). Rows refer to a category by its NAME, so a
// rename or a removal must reach every row that uses the name — in the same new Data object (one
// commit, one undo). Never in place: every function returns a new Data (or the same one when nothing
// changes).
import { opt } from '../../engine';
import type { Data, ExpenseCategory } from '../../engine';
import { rowCountsText } from './usageText';
import type { RowCounts } from './usageText';

export type CategoryKind = 'expense' | 'income';

export interface CategoryUsage extends RowCounts {
  total: number;
}

type RowKind = 'expense' | 'income' | 'transfer';

interface Categorised {
  category?: string;
}

const clean = (name: string): string => name.trim();
const key = (name: string): string => clean(name).toLocaleLowerCase('ru');

const other = (kind: CategoryKind): CategoryKind => (kind === 'expense' ? 'income' : 'expense');

/**
 * Does a row of kind `rowKind` use category `name` of list `kind`? A name that is only in this list
 * matches rows of any kind (an income row filed under an expense category still points to it); a
 * name that is in both lists matches only rows of its own kind.
 */
function matcher(d: Data, kind: CategoryKind, name: string): (row: Categorised, rowKind: RowKind) => boolean {
  const shared = d.categories[other(kind)].some((c) => c.name === name);
  return (row, rowKind) => opt(row.category) === name && (!shared || rowKind === kind);
}

/** How many rows of each source use category `name` of list `kind`. */
export function categoryUsage(d: Data, kind: CategoryKind, name: string): CategoryUsage {
  const uses = matcher(d, kind, name);
  const operations = d.operations.filter((o) => uses(o, o.kind)).length;
  const journal = d.journal.filter((r) => uses(r, r.kind)).length;
  const recurring = d.recurring.filter((r) => uses(r, r.kind)).length;
  const purchases = d.purchases.filter((p) => uses(p, 'expense')).length;
  return { operations, journal, recurring, purchases, total: operations + journal + recurring + purchases };
}

/** «2 операции, 5 плановых записей». */
export function usageText(u: CategoryUsage): string {
  return rowCountsText(u).join(', ');
}

/** `row` with category `to` (absent when null). */
function withCategory<T extends Categorised>(row: T, to: string | null): T {
  const next = { ...row };
  if (to === null) delete next.category;
  else next.category = to;
  return next;
}

/** Every row that uses `name` of list `kind` gets category `to` (removed when null). */
function moveRows(d: Data, kind: CategoryKind, name: string, to: string | null): Data {
  const uses = matcher(d, kind, name);
  return {
    ...d,
    operations: d.operations.map((o) => (uses(o, o.kind) ? withCategory(o, to) : o)),
    journal: d.journal.map((r) => (uses(r, r.kind) ? withCategory(r, to) : r)),
    recurring: d.recurring.map((r) => (uses(r, r.kind) ? withCategory(r, to) : r)),
    purchases: d.purchases.map((p) => (uses(p, 'expense') ? withCategory(p, to) : p)),
  };
}

/**
 * Renames category `from` of list `kind` to `to` (trimmed) and every row that uses it; limit and place
 * kept. An operation whose «Что» is the old category name (the operation form stores the category as
 * «Что» when it is left empty) is renamed too, so an auto-named row keeps matching its category.
 * Throws for a name categoryNameError refuses (blank, or taken in this or the other list).
 */
export function renameCategory(d: Data, kind: CategoryKind, from: string, to: string): Data {
  const name = clean(to);
  if (name === from) return d;
  // like removeCategory: a blank or taken name (in either list) would merge or lose rows
  const refused = categoryNameError(d, kind, name, from);
  if (refused !== undefined) throw new Error(`cannot rename «${from}» to «${name}»: ${refused}`);
  const uses = matcher(d, kind, from);
  const rows = moveRows(d, kind, from, name);
  // moveRows keeps the order, so index i is the same operation before and after
  const operations = rows.operations.map((o, i) => {
    const old = d.operations[i];
    return old && old.what === from && uses(old, old.kind) ? { ...o, what: name } : o;
  });
  const moved = { ...rows, operations };
  const categories =
    kind === 'expense'
      ? { ...d.categories, expense: d.categories.expense.map((c) => (c.name === from ? { ...c, name } : c)) }
      : { ...d.categories, income: d.categories.income.map((c) => (c.name === from ? { ...c, name } : c)) };
  return { ...moved, categories };
}

const OTHER_LIST: Record<CategoryKind, string> = { expense: 'среди доходов', income: 'среди расходов' };

/**
 * Why `name` cannot be the name of a category of list `kind` (`current`: the name it has now), or
 * undefined. A name from the other list is refused too: rows are matched by name, so a shared name would
 * move rows between an expense and an income category (a name both lists already share, as an imported
 * tracker may have, stays usable as it is).
 */
export function categoryNameError(d: Data, kind: CategoryKind, name: string | undefined, current?: string): string | undefined {
  if (name === undefined || clean(name) === '') return 'Введите название';
  const k = key(name);
  if (d.categories[kind].some((c) => c.name !== current && key(c.name) === k)) return 'Такая категория уже есть';
  if (clean(name) === current) return undefined;
  const inOther = d.categories[other(kind)].some((c) => key(c.name) === k);
  return inOther ? `Такая категория уже есть ${OTHER_LIST[kind]}` : undefined;
}

/** Adds a category at the end of list `kind`; an expense category may get a limit. Throws for a refused name. */
export function addCategory(d: Data, kind: CategoryKind, name: string, limit?: number): Data {
  const refused = categoryNameError(d, kind, name);
  if (refused !== undefined) throw new Error(`cannot add «${name}»: ${refused}`);
  const n = clean(name);
  if (kind === 'income') return { ...d, categories: { ...d.categories, income: [...d.categories.income, { name: n }] } };
  const c: ExpenseCategory = limit === undefined ? { name: n } : { name: n, limit };
  return { ...d, categories: { ...d.categories, expense: [...d.categories.expense, c] } };
}

/** The monthly limit of expense category `name`; undefined removes it (0 is a limit). */
export function setLimit(d: Data, name: string, limit: number | undefined): Data {
  const expense = d.categories.expense.map((c): ExpenseCategory => {
    if (c.name !== name) return c;
    return limit === undefined ? { name: c.name } : { name: c.name, limit };
  });
  return { ...d, categories: { ...d.categories, expense } };
}

function moved<T>(list: readonly T[], index: number, delta: -1 | 1): T[] | null {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return null;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** Moves the category at `index` of list `kind` one place up (-1) or down (1); the same Data at the ends. */
export function moveCategory(d: Data, kind: CategoryKind, index: number, delta: -1 | 1): Data {
  if (kind === 'expense') {
    const expense = moved(d.categories.expense, index, delta);
    return expense ? { ...d, categories: { ...d.categories, expense } } : d;
  }
  const income = moved(d.categories.income, index, delta);
  return income ? { ...d, categories: { ...d.categories, income } } : d;
}

/**
 * Removes category `name` of list `kind`. Rows that use it move to category `target` of the same list
 * (null: «Без категории») in the same change. Throws when rows use it and no target is given, or the
 * target is not another category of that list — a removed name is never left behind in a row.
 */
export function removeCategory(d: Data, kind: CategoryKind, name: string, target?: string | null): Data {
  let next = d;
  if (categoryUsage(d, kind, name).total > 0) {
    if (target === undefined) throw new Error(`category «${name}» is still used`);
    if (target !== null && (target === name || !d.categories[kind].some((c) => c.name === target))) {
      throw new Error(`«${target}» is not another ${kind} category`);
    }
    next = moveRows(d, kind, name, target);
  }
  const categories =
    kind === 'expense'
      ? { ...next.categories, expense: next.categories.expense.filter((c) => c.name !== name) }
      : { ...next.categories, income: next.categories.income.filter((c) => c.name !== name) };
  return { ...next, categories };
}
