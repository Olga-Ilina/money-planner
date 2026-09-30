// One global place for sheets: any screen opens any form or the item card with openSheet(kind, props)
// without importing the other screens' internals. <SheetHost/> is rendered once by the app.
// Opening a sheet replaces the one that is open; closeSheet() (or the sheet's own onClose) closes it.
import { signal } from '@preact/signals';
import type { Debt, JournalRow, Operation, Purchase, Recurring } from '../../engine';
import { onResetSession } from '../state';
import { AddMenu } from './AddMenu';
import { DebtForm } from './DebtForm';
import { ItemSheet } from './ItemSheet';
import type { ItemRef } from './ItemSheet';
import { JournalForm } from './JournalForm';
import { OperationForm } from './OperationForm';
import { PurchaseForm } from './PurchaseForm';
import { RecurringForm } from './RecurringForm';

/** Props each kind of sheet takes (besides open/onClose, which the host supplies). */
export interface SheetPropsMap {
  operation: { initial?: Operation; preset?: Partial<Operation> };
  journal: { initial?: JournalRow; preset?: Partial<JournalRow> };
  recurring: { initial?: Recurring };
  purchase: { initial?: Purchase };
  debt: { initial?: Debt };
  item: { item: ItemRef };
  add: Record<string, never>;
}

export type SheetKind = keyof SheetPropsMap;

interface Current {
  kind: SheetKind;
  props: SheetPropsMap[SheetKind];
  open: boolean;
  key: number;
}

const CLEAR_AFTER_MS = 300; // after the exit animation

const current = signal<Current | null>(null);
let seq = 0;

type PropsArg<P> = Record<string, never> extends P ? [props?: P] : [props: P];

/** Opens sheet `kind` (replacing any open sheet). Props are optional unless the kind needs them. */
export function openSheet<K extends SheetKind>(kind: K, ...[props]: PropsArg<SheetPropsMap[K]>): void {
  seq += 1;
  current.value = { kind, props: (props ?? {}) as SheetPropsMap[SheetKind], open: true, key: seq };
}

/** Closes the open sheet (it slides away, then leaves the DOM). */
export function closeSheet(): void {
  const c = current.value;
  if (!c || !c.open) return;
  current.value = { ...c, open: false };
  const key = c.key;
  setTimeout(() => {
    if (current.value?.key === key && !current.value.open) current.value = null;
  }, CLEAR_AFTER_MS);
}

/** The kind of the open sheet, or null. */
export function openSheetKind(): SheetKind | null {
  const c = current.value;
  return c && c.open ? c.kind : null;
}

onResetSession(() => {
  current.value = null;
});

export function SheetHost() {
  const c = current.value;
  if (!c) return null;
  const common = { open: c.open, onClose: closeSheet };
  switch (c.kind) {
    case 'operation':
      return <OperationForm key={c.key} {...common} {...(c.props as SheetPropsMap['operation'])} />;
    case 'journal':
      return <JournalForm key={c.key} {...common} {...(c.props as SheetPropsMap['journal'])} />;
    case 'recurring':
      return <RecurringForm key={c.key} {...common} {...(c.props as SheetPropsMap['recurring'])} />;
    case 'purchase':
      return <PurchaseForm key={c.key} {...common} {...(c.props as SheetPropsMap['purchase'])} />;
    case 'debt':
      return <DebtForm key={c.key} {...common} {...(c.props as SheetPropsMap['debt'])} />;
    case 'add':
      return <AddMenu key={c.key} {...common} />;
    case 'item': {
      const { item } = c.props as SheetPropsMap['item'];
      return <ItemSheet key={c.key} item={c.open ? item : null} onClose={closeSheet} />;
    }
  }
}
