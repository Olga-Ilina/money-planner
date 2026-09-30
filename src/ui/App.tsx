// The app: loads the data and the PIN state, then shows onboarding (no data and no PIN), the lock
// screen (always on start, and after 5 minutes in the background) or the five tabs. After the first
// unlock the tabs stay mounted — hidden and inert — while locked, so an open form survives the lock.
// Data without a valid PIN fails closed: only deleting everything (and restoring a backup) goes on.
// Once another tab has deleted the data or set up new ones (generation.ts), only the stop screen is shown.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Data } from '../engine';
import { StaleTabError, StoreError, hasGeneration, loadData, loadMeta, loadMetaAtStart } from '../store/db';
import type { Meta } from '../store/db';
import { reloadApp, setGenerationPending } from './generation';
import { ioErrorMessage } from './io';
import { Banner, Button, Icon, OverlayHost, Toast, focusOpenModal } from './kit';
import { Lock } from './Lock';
import { currentPage } from './nav';
import { Onboarding } from './Onboarding';
import { applyUpdate, checkForUpdate, dismissUpdate, updateReady } from './pwa';
import { useScrollMemory } from './scroll';
import { watchSession } from './session';
import { SheetHost } from './sheets/host';
import { data, hasPin, locked, meta, stopped, tab } from './state';
import { TabBar } from './TabBar';
import { TabContent } from './TabContent';
import { WipeSheet } from './WipeSheet';

/** What the start screen offers: deleting the data (damaged), updating the app (newer data), or only retrying. */
interface Problem {
  message: string;
  offer: 'wipe' | 'update' | 'retry';
}

type Phase = { kind: 'loading' } | { kind: 'error'; problem: Problem } | { kind: 'ready' };

export const PIN_DAMAGED =
  'Не удалось проверить PIN: его настройки повреждены или пропали. Без PIN данные не открываются — их можно удалить и вернуть из резервной копии.';

/** Decided by the StoreError code, never by the message text. */
function startProblem(e: unknown): Problem {
  if (!(e instanceof StoreError)) return { message: ioErrorMessage(e), offer: 'retry' };
  switch (e.code) {
    case 'newer-version':
      return { message: e.message, offer: 'update' };
    case 'meta-damaged':
      return { message: PIN_DAMAGED, offer: 'wipe' };
    case 'damaged':
    case 'read':
      return { message: e.message, offer: 'wipe' };
    default:
      // unavailable storage, no space…: deleting would not help
      return { message: e.message, offer: 'retry' };
  }
}

/** Tries of loadDataSet before it gives up (another tab keeps changing the data set meanwhile). */
const LOAD_TRIES = 3;

/**
 * The meta and the data of ONE data set: the meta (loadMetaAtStart: an old meta gets its generation), then
 * the data, then the meta again — when another tab deleted the data or set up new ones in between (another
 * generation now), the data read may belong to another data set than the meta, so everything is read again.
 * Rejects with StaleTabError when that keeps happening.
 */
async function loadDataSet(): Promise<{ m: Meta; d: Data | null }> {
  for (let i = 0; i < LOAD_TRIES; i++) {
    const m = await loadMetaAtStart();
    const d = await loadData();
    if (Object.is((await loadMeta()).generation, m.generation)) return { m, d };
  }
  throw new StaleTabError();
}

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const opened = useRef(false);

  const start = async () => {
    setPhase({ kind: 'loading' });
    try {
      const { m, d } = await loadDataSet();
      if (d && !hasPin(m)) {
        // data without a usable PIN: never onboarding (that would set a new PIN over the data)
        setPhase({ kind: 'error', problem: { message: PIN_DAMAGED, offer: 'wipe' } });
        return;
      }
      meta.value = m;
      // an old meta whose new generation could not be stored (no space left): the next meta write stores it
      setGenerationPending(hasPin(m) && !hasGeneration(m));
      data.value = d;
      locked.value = hasPin(m);
      setPhase({ kind: 'ready' });
    } catch (e) {
      setPhase({ kind: 'error', problem: startProblem(e) });
    }
  };

  useEffect(() => {
    void start();
    return watchSession();
  }, []);

  const pin = hasPin(meta.value);
  const d = data.value;
  const isLocked = locked.value;
  const isStopped = stopped.value;
  if (phase.kind !== 'ready' || !pin || !d || isStopped) opened.current = false;
  else if (!isLocked) opened.current = true;

  let screen = null;
  if (isStopped) screen = <Stopped />;
  else if (phase.kind === 'loading') screen = <div class="splash" aria-busy="true" />;
  else if (phase.kind === 'error') screen = <StartError problem={phase.problem} onRetry={() => void start()} />;
  else if (!pin && d) screen = <StartError problem={{ message: PIN_DAMAGED, offer: 'wipe' }} onRetry={() => void start()} />;
  else if (!pin) screen = <Onboarding />;
  else if (isLocked) screen = <Lock />;
  else if (!d) screen = <Onboarding />;

  return (
    <div class="app">
      <UpdateBanner />
      {screen}
      {opened.current && <Shell key="shell" hidden={isLocked} />}
    </div>
  );
}

function Shell({ hidden }: { hidden: boolean }) {
  const t = tab.value;
  useScrollMemory(currentPage(t) ?? `root:${t}`, hidden);
  // back from the lock screen with a sheet open: focus goes into the sheet (its Tab trap and Esc work again)
  useEffect(() => {
    if (!hidden) focusOpenModal();
  }, [hidden]);
  return (
    <div class="shell" hidden={hidden} inert={hidden} aria-hidden={hidden ? 'true' : undefined}>
      {/* every sheet renders into the overlay root at the end of this host — inside the shell */}
      <OverlayHost>
        <main class="tab-content">
          <TabContent tab={t} />
        </main>
        <TabBar />
        <SheetHost />
      </OverlayHost>
      <Toast />
    </div>
  );
}

function UpdateBanner() {
  if (!updateReady.value) return null;
  return (
    <div class="update-banner">
      <Banner tone="info" action={{ label: 'Обновить', onClick: () => void applyUpdate() }} onClose={dismissUpdate}>
        Доступна новая версия
      </Banner>
    </div>
  );
}

function StartError({ problem, onRetry }: { problem: Problem; onRetry: () => void }) {
  const [wipe, setWipe] = useState(false);
  if (problem.offer === 'update') return <NeedsUpdate message={problem.message} onRetry={onRetry} />;
  return (
    <div class="start-error">
      <span class="start-error-icon">
        <Icon name="warning" size={44} />
      </span>
      <h1 class="start-error-title">Не удалось открыть данные</h1>
      <p class="start-error-text">{problem.message}</p>
      <div class="start-error-actions">
        <Button full onClick={onRetry}>
          Попробовать снова
        </Button>
        {problem.offer === 'wipe' && (
          <Button kind="destructive" full onClick={() => setWipe(true)}>
            Удалить данные…
          </Button>
        )}
      </div>
      {problem.offer === 'wipe' && (
        <WipeSheet
          open={wipe}
          title="Удалить данные"
          intro="Если данные не открываются, их можно удалить из приложения вместе с PIN и начать заново, а потом вернуть данные из резервной копии."
          onClose={() => setWipe(false)}
          onWiped={onRetry}
        />
      )}
    </div>
  );
}

/**
 * Another tab deleted the data or set up new ones: this tab's copy is stale. Nothing of it is shown (the tabs
 * are unmounted) or saved; only a reload goes on — it opens the data set that is stored now.
 */
function Stopped() {
  return (
    <div class="start-error">
      <span class="start-error-icon">
        <Icon name="warning" size={44} />
      </span>
      <h1 class="start-error-title">Данные изменились</h1>
      <p class="start-error-text">{new StaleTabError().message}</p>
      <div class="start-error-actions">
        <Button full onClick={reloadApp}>
          Перезапустить
        </Button>
      </div>
    </div>
  );
}

/** Data saved by a newer app version: only a newer app can read it — nothing is deleted here. */
function NeedsUpdate({ message, onRetry }: { message: string; onRetry: () => void }) {
  const [state, setState] = useState<'idle' | 'checking' | 'none'>('idle');
  const update = async () => {
    setState('checking');
    if (await checkForUpdate()) {
      await applyUpdate(); // reloads into the new version
      return;
    }
    setState('none');
  };
  return (
    <div class="start-error">
      <span class="start-error-icon">
        <Icon name="download" size={44} />
      </span>
      <h1 class="start-error-title">Обновите приложение</h1>
      <p class="start-error-text">{message}</p>
      {state === 'none' && (
        <p class="start-error-text" role="status">
          Новая версия не найдена. Подключитесь к интернету и попробуйте ещё раз.
        </p>
      )}
      <div class="start-error-actions">
        <Button full disabled={state === 'checking'} onClick={() => void update()}>
          {state === 'checking' ? 'Ищем новую версию…' : 'Обновить приложение'}
        </Button>
        <Button kind="plain" full onClick={onRetry}>
          Попробовать снова
        </Button>
      </div>
    </div>
  );
}
