// The accessible name a screen reader gets for a button, as testing-library computes it (dom-accessibility-api).
// Whitespace is normalised: no-break spaces become plain ones, a run of spaces one space, and the space happy-dom
// puts before the visually hidden «, » separators is closed up — a screen reader speaks «Еда, Продукты» either way.
import { screen } from '@testing-library/preact';

export function accessibleName(button: HTMLElement): string {
  let got: string | undefined;
  screen.queryAllByRole('button', {
    hidden: true,
    name: (n, el) => {
      if (el === button) got = n;
      return false;
    },
  });
  if (got === undefined) throw new Error('not a button of the document');
  return got.replace(/\s+/g, ' ').trim().replace(/ ,/g, ',');
}
