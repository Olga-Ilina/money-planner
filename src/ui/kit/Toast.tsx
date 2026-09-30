// One toast at a time above the tab bar (and above sheets): a short message, optionally with
// «Отменить», one other action, or both (the action first). <Toast/> is rendered once by the app;
// anything calls showToast().
// The host is the one polite live region: screen readers read each new toast once.
// A toast that goes away while one of its buttons has focus (a click focuses it in a desktop browser;
// a keyboard user may sit on it) hands focus to the open sheet or the page's heading, never to <body>.
import { toast } from '../state';
import type { ToastAction } from '../state';
import { focusFallback } from './Sheet';

const SHORT_MS = 3_000;
const WITH_ACTION_MS = 5_000;

let nextId = 1;
let timer: ReturnType<typeof setTimeout> | undefined;

export interface ToastOptions {
  /** Adds «Отменить», which calls this and hides the toast. */
  undo?: () => void;
  /** Adds one other action button (before «Отменить» when both are given). */
  action?: ToastAction;
  /** Default: 5 s with a button, 3 s without. */
  durationMs?: number;
}

/** Focus that sits on the toast's buttons goes elsewhere before the toast (or its buttons) go away. */
function releaseFocus(): void {
  if (typeof document === 'undefined') return; // actions run in node tests too
  const el = document.activeElement;
  if (el instanceof HTMLElement && el.closest('.toast-host')) focusFallback();
}

/** Shows the toast (replacing any other); returns its id for hideToast(id). */
export function showToast(text: string, opts: ToastOptions = {}): number {
  const id = nextId++;
  if (toast.value) releaseFocus();
  toast.value = { id, text, ...(opts.undo ? { undo: opts.undo } : {}), ...(opts.action ? { action: opts.action } : {}) };
  if (timer !== undefined) clearTimeout(timer);
  const ms = opts.durationMs ?? (opts.undo || opts.action ? WITH_ACTION_MS : SHORT_MS);
  timer = setTimeout(() => hideToast(id), ms);
  return id;
}

/** Hides the toast (only toast `id` when given, so a newer toast is never hidden by an old timer). */
export function hideToast(id?: number): void {
  if (id !== undefined && toast.value?.id !== id) return;
  if (toast.value) releaseFocus();
  toast.value = null;
}

export function Toast() {
  const t = toast.value;
  const buttons: ToastAction[] = [];
  if (t?.action) buttons.push(t.action);
  if (t?.undo) buttons.push({ label: 'Отменить', onClick: t.undo });
  return (
    <div class="toast-host" role="status" aria-live="polite">
      {t && (
        <div class="toast" key={t.id}>
          <span class="toast-text">{t.text}</span>
          {buttons.map((button) => (
            <button
              key={button.label}
              type="button"
              class="toast-button"
              onClick={() => {
                hideToast(t.id);
                button.onClick();
              }}
            >
              {button.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
