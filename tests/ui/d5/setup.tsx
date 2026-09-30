// Shared set-up of the D5 screen tests («Постоянные», «Покупки», «Долги»): a fake IndexedDB, a fresh
// session, and the page rendered with the sheet host and the toast (README «Screen-test recipe»).
import { afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import type { VNode } from 'preact';
import { IDBFactory } from 'fake-indexeddb';
import { useFactory } from '../../../src/store/db';
import { actions } from '../../../src/ui/actions';
import { Toast } from '../../../src/ui/kit';
import { SheetHost } from '../../../src/ui/sheets/host';
import { resetSession } from '../../../src/ui/state';

export function useScreenTestEnv(): void {
  beforeEach(() => {
    useFactory(new IDBFactory());
    resetSession();
  });
  afterEach(async () => {
    cleanup();
    await actions.flush();
    resetSession();
    useFactory(undefined);
  });
}

export function renderScreen(node: VNode) {
  return render(
    <>
      {node}
      <SheetHost />
      <Toast />
    </>,
  );
}

/** Types into an input the way the kit tests do (the whole value at once). */
export function type(el: HTMLElement, value: string): void {
  fireEvent.input(el, { target: { value } });
}

export function choose(el: HTMLElement, value: string): void {
  fireEvent.change(el, { target: { value } });
}

/** The inset section under the header `name`. */
export function section(name: string): HTMLElement {
  const header = screen.getByRole('heading', { level: 2, name });
  const el = header.closest('section');
  if (!el) throw new Error(`no section «${name}»`);
  return el as HTMLElement;
}

export function dialog(name: string): HTMLElement {
  return screen.getByRole('dialog', { name });
}

export function inputIn(scope: HTMLElement, label: string): HTMLInputElement {
  return within(scope).getByLabelText(label) as HTMLInputElement;
}
