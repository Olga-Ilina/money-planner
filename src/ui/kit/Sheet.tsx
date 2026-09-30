// Bottom sheet (iOS page sheet): grabber, rounded top, header with left/title/right, own scroll,
// at most 92% of the screen height. Tapping the backdrop, Esc or dragging the header down closes it;
// focus stays inside while it is open and goes back where it was afterwards — or, when that element is
// gone (or lies in a modal that has closed too, e.g. the card whose «Удалить» asked), to the element drawn
// in its place (the same `data-focus-key`, e.g. a renamed row), else to the main heading of the page on
// screen; never to <body>.
// Confirm is an action sheet asking before a destructive action.
// Both render into the app shell's overlay root (Overlay.tsx), wherever they are declared.
import type { ComponentChildren, RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Overlay } from './Overlay';
import { useUid } from './uid';

const EXIT_MS = 240;
const DRAG_CLOSE_PX = 90;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let openModals = 0;

function lockScroll(): () => void {
  openModals += 1;
  document.documentElement.classList.add('modal-open');
  return () => {
    openModals = Math.max(0, openModals - 1);
    if (openModals === 0) document.documentElement.classList.remove('modal-open');
  };
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest('[inert]'));
}

/** Marks an element that a modal may give focus back to after it was drawn anew (Row `focusKey`). */
export const FOCUS_KEY = 'data-focus-key';

const onScreen = (el: HTMLElement): boolean => el.isConnected && !el.closest('[inert], [hidden], [aria-hidden="true"]');

/** The panel of the modal (a sheet or a confirm) `el` lies in, or null. */
const modalOf = (el: Element): Element | null => el.closest('[aria-modal="true"]');

/** Whether `panel` belongs to a modal that is still open (not one sliding away). */
const isOpenModal = (panel: Element): boolean => openStack.some((m) => m.panel.current === panel);

/**
 * Whether focus may go back to `before`: it is on screen and not inside a modal that has closed meanwhile
 * (a confirm asked from a card that then closed with it: its «Удалить» is still in the DOM while the card slides
 * away, and focus left there would drop to <body> when the card leaves).
 */
function canReturnTo(before: HTMLElement | null): before is HTMLElement {
  if (!before || before === document.body || !onScreen(before)) return false;
  const panel = modalOf(before);
  return panel === null || isOpenModal(panel);
}

/** Whether focus is already somewhere fine outside every modal (e.g. another modal's clean-up put it there). */
function focusSettledOutside(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLElement && el !== document.body && onScreen(el) && modalOf(el) === null;
}

/** Focus to the main heading of the page on screen (made focusable by script only); false when there is none. */
function focusHeading(): boolean {
  const heading = Array.from(document.querySelectorAll<HTMLElement>('h1')).find(onScreen);
  if (!heading) return false;
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll: true });
  return true;
}

/**
 * Where focus goes when something that holds it goes away outside a modal (e.g. the toast after «Отменить»):
 * into the modal on top when one is open, else to the page's main heading. Never left on <body>.
 */
export function focusFallback(): void {
  if (!focusOpenModal()) focusHeading();
}

/**
 * Where focus goes when a modal closes. Focus already on a valid element outside every modal stays there.
 * Otherwise back to `before` (what had it when the modal opened) while it can take it (`canReturnTo`); else to
 * the element that took its place (the same focus key); else to the main heading of the page on screen. Never
 * left on <body>.
 */
function restoreFocus(before: HTMLElement | null, key: string | null): void {
  if (focusSettledOutside()) return;
  if (canReturnTo(before)) {
    before.focus({ preventScroll: true });
    return;
  }
  if (key !== null) {
    const same = Array.from(document.querySelectorAll<HTMLElement>(`[${FOCUS_KEY}]`)).find(
      (el) => el.getAttribute(FOCUS_KEY) === key && onScreen(el),
    );
    if (same) {
      same.focus({ preventScroll: true });
      return;
    }
  }
  focusHeading();
}

interface OpenModal {
  panel: RefObject<HTMLElement>;
  initial?: RefObject<HTMLElement>;
}

/** The modals that are open, the last on top. */
const openStack: OpenModal[] = [];

/**
 * Puts focus into the modal on top when it is not already inside it (e.g. after the lock screen: the app is
 * shown again with a sheet open). Returns whether a modal is open.
 */
export function focusOpenModal(): boolean {
  const top = openStack[openStack.length - 1];
  const el = top?.panel.current;
  if (!top || !el) return false;
  if (!el.contains(document.activeElement)) (top.initial?.current ?? el).focus({ preventScroll: true });
  return true;
}

/**
 * Modal behaviour for `panel` while `active`: locks page scroll, moves focus in (unless a field
 * inside already took it) and back out afterwards, keeps Tab inside, and calls onEscape on Esc.
 */
function useModal(panel: RefObject<HTMLElement>, active: boolean, onEscape: () => void, initial?: RefObject<HTMLElement>) {
  const escape = useRef(onEscape);
  escape.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const el = panel.current;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const key = before?.getAttribute(FOCUS_KEY) ?? null;
    const unlock = lockScroll();
    const entry: OpenModal = { panel, initial };
    openStack.push(entry);
    if (el && !el.contains(document.activeElement)) (initial?.current ?? el).focus({ preventScroll: true });
    return () => {
      unlock();
      const at = openStack.indexOf(entry);
      if (at !== -1) openStack.splice(at, 1);
      restoreFocus(before, key);
    };
  }, [active]);

  return (e: JSX.TargetedKeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      escape.current();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = focusables(panel.current);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      e.preventDefault();
      return;
    }
    const current = document.activeElement;
    if (e.shiftKey && (current === first || current === panel.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && current === last) {
      e.preventDefault();
      first.focus();
    }
  };
}

/** Keeps a closed modal on screen for its exit animation; returns [mounted, closing]. */
function usePresence(open: boolean): [boolean, boolean] {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const t = setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, EXIT_MS);
    return () => clearTimeout(t);
  }, [open]);
  return [mounted || open, closing && !open];
}

export interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Header left (usually «Отмена»). */
  left?: ComponentChildren;
  /** Header right (usually «Готово» / «Сохранить»). */
  right?: ComponentChildren;
  children?: ComponentChildren;
}

interface SheetContent {
  title: string;
  left?: ComponentChildren;
  right?: ComponentChildren;
  children?: ComponentChildren;
}

export function Sheet({ open, title, onClose, left, right, children }: SheetProps) {
  const [mounted, closing] = usePresence(open);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useUid();
  // while closing, keep showing what was there (the owner may already have cleared it)
  const last = useRef<SheetContent>({ title, left, right, children });
  if (open) last.current = { title, left, right, children };
  const onKeyDown = useModal(panel, mounted && !closing, onClose);
  const [drag, setDrag] = useState(0);
  const dragStart = useRef<number | null>(null);

  if (!mounted) return null;
  const c = last.current;

  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    dragStart.current = e.clientY;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLElement>) => {
    if (dragStart.current === null) return;
    setDrag(Math.max(0, e.clientY - dragStart.current));
  };
  const onPointerUp = () => {
    if (dragStart.current === null) return;
    dragStart.current = null;
    if (drag > DRAG_CLOSE_PX) onClose();
    setDrag(0);
  };

  return (
    <Overlay>
      <div class={`sheet-layer${closing ? ' sheet-closing' : ''}`}>
        <div class="sheet-backdrop" onClick={onClose} />
        <div
          ref={panel}
          class="sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          style={drag > 0 ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}
        >
          <div
            class="sheet-header"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <div class="sheet-grabber" aria-hidden="true" />
            <div class="sheet-bar">
              <div class="sheet-bar-side">{c.left}</div>
              <h2 class="sheet-title" id={titleId}>
                {c.title}
              </h2>
              <div class="sheet-bar-side sheet-bar-right">{c.right}</div>
            </div>
          </div>
          <div class="sheet-body">{c.children}</div>
        </div>
      </div>
    </Overlay>
  );
}

export interface ConfirmProps {
  open: boolean;
  title: string;
  message?: string;
  /** Text of the action button, e.g. «Удалить». */
  confirmLabel: string;
  cancelLabel?: string;
  /** Red action button (default true). */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Action sheet asking to confirm; focus starts on «Отмена», the safe choice. */
export function Confirm({
  open, title, message, confirmLabel, cancelLabel = 'Отмена', destructive = true, onConfirm, onCancel,
}: ConfirmProps) {
  const [mounted, closing] = usePresence(open);
  const panel = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useUid();
  const messageId = useUid();
  const onKeyDown = useModal(panel, mounted && !closing, onCancel, cancel);
  if (!mounted) return null;
  return (
    <Overlay>
      <div class={`sheet-layer confirm-layer${closing ? ' sheet-closing' : ''}`}>
        <div class="sheet-backdrop" onClick={onCancel} />
        <div
          ref={panel}
          class="confirm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={message ? messageId : undefined}
          tabIndex={-1}
          onKeyDown={onKeyDown}
        >
          <div class="confirm-group">
            <div class="confirm-text">
              <p class="confirm-title" id={titleId}>
                {title}
              </p>
              {message && (
                <p class="confirm-message" id={messageId}>
                  {message}
                </p>
              )}
            </div>
            <button type="button" class={`confirm-button${destructive ? ' confirm-destructive' : ''}`} onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
          <button type="button" ref={cancel} class="confirm-button confirm-cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </Overlay>
  );
}
