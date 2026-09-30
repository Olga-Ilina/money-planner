// Element ids that are unique in the whole page. Sheets render in their own render root (the overlay
// inside the app shell), where Preact's useId would start counting again and repeat ids used by the
// page behind — so the kit (and any screen that needs an id) uses useUid instead.
import { useState } from 'preact/hooks';

let last = 0;

/** A page-wide unique id ('k1', 'k2', …), stable for the life of the component. */
export function useUid(): string {
  return useState(() => `k${++last}`)[0];
}
