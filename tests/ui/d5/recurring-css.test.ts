// Invariants of RecurringForm.css that the DOM tests cannot see (happy-dom applies no CSS), as in
// tests/ui/styles.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(import.meta.dirname, '../../../src/ui/sheets/RecurringForm.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** Every selector of the sheet (rules inside @media too), one per entry. */
function selectors(): string[] {
  return [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .flatMap((m) => m[1]!.split(','))
    .map((s) => s.trim())
    .filter((s) => s !== '' && !s.startsWith('@'));
}

describe('RecurringForm.css — the marks grid', () => {
  it('only an EMPTY month that is not due is pale: every rule of the pale look excludes a marked month', () => {
    const pale = selectors().filter((s) => s.includes('.recurring-form-mark-off'));
    expect(pale.length).toBeGreaterThan(0);
    for (const s of pale) expect(s).toContain('.recurring-form-mark-off:not(.recurring-form-mark-set)');
  });

  it('a marked month keeps its green look', () => {
    const set = selectors().filter((s) => s.includes('.recurring-form-mark-set') && !s.includes(':not('));
    expect(set).toContain('.recurring-form-mark-set');
    expect(set).toContain('.recurring-form-mark-set .recurring-form-mark-value');
  });

  it('the amount of a marked month is written in the green for TEXT (the bright one is too pale for 4.5:1)', () => {
    const rule = /\.recurring-form-mark-set \.recurring-form-mark-value\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/color:\s*var\(--green-text\)/);
  });
});
