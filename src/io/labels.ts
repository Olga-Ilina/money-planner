// Russian labels the Excel tracker and the app's files use for enum values, and the reverse lookups.
// The labels themselves live in the engine (src/engine/labels.ts, shared with the screens); io re-exports them.
import { ACCOUNT_TYPE_LABEL, JOURNAL_STATUS_LABEL, KIND_LABEL } from '../engine/labels';
import type { AccountType, JournalStatus, OpKind } from '../engine/model';

export {
  ACCOUNT_TYPE_LABEL, DUPLICATE_LABEL, JOURNAL_STATUS_LABEL, KIND_LABEL, MOVEMENT_SOURCE_LABEL, PRIORITIES, SOURCE_LABEL,
} from '../engine/labels';

export const CHECK = '✓';

/** The key whose label equals the text, ignoring surrounding spaces and letter case. */
function byLabel<K extends string>(labels: Record<K, string>, text: string | undefined): K | undefined {
  const wanted = text?.trim().toLowerCase();
  if (!wanted) return undefined;
  return (Object.keys(labels) as K[]).find((key) => labels[key].toLowerCase() === wanted);
}

export function parseStatus(text: string | undefined): JournalStatus | undefined {
  return byLabel(JOURNAL_STATUS_LABEL, text);
}

/** 'Доход' → income, 'Расход' → expense, 'Перевод' → transfer. */
export function parseKind(text: string | undefined): OpKind | undefined {
  return byLabel(KIND_LABEL, text);
}

export function parseAccountType(text: string | undefined): AccountType | undefined {
  return byLabel(ACCOUNT_TYPE_LABEL, text);
}
