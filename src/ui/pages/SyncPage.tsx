// Page «Синхронизация» (registered as 'sync' in src/ui/pages.ts): the app and the Excel tracker on the Mac
// through a folder in iCloud Drive (spec .internal/specs/2026-10-01-icloud-sync.md; the shared logic is
// src/ui/sync.ts). The status (the last sync, unsent changes), «Отправить на Mac» (the full backup with a
// stamp through the share sheet), «Забрать с Mac» (the picked «Для приложения.xlsx»: checked by its stamp;
// unsent changes → «Сначала отправьте свои изменения на Mac» with «Отправить на Mac» (the Mac merges both
// sides), a Mac version built on the last send with nothing changed since → the usual import preview; the data
// set it replaces is kept) and «Вернуть данные до синхронизации».
import './SyncPage.css';
import { useEffect, useState } from 'preact/hooks';
import { actions } from '../actions';
import { backupNow } from '../backupNow';
import { formatDate, localDateOf, localTimeOf } from '../format';
import { isStale } from '../generation';
import { ioErrorMessage, loadSync, loadTrackerImport } from '../io';
import { Banner, Button, Page, Row, Section, Sheet, showToast } from '../kit';
import type { RoutedPageProps } from '../nav';
import { pickFile } from '../share';
import { appData, meta } from '../state';
import {
  FROM_MAC_FILE, NothingKeptError, SYNC_FOLDER, beforeSync, classifyPickUp, hasUnsent, hashOf, refreshBeforeSync,
  replaceKeepingBefore, resolveSentDirty, restoreBeforeSync, sendToMac, sending, syncOf, useUnsent,
} from '../sync';
import { ReplaceDataSheet, XLSX_ACCEPT } from './ReplaceDataSheet';
import type { PendingReplace } from './ReplaceDataSheet';

/** «01.10.2026, 23:05» for a stored timestamp; undefined when it cannot be read. */
export function syncTime(stamp: string | undefined): string | undefined {
  const day = localDateOf(stamp);
  const time = localTimeOf(stamp);
  return day && time ? `${formatDate(day)}, ${time}` : undefined;
}

/** A read file waiting for the choice; `take` when it is a Mac version (its id and the hash of its data). */
interface Picked extends PendingReplace {
  take: { id: string; hash: string } | null;
}

type Warn = 'unsent' | 'never-sent' | 'not-seen';

const WARN_TITLE: Record<Warn, string> = {
  unsent: 'Изменения не отправлены',
  'never-sent': 'Изменения не отправлены',
  'not-seen': 'Изменения ещё не на Mac',
};

// The Mac merges both sides itself (spec 2026-10-04-auto-merge), except when the category or account lists, the
// start of accounting or the balances date were changed on either side, or merging fails: then it asks which
// version to keep and shows a notice (spec, «Дополнение 14:35»), so no text here promises a merge that never asks.
// What the app holds and has not sent is never replaced by a Mac file without a word: the guard says «send first»,
// the way forward being the one filled button; replacing anyway stays an explicit, destructive second choice (the
// data set it replaces is kept).
const SEND_FIRST = 'Сначала отправьте свои изменения на Mac — он объединит их с правками в Excel.';
const WARN_TEXT: Record<Warn, string> = {
  unsent: `${SEND_FIRST} Если заменить данные файлом с Mac, изменения из приложения пропадут.`,
  'never-sent': `Данные из приложения ещё ни разу не отправлялись на Mac. ${SEND_FIRST} Если заменить их файлом с Mac, всё, что есть только в приложении, пропадёт.`,
  'not-seen':
    'Последняя отправка из приложения ещё не попала в трекер на Mac: этот файл сделан без неё. Mac объединит её с правками в Excel сам, а если не сможет — спросит, какую версию оставить. Включите его и заберите файл позже. Если заменить данные сейчас, изменения из неё пропадут из приложения.',
};

const FROM_APP = `Это файл, отправленный из приложения. Выберите «${FROM_MAC_FILE}».`;
const NOTHING_NEW = 'Нового нет, всё синхронизировано.';
const NOTHING_NEW_UNSENT = 'Нового на Mac нет. Изменения из приложения ещё не отправлены — нажмите «Отправить на Mac».';
const KEPT_NOTE =
  'Данные в приложении заменятся данными из файла. Прежние данные сохранятся: их можно вернуть кнопкой «Вернуть данные до синхронизации».';

async function readTracker(buf: ArrayBuffer): Promise<PendingReplace> {
  const { importTracker } = await loadTrackerImport();
  return importTracker(buf);
}

export function SyncPage(_props: RoutedPageProps) {
  const s = syncOf(meta.value);
  const unsent = useUnsent();
  const kept = beforeSync.value;
  const [reading, setReading] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning' | 'error'; text: string } | null>(null);
  const [warning, setWarning] = useState<{ picked: Picked; warn: Warn } | null>(null);
  const [pending, setPending] = useState<Picked | null>(null);
  // a fresh preview sheet for every file read
  const [opened, setOpened] = useState(0);
  const [restoreOpen, setRestoreOpen] = useState(false);

  useEffect(() => {
    void refreshBeforeSync();
  }, []);

  const preview = (picked: Picked) => {
    setPending(picked);
    setOpened((n) => n + 1);
  };

  /** «Забрать с Mac». Call straight from the tap: Safari opens the picker only then. */
  const pick = () => {
    if (reading) return;
    const picked = pickFile(XLSX_ACCEPT); // rejects with «Файл больше 20 МБ» for a file that is too big
    void (async () => {
      try {
        const file = await picked;
        if (!file) return;
        setNotice(null);
        setReading(true);
        const buf = await file.arrayBuffer();
        const stamp = await (await loadSync()).readStamp(buf);
        const d = appData();
        const state = syncOf(meta.value);
        const changed = stamp?.from === 'mac' ? await hasUnsent(d, state) : false;
        const what = classifyPickUp(stamp, state, changed);
        if (what.kind === 'from-app') {
          setNotice({ tone: 'warning', text: FROM_APP });
          return;
        }
        if (what.kind === 'nothing-new') {
          setNotice({ tone: 'info', text: changed ? NOTHING_NEW_UNSENT : NOTHING_NEW });
          if (state) void resolveSentDirty(state); // the Mac has the version last sent
          return;
        }
        const result = await readTracker(buf);
        const take = what.kind === 'take' ? { id: what.id, hash: await hashOf(result.data) } : null;
        const next: Picked = { ...result, take };
        if (what.kind === 'take' && what.warn) {
          setWarning({ picked: next, warn: what.warn === 'unsent' && !state ? 'never-sent' : what.warn });
        } else {
          preview(next);
        }
      } catch (e) {
        setNotice({ tone: 'error', text: ioErrorMessage(e) });
      } finally {
        setReading(false);
      }
    })();
  };

  const onReplaced = async () => {
    const done = pending;
    setPending(null);
    const at = new Date().toISOString();
    if (!done?.take) {
      // a tracker without a stamp: the usual import; only a date shown on «Загрузить трекер»
      actions.updateMeta((m) => ({ ...m, lastImportAt: at })).catch(() => {});
      showToast('Трекер загружен');
      return;
    }
    try {
      await actions.setSync({ lastId: done.take.id, lastAt: at, syncedHash: done.take.hash });
      showToast('Данные с Mac загружены');
    } catch (e) {
      if (!isStale(e)) showToast('Данные с Mac загружены, но отметка синхронизации не сохранилась');
    }
  };

  const last = syncTime(s?.lastAt);
  const keptAt = kept ? syncTime(kept.at) : undefined;

  return (
    <Page title="Синхронизация" subtitle="С трекером на Mac через iCloud Drive">
      <Section>
        {/* the time under the title: «01.10.2026, 23:05» next to it would wrap the title at 375 pt */}
        <Row title="Последняя синхронизация" subtitle={s ? (last ?? '—') : 'ещё не было'} />
        {unsent !== undefined && (
          <Row
            icon={unsent ? 'warning' : 'check-circle'}
            iconTone={unsent ? 'orange' : 'green'}
            title={unsent ? 'Есть неотправленные изменения' : 'Всё отправлено'}
          />
        )}
      </Section>

      <div class="sync-send">
        {/* straight from the tap: Safari opens the share sheet only then */}
        <Button full disabled={sending.value} onClick={() => void sendToMac()}>
          Отправить на Mac
        </Button>
        <p class="sync-hint">{`В окне «Поделиться»: «In Dateien sichern» → папка «${SYNC_FOLDER}» → «Sichern».`}</p>
      </div>

      <Section header="С Mac">
        <Row
          icon="upload"
          title="Забрать с Mac"
          subtitle={reading ? 'Читаю файл…' : `Файл «${FROM_MAC_FILE}» из той же папки`}
          chevron
          onClick={pick}
        />
        {kept && (
          <Row
            icon="repeat"
            title="Вернуть данные до синхронизации"
            subtitle={keptAt ? `Как было до ${keptAt}` : undefined}
            chevron
            onClick={() => setRestoreOpen(true)}
          />
        )}
      </Section>
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}

      <Section header="Как это работает">
        <Row
          icon="info"
          title="На Mac"
          subtitle="Mac сам объединяет правки из приложения и из Excel: добавленное, изменённое и удалённое с обеих сторон. Он делает это, когда трекер закрыт, и перед этим сохраняет резервную копию трекера. Если трекер изменился на Mac, в папке появляется «Для приложения.xlsx». Если на одной из сторон менялись списки категорий или счетов, начало учёта или дата остатков либо объединить не получилось, Mac не объединяет сам — он спросит, какую версию оставить, и покажет уведомление."
        />
        <Row
          icon="info"
          title="На телефоне"
          subtitle="Два касания остаются: «Отправить на Mac» и «Забрать с Mac». Сначала отправьте свои изменения — Mac объединит их с правками в Excel, потом заберите результат."
        />
        <Row
          icon="warning"
          title="Mac должен быть включён"
          subtitle="И подключён к iCloud, иначе файлы между ним и приложением не передаются."
        />
      </Section>

      <Sheet
        open={warning !== null}
        title={warning ? WARN_TITLE[warning.warn] : WARN_TITLE.unsent}
        onClose={() => setWarning(null)}
        left={
          <Button kind="plain" onClick={() => setWarning(null)}>
            Отмена
          </Button>
        }
      >
        {warning && <p class="sheet-text">{WARN_TEXT[warning.warn]}</p>}
        <div class="sheet-actions">
          {warning && warning.warn !== 'not-seen' && (
            <Button
              full
              disabled={sending.value}
              onClick={() => {
                setWarning(null);
                void sendToMac(); // straight from the tap
              }}
            >
              Отправить на Mac
            </Button>
          )}
          <Button
            kind="destructive"
            full
            onClick={() => {
              const w = warning;
              setWarning(null);
              if (w) preview(w.picked);
            }}
          >
            Всё равно заменить
          </Button>
        </div>
      </Sheet>

      <ReplaceDataSheet
        key={opened}
        pending={pending}
        onClose={() => setPending(null)}
        onReplaced={() => void onReplaced()}
        replace={replaceKeepingBefore}
        note={KEPT_NOTE}
      />

      <RestoreSheet key={restoreOpen ? 'open' : 'closed'} open={restoreOpen} at={keptAt} onClose={() => setRestoreOpen(false)} />
    </Page>
  );
}

/** «Вернуть данные до синхронизации»: asks first (with «Сначала сделать копию»), as every replacement does. */
function RestoreSheet({ open, at, onClose }: { open: boolean; at: string | undefined; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      await restoreBeforeSync(); // says how it went in a toast
    } catch (e) {
      setError(e instanceof NothingKeptError ? e.message : ioErrorMessage(e));
      setBusy(false);
      return;
    }
    setBusy(false);
    onClose();
  };

  const when = at ? ` ${at}` : '';
  return (
    <Sheet
      open={open}
      title="Вернуть данные до синхронизации"
      onClose={close}
      left={
        <Button kind="plain" onClick={close} disabled={busy}>
          Отмена
        </Button>
      }
    >
      <p class="sheet-text">{`Данные в приложении станут такими, какими были до синхронизации${when}. Всё, что изменено после неё, пропадёт.`}</p>
      {error && <Banner tone="error">{error}</Banner>}
      <div class="sheet-actions">
        <Button kind="plain" full disabled={busy || copied} onClick={() => void copyFirst()}>
          {copied ? 'Копия сделана' : 'Сначала сделать копию'}
        </Button>
        <Button kind="destructive" full disabled={busy} onClick={() => void restore()}>
          Вернуть данные
        </Button>
      </div>
    </Sheet>
  );
}
