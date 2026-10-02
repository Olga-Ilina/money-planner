// First run (no data and no PIN): invent a PIN (twice), then «С чего начнём?» — load the Excel
// tracker, restore a backup made by this app, or start from scratch. The PIN is hashed as soon as it
// is confirmed (the digits are never stored); the PIN and the data are saved together at the end, PIN
// first, with a new data generation (generation.ts) — only while no PIN is stored: one set up in another
// tab meanwhile is never written over. When the data save fails after the PIN was stored, trying again
// keeps that PIN and its generation (another PIN stored meanwhile still refuses). Also shown, from «С чего
// начнём?», when a PIN exists but there is no data (a lost data document). Data without a PIN never gets
// here: the app fails closed (App.tsx).
import { useState } from 'preact/hooks';
import { emptyData } from '../engine';
import type { Data } from '../engine';
import { newGeneration, requestPersistence } from '../store/db';
import type { Meta } from '../store/db';
import { setPin } from '../store/pin';
import { actions } from './actions';
import { todayISO } from './format';
import { ioErrorMessage, loadBackup } from './io';
import { PinChangedError } from './lockState';
import { Banner, Button, Page, PinPad, Row, Section, Sheet } from './kit';
import { XLSX_MIME, pickFile } from './share';
import { hasPin, meta, samePin, tab } from './state';
import { readTrackerStamped, setSyncFromImport } from './sync';
import type { MacVersion } from './sync';

const PIN_LENGTH = 4;
const XLSX_ACCEPT = `.xlsx,${XLSX_MIME}`;
const PIN_FAILED = 'Не удалось создать PIN. Попробуйте ещё раз.';

type Step = 'pin1' | 'pin2' | 'start';
type Source = 'tracker' | 'backup' | 'empty';

interface Pending {
  source: 'tracker' | 'backup';
  data: Data;
  notes: string[];
  overrides: string[];
  /** The Mac version a tracker carries («Для приложения.xlsx»): the sync state once it is saved. */
  mac?: MacVersion | null;
}

export function Onboarding() {
  const [step, setStep] = useState<Step>(() => (hasPin(meta.value) ? 'start' : 'pin1'));
  const [first, setFirst] = useState('');
  const [entry, setEntry] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const [shake, setShake] = useState(0);
  const [pinMeta, setPinMeta] = useState<Meta | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  /** Saves the PIN (first) and the data, then opens «Сегодня» (and records the Mac version `mac`, if any). */
  const finish = async (d: Data | null, source: Source | null, mac?: MacVersion | null) => {
    setBusy(true);
    setError(null);
    const importedAt = source === 'tracker' ? new Date().toISOString() : undefined;
    try {
      if (pinMeta) {
        // the new PIN (and the import date) onto the stored meta — only while no PIN is stored: one set up in
        // another tab meanwhile is never written over. This very onboarding's PIN stored already (a try whose
        // data save failed): a retry — the PIN, the generation, the counter and the pause stay as stored
        const n = pinMeta;
        await actions.updateMeta(
          (stored) => {
            if (hasPin(stored) && samePin(stored, n)) return importedAt ? { ...stored, lastImportAt: importedAt } : stored;
            if (hasPin(stored)) throw new PinChangedError();
            const next: Meta = {
              ...stored, pinHash: n.pinHash, pinSalt: n.pinSalt, pinIterations: n.pinIterations, failedAttempts: 0,
              generation: newGeneration(), // a new data set: other tabs still holding an older one stop
            };
            delete next.lockedUntil;
            if (importedAt) next.lastImportAt = importedAt;
            return next;
          },
          { pin: true },
        );
      } else if (importedAt) {
        await actions.updateMeta((stored) => ({ ...stored, lastImportAt: importedAt }));
      }
      if (d) await actions.replaceData(d);
    } catch (e) {
      setError(ioErrorMessage(e));
      setBusy(false);
      return;
    }
    void requestPersistence();
    tab.value = 'today';
    setPending(null);
    setBusy(false);
    if (mac) void setSyncFromImport(mac); // only once the data are saved: never a sync state without them
  };

  const onPin = async (value: string) => {
    setMismatch(false);
    setError(null);
    setEntry(value);
    if (value.length < PIN_LENGTH) return;
    if (step === 'pin1') {
      setFirst(value);
      setEntry('');
      setStep('pin2');
      return;
    }
    if (value !== first) {
      setFirst('');
      setEntry('');
      setMismatch(true);
      setShake((n) => n + 1);
      setStep('pin1');
      return;
    }
    setBusy(true);
    let m: Meta;
    try {
      m = await setPin(meta.value, value);
    } catch {
      // no WebCrypto (or it failed): nothing is saved, start the PIN again
      setFirst('');
      setEntry('');
      setError(PIN_FAILED);
      setStep('pin1');
      setBusy(false);
      return;
    }
    setFirst('');
    setEntry('');
    setPinMeta(m);
    setBusy(false);
    setStep('start');
  };

  /** Picks an .xlsx (synchronously, inside the tap) and reads it with `read`. */
  const readFile = (source: Pending['source'], read: (buf: ArrayBuffer) => Promise<Omit<Pending, 'source'>>) => {
    if (busy) return;
    const picked = pickFile(XLSX_ACCEPT); // rejects with «Файл больше 20 МБ» for a file that is too big
    void (async () => {
      try {
        const file = await picked;
        if (!file) return;
        setError(null);
        setBusy(true);
        const result = await read(await file.arrayBuffer());
        setPending({ source, ...result });
      } catch (e) {
        setError(ioErrorMessage(e));
      } finally {
        setBusy(false);
      }
    })();
  };

  const importTrackerFile = () => readFile('tracker', readTrackerStamped);

  const restoreBackup = () =>
    readFile('backup', async (buf) => {
      const { importBackup } = await loadBackup();
      return { data: await importBackup(buf), notes: [], overrides: [] };
    });

  if (step !== 'start') {
    return (
      <div class="lock-screen">
        <PinPad
          title={step === 'pin1' ? 'Придумайте PIN' : 'Повторите PIN'}
          message={mismatch ? 'PIN не совпадает. Попробуйте ещё раз.' : step === 'pin1' ? 'Четыре цифры для входа в приложение' : undefined}
          messageTone={mismatch ? 'error' : 'default'}
          value={entry}
          onChange={(v) => void onPin(v)}
          length={PIN_LENGTH}
          disabled={busy}
          shake={shake}
          footer={<p class="pin-note">Если забудете PIN, данные можно вернуть только из резервной копии.</p>}
        />
        {error && <Banner tone="error">{error}</Banner>}
      </div>
    );
  }

  return (
    <div class="onboarding">
      <Page title="С чего начнём?" subtitle="Данные хранятся только на этом устройстве.">
        {error && !pending && <Banner tone="error">{error}</Banner>}
        <Section footer={busy ? 'Минутку…' : 'Трекер и резервную копию можно загрузить и позже: «Ещё».'}>
          <Row
            icon="upload"
            title="Загрузить трекер из Excel"
            subtitle="Файл «Трекер и планер расходов» (.xlsx)"
            chevron
            onClick={importTrackerFile}
          />
          <Row
            icon="repeat"
            title="Восстановить из резервной копии"
            subtitle="Копия, выгруженная из этого приложения"
            chevron
            onClick={restoreBackup}
          />
          <Row
            icon="plus"
            title="Начать с нуля"
            subtitle="Пустой учёт с обычными категориями"
            chevron
            onClick={() => {
              if (!busy) void finish(emptyData(todayISO()), 'empty');
            }}
          />
        </Section>
      </Page>
      <ImportSummary
        pending={pending}
        busy={busy}
        error={pending ? error : null}
        onCancel={() => {
          if (!busy) setPending(null);
        }}
        onDone={() => pending && void finish(pending.data, pending.source, pending.mac)}
      />
    </div>
  );
}

interface ImportSummaryProps {
  pending: Pending | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onDone: () => void;
}

function ImportSummary({ pending, busy, error, onCancel, onDone }: ImportSummaryProps) {
  const d = pending?.data;
  const counts: [string, number][] = d
    ? [
        ['Счета', d.accounts.length],
        ['Операции', d.operations.length],
        ['Плановые записи', d.journal.length],
        ['Постоянные', d.recurring.length],
        ['Покупки', d.purchases.length],
        ['Долги', d.debts.length],
      ]
    : [];
  return (
    <Sheet
      open={pending !== null}
      title={pending?.source === 'backup' ? 'Копия прочитана' : 'Трекер загружен'}
      onClose={onCancel}
      left={
        <Button kind="plain" onClick={onCancel} disabled={busy}>
          Отмена
        </Button>
      }
    >
      <Section header="Найдено">
        {counts.map(([title, n]) => (
          <Row title={title} value={String(n)} />
        ))}
      </Section>
      {pending && pending.notes.length > 0 && (
        <Section header="Замечания">
          {pending.notes.map((n) => (
            <Row title={n} />
          ))}
        </Section>
      )}
      {pending && pending.overrides.length > 0 && (
        <Section header="Числа поверх формул" footer="Эти числа не перенесены: приложение считает такие ячейки само.">
          {pending.overrides.map((n) => (
            <Row title={n} />
          ))}
        </Section>
      )}
      {error && <Banner tone="error">{error}</Banner>}
      <div class="sheet-actions">
        <Button full onClick={onDone} disabled={busy}>
          Готово
        </Button>
      </div>
    </Sheet>
  );
}
