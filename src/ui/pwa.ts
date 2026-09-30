// App updates: the service worker (src/ui/registerPwa.ts, started by main.tsx) reports a new
// version; the app shows «Доступна новая версия» and applies it on «Обновить». checkForUpdate() asks
// for a new version right away (the start screen for data saved by a newer version).
import { signal } from '@preact/signals';
import { actions } from './actions';

export const updateReady = signal(false);

type Updater = (reloadPage?: boolean) => Promise<void>;
type Registration = Pick<ServiceWorkerRegistration, 'update' | 'installing' | 'waiting'>;

const INSTALL_WAIT_MS = 60_000;

let updater: Updater | null = null;
let registration: Registration | null = null;

export function setUpdater(u: Updater | null): void {
  updater = u;
}

export function setRegistration(r: Registration | null): void {
  registration = r;
}

/** Waits until `worker` has installed (or failed), at most `ms`. */
function installed(worker: ServiceWorker, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      worker.removeEventListener('statechange', onState);
      resolve();
    };
    const onState = () => {
      if (worker.state === 'installed' || worker.state === 'redundant' || worker.state === 'activated') done();
    };
    const timer = setTimeout(done, ms);
    worker.addEventListener('statechange', onState);
  });
}

/**
 * Looks for a new version now; resolves true when one is ready to apply (then applyUpdate()), false
 * when there is none, the check failed (offline) or the service worker is not running.
 */
export async function checkForUpdate(): Promise<boolean> {
  if (updateReady.value) return true;
  const reg = registration;
  if (!reg) return false;
  try {
    await reg.update();
  } catch {
    return false;
  }
  if (!updateReady.value && !reg.waiting && reg.installing) await installed(reg.installing, INSTALL_WAIT_MS);
  return updateReady.value || reg.waiting !== null;
}

/** Waits for pending saves, then activates the new version and reloads. */
export async function applyUpdate(): Promise<void> {
  await actions.flush();
  await updater?.(true);
}

export function dismissUpdate(): void {
  updateReady.value = false;
}
