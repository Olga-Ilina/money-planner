// Shared bits of the D2 screen tests («Лента», item card, journal form, «+» menu).
import { fireEvent, screen } from '@testing-library/preact';

/** Types `value` into a field the way the browser reports it (one input event). */
export function type(input: HTMLElement, value: string): void {
  fireEvent.input(input, { target: { value } });
}

/** Chooses `value` in a native select. */
export function choose(select: HTMLElement, value: string): void {
  fireEvent.change(select, { target: { value } });
}

/** Text with the no-break spaces of money turned into plain spaces. */
export const plain = (s: string | null | undefined): string => (s ?? '').replace(/[  ]/g, ' ');

/** The button whose accessible name is exactly `name`. */
export function button(name: string | RegExp): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

/** The current text of the toast (plain spaces). */
export function toastText(): string {
  return plain(document.querySelector('.toast-text')?.textContent);
}
