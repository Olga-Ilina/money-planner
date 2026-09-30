// Registers the service worker (vite-plugin-pwa, registerType 'prompt'): it precaches the app and
// the lazily loaded Excel chunks for offline use, and reports new versions. Imported only by main.tsx.
import { registerSW } from 'virtual:pwa-register';
import { setRegistration, setUpdater, updateReady } from './pwa';

const CHECK_EVERY_MS = 60 * 60_000;

export function registerPwa(): void {
  const update = registerSW({
    onNeedRefresh() {
      updateReady.value = true;
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      setRegistration(registration);
      // a Home Screen app can stay open for days: look for a new version now and then
      setInterval(() => {
        if (navigator.onLine) registration.update().catch(() => {});
      }, CHECK_EVERY_MS);
    },
  });
  setUpdater(update);
}
