// Replacing all data from a file — «Загрузить трекер» and «Восстановить из копии» (owner: D6).
// usePickedFile: picks an .xlsx inside the tap, reads and parses it; nothing changes yet. Then
// ReplaceDataSheet shows what is in the file next to what is in the app now, offers «Сначала сделать
// копию» (backupNow) and only on «Заменить данные в приложении» calls actions.replaceData — not
// undoable, saved before it is shown; a failure leaves everything as it was and says why.
import './ReplaceDataSheet.css';
import { useState } from 'preact/hooks';
import { addMonths } from '../../engine';
import type { Data } from '../../engine';
import { actions } from '../actions';
import { backupNow } from '../backupNow';
import { ioErrorMessage } from '../io';
import { Banner, Button, Row, Section, Sheet } from '../kit';
import { XLSX_MIME, pickFile } from '../share';
import { appData } from '../state';
import { monthRange } from './usageText';

export const XLSX_ACCEPT = `.xlsx,${XLSX_MIME}`;

/** A file that has been read and is waiting for the user's choice. */
export interface PendingReplace {
  data: Data;
  /** Rows skipped or changed on the way in (tracker import). */
  notes: string[];
  /** Numbers typed over formulas, not carried over (tracker import). */
  overrides: string[];
}

export type ReadFile<T extends PendingReplace = PendingReplace> = (buf: ArrayBuffer) => Promise<T>;

/** Picking and reading a file; `pending` is the result (null while there is none), as `read` gave it. */
export function usePickedFile<T extends PendingReplace = PendingReplace>() {
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<T | null>(null);
  // a fresh sheet for every file read
  const [opened, setOpened] = useState(0);

  /** Call straight from the tap: Safari opens the picker only then. */
  const pick = (read: ReadFile<T>) => {
    if (reading) return;
    const picked = pickFile(XLSX_ACCEPT); // rejects with «Файл больше 20 МБ» for a file that is too big
    void (async () => {
      try {
        const file = await picked;
        if (!file) return;
        setError(null);
        setReading(true);
        const result = await read(await file.arrayBuffer());
        setPending(result);
        setOpened((n) => n + 1);
      } catch (e) {
        setError(ioErrorMessage(e));
      } finally {
        setReading(false);
      }
    })();
  };

  return { reading, error, pending, opened, pick, clear: () => setPending(null) };
}

const COUNTS: [string, (d: Data) => number][] = [
  ['Счета', (d) => d.accounts.length],
  ['Операции', (d) => d.operations.length],
  ['Плановые записи', (d) => d.journal.length],
  ['Постоянные', (d) => d.recurring.length],
  ['Покупки', (d) => d.purchases.length],
  ['Долги', (d) => d.debts.length],
];

function yearOf(d: Data): string {
  const s = d.settings.accountingStart;
  return monthRange(s, addMonths(s, 11));
}

export interface ReplaceDataSheetProps {
  pending: PendingReplace | null;
  onClose: () => void;
  /** Called once the new data is saved and shown. */
  onReplaced: () => void;
  /** How the data is replaced (default actions.replaceData; «Забрать с Mac» keeps the data it replaces first). */
  replace?: (next: Data) => Promise<void>;
  /** The line under the counts (default: the file replaces the data, not undoable). */
  note?: string;
}

const NOT_UNDOABLE = 'Сейчас в приложении другие данные. Файл заменит их, это нельзя отменить.';

export function ReplaceDataSheet({ pending, onClose, onReplaced, replace: replaceWith = actions.replaceData, note = NOT_UNDOABLE }: ReplaceDataSheetProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const current = appData();
  const next = pending?.data;

  const close = () => {
    if (!busy) onClose();
  };

  const copyFirst = async () => {
    setBusy(true);
    try {
      // backupNow shows its own toast when the copy cannot be made
      if ((await backupNow()) !== 'cancelled') setCopied(true);
    } finally {
      setBusy(false);
    }
  };

  const replace = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await replaceWith(pending.data);
    } catch (e) {
      setError(ioErrorMessage(e));
      setBusy(false);
      return;
    }
    setBusy(false);
    onReplaced();
  };

  const notes = pending?.notes ?? [];
  const overrides = pending?.overrides ?? [];
  const remarks = [
    notes.length > 0 ? `замечаний: ${notes.length}` : '',
    overrides.length > 0 ? `чисел поверх формул: ${overrides.length}` : '',
  ].filter(Boolean).join(', ');

  return (
    <Sheet
      open={pending !== null}
      title="Заменить данные в приложении"
      onClose={close}
      left={
        <Button kind="plain" onClick={close} disabled={busy}>
          Отмена
        </Button>
      }
    >
      {next && (
        <Section header="В файле" footer={`Учётный год в файле: ${yearOf(next)}.`}>
          {COUNTS.map(([title, count]) => (
            <Row
              key={title}
              title={title}
              value={
                <>
                  {/* read as one phrase; the compact «сейчас 6   6» is for the eyes only */}
                  <span class="sr-only">{`в файле ${count(next)}, сейчас ${count(current)}`}</span>
                  <span aria-hidden="true">
                    <span class="replace-now">сейчас {count(current)}</span>
                    {count(next)}
                  </span>
                </>
              }
            />
          ))}
        </Section>
      )}
      <p class="sheet-text">{note}</p>
      {remarks && <p class="sheet-text">{`${remarks[0]?.toUpperCase()}${remarks.slice(1)} — список ниже.`}</p>}
      {error && <Banner tone="error">{error}</Banner>}
      <div class="sheet-actions replace-actions">
        <Button kind="plain" full disabled={busy || copied} onClick={() => void copyFirst()}>
          {copied ? 'Копия сделана' : 'Сначала сделать копию'}
        </Button>
        <Button kind="destructive" full disabled={busy} onClick={() => void replace()}>
          Заменить данные в приложении
        </Button>
      </div>
      {notes.length > 0 && (
        <Section header="Замечания">
          {notes.map((n, i) => (
            <Row key={i} title={n} />
          ))}
        </Section>
      )}
      {overrides.length > 0 && (
        <Section header="Числа поверх формул" footer="Эти числа не перенесены: приложение считает такие ячейки само.">
          {overrides.map((n, i) => (
            <Row key={i} title={n} />
          ))}
        </Section>
      )}
    </Sheet>
  );
}
